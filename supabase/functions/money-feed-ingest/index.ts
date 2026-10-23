// かぞく手帳: カード会社の利用通知メールと Amazon の注文メールを受け取り、明細として取り込む（家計タブ。docs/kakei.md §9.6・§9.10）
//
// 呼ぶのは Gmail の Apps Script（tools/gas/gmail-feed.gs）。5分ごとに、まだ送っていない通知メールをまとめて送る。
//   POST { messages: [{ id: GmailのメッセージID, received_at: ISO, from: 差出人, to: 宛先, subject: 件名, body: 本文（プレーンテキスト） }] }
//   差出人がカード会社なら利用通知（source = 'card_mail'。1通に何件もあれば source_id を「ID#2」…と分ける）。
//   差出人が Amazon（auto-confirm@amazon.co.jp）なら注文メール。注文と品目（値引き後の合計も）を覚える（DB の money_amazon_order_receive）。
//   差出人が Amazon の発送（shipment-tracking@amazon.co.jp）なら発送メール。どの品目が同じ荷物かを覚え、品目がすべて注文と結べたら
//   荷物1つ（＝請求1件）につき未確認の明細を1件作る（DB の money_amazon_shipment_receive。日付は発送日、額は注文メールから。docs/kakei.md §9.13）。
//   注文メールが後から届いたときは、待っている荷物の明細をそこで作る。
//   それ以外の差出人（Zaim など。Apps Script はもう送らない）は取り込まず「対象外」にする（§9.11）。
//   Authorization: Bearer {取り込みの鍵}
// 返り値 { results: [{ id, status }] }。error 以外のメールは、受け取ったことを money_feed_mails に書く（§9.8）。
//
// Apps Script は、送る前と送ったあとに同期する（§9.8）。
//   POST { action: 'sync', ids: [Gmail で見つけたメールのID], applied: [{ id, label, trashed }] }
//   返り値 { missing: [まだ受け取っていないID], changes: [{ id, label, trash }] }（付け替えるラベル・ゴミ箱へ移すメール）
//
// 鍵は家計の設定で発行し（money_feed_issue_token）、DB には SHA-256 だけを持つ。鍵から家族を決める。
// メールを読むのは _shared/cardMail.ts・amazonOrder.ts（試せるよう外に出してある）。突き合わせは DB の money_feed_receive。
// 本文には個人の情報が入るので、ログには出さない。
//
// 認証は鍵で自前で確かめるので、supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';
import {
  CATEGORY_PICK_SCHEMA,
  CATEGORY_PICK_SYSTEM_PROMPT,
  isAmazonOrderSender,
  isAmazonShipmentSender,
  parseAmazonOrderMail,
  parseAmazonShipmentMail,
  readCategoryPicks,
  type AmazonOrder,
} from '../_shared/amazonOrder.ts';
import {
  cardIssuerOf,
  isDiscardedCardMail,
  matchStoreByRomaji,
  parseCardMail,
  NO_STORE_MERCHANTS,
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
// 同期で受ける ID・付けたラベルの数
const MAX_SYNC_IDS = 2000;

// 注文メールの状態 → 受け取ったメールの扱い（error は書かず、次の同期でまた送られる）
const AMAZON_OUTCOMES: Record<string, string> = {
  saved: 'order',
  skipped: 'skipped',
  ignored: 'unreadable',
  before_start: 'before_start',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const MODEL = 'claude-haiku-5-5';
type Admin = ReturnType<typeof createClient>;

/**
 * カードの利用先に当たるお店の候補（未確認の明細の「記録を作成する」に入れておく。docs/kakei.md §9.6.3）。
 * 登録したお店の名前をローマ字にして当てるだけ。前の記録のお店や AI の推測は入れない（外れたお店が入るため。2026-10-22）。
 * 利用先が決まらないデビット（iDデビット）は null。当たらなければ null。
 */
function storeHintFor(merchant: string, stores: string[]): string | null {
  if (merchant === '' || NO_STORE_MERCHANTS.has(merchant.normalize('NFKC'))) return null;
  return matchStoreByRomaji(merchant, stores);
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

/**
 * 注文メールの注文を覚える（DB の money_amazon_order_receive。注文ごと）。明細は発送メールの荷物ごとに作る（§9.13）。
 * この注文を待っている荷物があれば、DB がそこで明細を作る。
 * 返り値はメールの状態（error 以外は受け取ったメールとして money_feed_mails に書く）。
 */
async function receiveAmazonOrders(
  admin: Admin,
  familyId: string,
  mail: { id: string; receivedAt: string; subject: string; body: string },
): Promise<string> {
  const orders: AmazonOrder[] | null = parseAmazonOrderMail(mail.subject, mail.body);
  if (orders === null) {
    // 読めない形（書式が変わった等）。送り済みの印は付くので、関数のログで気づけるようにしておく
    console.error('amazon order mail unreadable');
    return 'ignored';
  }
  // 読めたが、覚えるものが無い（合計0円の注文など）。Apps Script が「対象外」のラベルを付ける
  if (orders.length === 0) return 'skipped';

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
        // 注文ごとの明細の件名
        subject: mail.subject.slice(0, 500),
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
  if (statuses.includes('error')) return 'error';
  return statuses.every((status) => status === 'before_start') ? 'before_start' : 'saved';
}

/**
 * 発送メールの荷物を覚え、品目がすべて注文と結べたら、荷物1つにつき未確認の明細を1件作る（DB の money_amazon_shipment_receive。§9.13）。
 * 日付は発送日（発送メールの受信日、日本時間）。額は注文メールの合計を品目に配ったもの（発送メールの単価は値引き前なので使わない）。
 */
async function receiveAmazonShipment(
  admin: Admin,
  familyId: string,
  mail: { id: string; receivedAt: string; subject: string; body: string },
): Promise<string> {
  const lines = parseAmazonShipmentMail(mail.subject, mail.body);
  if (lines === null) {
    console.error('amazon shipment mail unreadable');
    return 'ignored';
  }
  if (lines.length === 0) return 'skipped';

  const shippedOn = new Date(Date.parse(mail.receivedAt) + 9 * 3600_000).toISOString().slice(0, 10);
  const { data, error } = await admin.rpc('money_amazon_shipment_receive', {
    p_family: familyId,
    p_shipment: {
      source_id: mail.id,
      received_at: mail.receivedAt,
      subject: mail.subject.slice(0, 500),
      shipped_on: shippedOn,
      lines: lines.map((line) => ({ order_no: line.orderNo, receipt_name: line.receiptName, quantity: line.quantity })),
    },
  });
  if (error) {
    console.error('money_amazon_shipment_receive failed', error.code);
    return 'error';
  }
  const status = String((data as { status?: string })?.status ?? 'error');
  return status === 'before_start' || status === 'error' ? status : 'saved';
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

  // Apps Script との同期（§9.8）
  if (payload?.action === 'sync') {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).filter((id: unknown) => typeof id === 'string' && id !== '');
    const applied = Array.isArray(payload.applied) ? payload.applied : [];
    const { data, error } = await supabase.rpc('money_feed_mail_sync', {
      p_family: familyId,
      p_ids: ids.slice(0, MAX_SYNC_IDS),
      p_applied: applied.slice(0, MAX_SYNC_IDS),
    });
    if (error) {
      console.error('money_feed_mail_sync failed', error.code);
      return json({ error: 'sync failed' }, 500);
    }
    return json(data);
  }

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

  // 受け取ったメールの扱い（money_feed_mails。§9.8）
  const mails: { message_id: string; received_at: string; outcome: string }[] = [];
  const remember = (id: string, receivedAt: string, outcome: string) =>
    mails.push({ message_id: id, received_at: new Date(receivedAt).toISOString(), outcome });

  // 届いた順に入れる
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

    // Amazon の発送メール（§9.13）。荷物1つにつき未確認の明細を1件作る（注文メールとそろってから）
    if (isAmazonShipmentSender(text(message.from))) {
      const status = await receiveAmazonShipment(supabase, familyId, { id, receivedAt, subject, body });
      results.push({ id, status });
      const outcome = AMAZON_OUTCOMES[status];
      if (outcome) remember(id, receivedAt, outcome);
      continue;
    }

    // Amazon の注文メール（§9.10）。注文と品目を覚える（明細は発送メールの荷物ごと）
    if (isAmazonOrderSender(text(message.from))) {
      const status = await receiveAmazonOrders(supabase, familyId, { id, receivedAt, subject, body });
      results.push({ id, status });
      const outcome = AMAZON_OUTCOMES[status];
      if (outcome) remember(id, receivedAt, outcome);
      continue;
    }

    // カード会社の利用通知（§9.6）。1通に何件もあれば、件ごとに明細にする。読めなければ「読めない」で1件
    if (cardIssuerOf(text(message.from)) !== null) {
      // 取り込まない利用通知（Amazon のカード・楽天カード・「一定金額に到達」。§9.9）。Apps Script が「対象外」にしてゴミ箱へ移す
      if (isDiscardedCardMail(text(message.from), subject, body)) {
        results.push({ id, status: 'skipped' });
        remember(id, receivedAt, 'skipped');
        continue;
      }
      const entries = parseCardMail(text(message.from), subject, body);
      const statuses: string[] = [];
      if (entries === null) {
        statuses.push(await receive({ ...base, source: 'card_mail', source_id: id, raw_line: '' }));
      } else {
        for (const [index, entry] of entries.entries()) {
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
              store_hint: storeHintFor(entry.merchant, await loadStores()),
            }),
          );
        }
      }
      results.push({ id, status: statuses.includes('error') ? 'error' : statuses[0] });
      if (!statuses.includes('error')) remember(id, receivedAt, statuses[0] === 'before_start' ? 'before_start' : 'feed');
      continue;
    }

    // カード会社・Amazon 以外（Zaim の入出金通知など）は取り込まない（§9.11）。Apps Script が「対象外」にしてゴミ箱へ移す
    results.push({ id, status: 'skipped' });
    remember(id, receivedAt, 'skipped');
  }

  if (mails.length > 0) {
    const { error } = await supabase.rpc('money_feed_mail_record', { p_family: familyId, p_mails: mails });
    // 書けなくても明細は入っている。次の同期で「まだ」として返り、また送られる（同じメールは1回だけ取り込む）
    if (error) console.error('money_feed_mail_record failed', error.code);
  }

  await supabase.from('money_feed_tokens').update({ last_used_at: new Date().toISOString() }).eq('family_id', familyId);
  return json({ results });
});
