// かぞく手帳: Zaim の入出金通知メールと、カード会社の利用通知メールを受け取り、明細として取り込む（家計タブ。docs/kakei.md §9.5・§9.6）
//
// 呼ぶのは Gmail の Apps Script（tools/gas/zaim-feed.gs）。5分ごとに、まだ送っていない通知メールをまとめて送る。
//   POST { messages: [{ id: GmailのメッセージID, received_at: ISO, from: 差出人, to: 宛先, subject: 件名, body: 本文（プレーンテキスト） }] }
//   差出人がカード会社なら利用通知（source = 'card_mail'。1通に何件もあれば source_id を「ID#2」…と分ける）。それ以外は Zaim。
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

    // カード会社の利用通知（§9.6）。1通に何件もあれば、件ごとに明細にする。読めなければ「読めない」で1件
    if (cardIssuerOf(text(message.from)) !== null) {
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
              store_hint: await storeHintFor(supabase, familyId, entry.merchant, await loadStores()),
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
