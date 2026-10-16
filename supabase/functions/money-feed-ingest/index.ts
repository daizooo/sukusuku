// かぞく手帳: Zaim の入出金通知メールと、カード会社の利用通知メールを受け取り、明細として取り込む（家計タブ。docs/kakei.md §9.5・§9.6）
//
// 呼ぶのは Gmail の Apps Script（tools/gas/zaim-feed.gs）。5分ごとに、まだ送っていない通知メールをまとめて送る。
//   POST { messages: [{ id: GmailのメッセージID, received_at: ISO, from: 差出人, to: 宛先, subject: 件名, body: 本文（プレーンテキスト） }] }
//   差出人がカード会社なら利用通知（source = 'card_mail'。1通に何件もあれば source_id を「ID#2」…と分ける）。それ以外は Zaim。
//   差出人が Amazon（auto-confirm@amazon.co.jp）なら注文メール。品目を覚えておき（money_amazon_*）、Amazon のカードの利用通知が
//   届いたら、請求額に合う品目を割り振って品目つきの記録にする（_shared/amazonOrder.ts。docs/kakei.md §9.7）。
//   Authorization: Bearer {取り込みの鍵}
// 返り値 { results: [{ id, status }] }。status が error 以外のメールは、Apps Script が送り済みの印を付ける。
//
// 鍵は家計の設定で発行し（money_feed_issue_token）、DB には SHA-256 だけを持つ。鍵から家族を決める。
// メールを読むのは _shared/zaimMail.ts（試せるよう外に出してある）。突き合わせは DB の money_feed_receive。
// 本文には振込の相手の名前が入るので、ログには出さない。
//
// 認証は鍵で自前で確かめるので、supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';
import { parseZaimMail } from '../_shared/zaimMail.ts';
import {
  CATEGORY_PICK_SCHEMA,
  CATEGORY_PICK_SYSTEM_PROMPT,
  isAmazonCharge,
  isAmazonOrderSender,
  matchAmazonCharge,
  parseAmazonOrderMail,
  readCategoryPicks,
  type AmazonOrder,
  type OpenAmazonOrder,
} from '../_shared/amazonOrder.ts';
import {
  cardIssuerOf,
  matchStoreByRomaji,
  parseCardMail,
  STORE_PICK_SCHEMA,
  STORE_PICK_SYSTEM_PROMPT,
} from '../_shared/cardMail.ts';

interface IncomingMessage {
  id?: unknown;
  received_at?: unknown;
  from?: unknown;
  to?: unknown;
  subject?: unknown;
  body?: unknown;
}

// 1回に受けるメールの数（Apps Script もこれ以下で送る）
const MAX_MESSAGES = 50;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

// 本文から、明細の1行（「新着の入金／出金 …」）だけを残す
const pickLine = (body: string): string => {
  const line = body.split(/\r?\n/).find((l) => l.includes('新着の入金') || l.includes('新着の出金')) ?? '';
  return line.replace(/^[\s|]+|[\s|]+$/g, '').slice(0, 500);
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const MODEL = 'claude-haiku-5-5';
type Admin = ReturnType<typeof createClient>;

/**
 * カードの利用先に当たるお店の候補（未確認の明細の「記録にする」に入れておく。docs/kakei.md §9.6）。
 * ① 同じ利用先の明細から作った・結んだ記録のお店（覚えたもの）→ ② 登録したお店の名前をローマ字にして当てる →
 * ③ AI（Haiku）に登録したお店の一覧から選ばせる。当たらなければ null。
 */
async function storeHintFor(admin: Admin, familyId: string, merchant: string, stores: string[]): Promise<string | null> {
  if (merchant === '') return null;
  const { data: past } = await admin
    .from('money_feed')
    .select('received_at, money_records!money_feed_record_fkey(store)')
    .eq('family_id', familyId)
    .eq('source', 'card_mail')
    .eq('description', merchant)
    .not('record_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(5)
    .returns<{ money_records: { store: string } | null }[]>();
  const remembered = (past ?? []).map((row) => row.money_records?.store ?? '').find((store) => store !== '');
  if (remembered) return remembered;

  const byRomaji = matchStoreByRomaji(merchant, stores);
  if (byRomaji) return byRomaji;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey || stores.length === 0) return null;
  try {
    const response = await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: STORE_PICK_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: STORE_PICK_SCHEMA } },
      messages: [{ role: 'user', content: `利用先: ${merchant}\n\nお店の一覧:\n${stores.join('\n')}` }],
    });
    const block = response.content.find((entry) => entry.type === 'text');
    if (!block || block.type !== 'text') return null;
    const picked = String((JSON.parse(block.text) as { store?: unknown }).store ?? '').trim();
    return stores.includes(picked) ? picked : null;
  } catch {
    console.error('store pick failed');
    return null;
  }
}

/** 注文メールの品目に付ける種類。同じ品名の過去の品目 → AI（小分類の一覧から選ばせる）。決まらなければ null。 */
async function categoriesForOrderLines(admin: Admin, familyId: string, receiptNames: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>(receiptNames.map((name) => [name, null]));
  if (receiptNames.length === 0) return result;

  const { data: categories } = await admin
    .from('money_categories')
    .select('id, name, parent_id, kind')
    .eq('family_id', familyId)
    .is('archived_at', null)
    .returns<{ id: string; name: string; parent_id: string | null; kind: string }[]>();
  const topName = new Map((categories ?? []).filter((c) => c.parent_id === null).map((c) => [c.id, c.name]));
  const subs = (categories ?? []).filter((c) => c.parent_id !== null && c.kind === 'living');
  const categoryIds = new Set(subs.map((c) => c.id));

  // 同じ品名の、いちばん新しい品目の種類（品名が長いので1件ずつ引く）
  await Promise.all(
    receiptNames.map(async (name) => {
      const { data } = await admin
        .from('money_items')
        .select('category_id')
        .eq('family_id', familyId)
        .eq('receipt_name', name)
        .not('category_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ category_id: string }>();
      if (data && categoryIds.has(data.category_id)) result.set(name, data.category_id);
    }),
  );

  const unknown = receiptNames.filter((name) => result.get(name) === null);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (unknown.length === 0 || !apiKey || subs.length === 0) return result;
  try {
    const categoryLines = subs.map((c) => `${c.id}: ${topName.get(c.parent_id!) ?? ''} › ${c.name}`).join('\n');
    const itemLines = unknown.map((name, index) => `${index}: ${name.slice(0, 150)}`).join('\n');
    const response = await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: CATEGORY_PICK_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: CATEGORY_PICK_SCHEMA } },
      messages: [{ role: 'user', content: `小分類の一覧（id: 大分類 › 小分類）:\n${categoryLines}\n\n商品（番号: 名前）:\n${itemLines}` }],
    });
    const block = response.content.find((entry) => entry.type === 'text');
    if (block && block.type === 'text') {
      const picks = readCategoryPicks(JSON.parse(block.text), unknown.length, categoryIds);
      unknown.forEach((name, index) => result.set(name, picks[index]));
    }
  } catch {
    // 種類が決まらなくても、品目は覚える（記録の入力で選ぶ）
    console.error('category pick failed');
  }
  return result;
}

/** 注文メールの注文を覚える。返り値はメールの状態（error 以外は Apps Script が送り済みの印を付ける）。 */
async function receiveAmazonOrders(
  admin: Admin,
  familyId: string,
  mail: { id: string; receivedAt: string; subject: string; body: string },
): Promise<string> {
  const orders: AmazonOrder[] | null = parseAmazonOrderMail(mail.subject, mail.body);
  if (orders === null) return 'ignored';

  const names = [...new Set(orders.flatMap((order) => order.lines.map((line) => line.receiptName)))];
  const categories = await categoriesForOrderLines(admin, familyId, names);
  // 注文した日（日本時間）
  const orderedOn = new Date(Date.parse(mail.receivedAt) + 9 * 3600_000).toISOString().slice(0, 10);

  const statuses: string[] = [];
  for (const order of orders) {
    const sum = order.lines.reduce((acc, line) => acc + line.amount, 0);
    const { data, error } = await admin.rpc('money_amazon_order_receive', {
      p_family: familyId,
      p_order: {
        order_no: order.orderNo,
        source_id: mail.id,
        received_at: mail.receivedAt,
        ordered_on: orderedOn,
        total: order.total,
        adjust: order.total - sum,
        lines: order.lines.map((line) => ({
          receipt_name: line.receiptName,
          name: line.name,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          amount: line.amount,
          category_id: categories.get(line.receiptName) ?? null,
        })),
      },
    });
    if (error) {
      console.error('money_amazon_order_receive failed', error.code);
      statuses.push('error');
    } else {
      statuses.push(String((data as { status?: string })?.status ?? 'error'));
    }
  }
  return statuses.includes('error') ? 'error' : 'saved';
}

/** 覚えている注文の、まだ割り振っていない品目から、カードの請求額に合う組み合わせを探す。 */
async function amazonAllocationFor(admin: Admin, familyId: string, amount: number) {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const { data: orders } = await admin
    .from('money_amazon_orders')
    .select('id, ordered_on, total, adjust, adjust_feed_id, discount_used')
    .eq('family_id', familyId)
    .gte('ordered_on', since)
    .order('ordered_on', { ascending: false })
    .limit(100)
    .returns<
      { id: string; ordered_on: string; total: number; adjust: number; adjust_feed_id: string | null; discount_used: number }[]
    >();
  if (!orders || orders.length === 0) return null;
  const { data: lines } = await admin
    .from('money_amazon_lines')
    .select('id, order_id, amount, position')
    .eq('family_id', familyId)
    .is('feed_id', null)
    .in('order_id', orders.map((order) => order.id))
    .returns<{ id: string; order_id: string; amount: number; position: number }[]>();
  // 注文メールの合計が品目の和より安いぶんが値引きの予算（クーポン・定期おトク便など。どの商品かは分からない）。高ければ送料などの上乗せ（§9.7.3）
  const open: OpenAmazonOrder[] = orders.map((order) => ({
    orderId: order.id,
    orderedOn: order.ordered_on,
    discountLeft: Math.max(0, (order.adjust < 0 ? -order.adjust : 0) - order.discount_used),
    fee: order.adjust > 0 ? order.adjust : 0,
    feeOpen: order.adjust_feed_id === null,
    lines: (lines ?? []).filter((line) => line.order_id === order.id),
  }));
  const match = matchAmazonCharge(amount, open);
  return match && { amazon_order_id: match.orderId, amazon_line_ids: match.lineIds, amazon_with_adjust: match.withFee };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return json({ error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: tokenRow, error: tokenError } = await supabase
    .from('money_feed_tokens')
    .select('family_id')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle<{ family_id: string }>();
  if (tokenError) return json({ error: 'token lookup failed' }, 500);
  if (!tokenRow) return json({ error: 'unauthorized' }, 401);
  const familyId = tokenRow.family_id;

  const payload = await request.json().catch(() => null);
  const messages: IncomingMessage[] = Array.isArray(payload?.messages) ? payload.messages.slice(0, MAX_MESSAGES) : [];

  const results: { id: string; status: string }[] = [];
  let storeNames: string[] | null = null;
  const loadStores = async (): Promise<string[]> => {
    if (storeNames === null) {
      const { data } = await supabase
        .from('money_stores')
        .select('name')
        .eq('family_id', familyId)
        .is('archived_at', null)
        .returns<{ name: string }[]>();
      storeNames = (data ?? []).map((row) => row.name);
    }
    return storeNames;
  };
  const receive = async (feed: Record<string, unknown>): Promise<string> => {
    const { data, error } = await supabase.rpc('money_feed_receive', { p_family: familyId, p_feed: feed });
    if (error) {
      console.error('money_feed_receive failed', error.code);
      return 'error';
    }
    return String((data as { status?: string })?.status ?? 'error');
  };

  // 届いた順に入れる（振替は先に届いた片方に後の片方を組み合わせる）
  const sorted = [...messages].sort((a, b) => text(a.received_at).localeCompare(text(b.received_at)));
  for (const message of sorted) {
    const id = text(message.id);
    const receivedAt = text(message.received_at);
    if (!id || Number.isNaN(Date.parse(receivedAt))) {
      results.push({ id, status: 'error' });
      continue;
    }
    const subject = text(message.subject);
    const body = text(message.body);
    const base = {
      received_at: new Date(receivedAt).toISOString(),
      to_email: text(message.to).replace(/^.*<([^>]+)>.*$/, '$1').trim(),
      subject: subject.slice(0, 500),
    };

    // Amazon の注文メール（§9.7）。品目を覚えておく
    if (isAmazonOrderSender(text(message.from))) {
      results.push({ id, status: await receiveAmazonOrders(supabase, familyId, { id, receivedAt, subject, body }) });
      continue;
    }

    // カード会社の利用通知（§9.6）。1通に何件もあれば、件ごとに明細にする。読めなければ「読めない」で1件
    if (cardIssuerOf(text(message.from)) !== null) {
      const entries = parseCardMail(text(message.from), subject, body);
      const statuses: string[] = [];
      if (entries === null) {
        statuses.push(await receive({ ...base, source: 'card_mail', source_id: id, raw_line: '' }));
      } else {
        for (const [index, entry] of entries.entries()) {
          // Amazon の利用なら、注文メールで覚えた品目から請求額に合うものを割り振る（§9.7）
          const amazon = isAmazonCharge(entry.merchant, entry.accountName)
            ? await amazonAllocationFor(supabase, familyId, entry.amount)
            : null;
          statuses.push(
            await receive({
              ...base,
              source: 'card_mail',
              source_id: index === 0 ? id : `${id}#${index + 1}`,
              raw_line: `${entry.occurredOn} ${entry.merchant} ${entry.amount}円`.slice(0, 500),
              direction: 'out',
              occurred_on: entry.occurredOn,
              amount: entry.amount,
              account_name: entry.accountName,
              description: entry.merchant,
              store_hint: await storeHintFor(supabase, familyId, entry.merchant, await loadStores()),
              ...amazon,
            }),
          );
        }
      }
      results.push({ id, status: statuses.includes('error') ? 'error' : statuses[0] });
      continue;
    }

    const parsed = parseZaimMail(subject, body, receivedAt);
    const feed = {
      source_id: id,
      ...base,
      raw_line: pickLine(body),
      ...(parsed && {
        direction: parsed.direction,
        occurred_on: parsed.occurredOn,
        amount: parsed.amount,
        account_name: parsed.accountName,
        description: parsed.description,
      }),
    };
    results.push({ id, status: await receive(feed) });
  }

  await supabase.from('money_feed_tokens').update({ last_used_at: new Date().toISOString() }).eq('family_id', familyId);
  return json({ results });
});
