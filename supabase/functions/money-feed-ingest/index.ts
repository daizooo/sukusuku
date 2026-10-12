// かぞく手帳: Zaim の入出金通知メールを受け取り、口座の明細として取り込む（家計タブ。docs/kakei.md §9.5）
//
// 呼ぶのは Gmail の Apps Script（tools/gas/zaim-feed.gs）。5分ごとに、まだ送っていない通知メールをまとめて送る。
//   POST { messages: [{ id: GmailのメッセージID, received_at: ISO, to: 宛先, subject: 件名, body: 本文（プレーンテキスト） }] }
//   Authorization: Bearer {取り込みの鍵}
// 返り値 { results: [{ id, status }] }。status が error 以外のメールは、Apps Script が送り済みの印を付ける。
//
// 鍵は家計の設定で発行し（money_feed_issue_token）、DB には SHA-256 だけを持つ。鍵から家族を決める。
// メールを読むのは _shared/zaimMail.ts（試せるよう外に出してある）。突き合わせは DB の money_feed_receive。
// 本文には振込の相手の名前が入るので、ログには出さない。
//
// 認証は鍵で自前で確かめるので、supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import { parseZaimMail } from '../_shared/zaimMail.ts';

interface IncomingMessage {
  id?: unknown;
  received_at?: unknown;
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
    const parsed = parseZaimMail(subject, body, receivedAt);
    const feed = {
      source_id: id,
      received_at: new Date(receivedAt).toISOString(),
      to_email: text(message.to).replace(/^.*<([^>]+)>.*$/, '$1').trim(),
      subject: subject.slice(0, 500),
      raw_line: pickLine(body),
      ...(parsed && {
        direction: parsed.direction,
        occurred_on: parsed.occurredOn,
        amount: parsed.amount,
        account_name: parsed.accountName,
        description: parsed.description,
      }),
    };
    const { data, error } = await supabase.rpc('money_feed_receive', { p_family: familyId, p_feed: feed });
    if (error) {
      console.error('money_feed_receive failed', error.code);
      results.push({ id, status: 'error' });
    } else {
      results.push({ id, status: String((data as { status?: string })?.status ?? 'error') });
    }
  }

  await supabase.from('money_feed_tokens').update({ last_used_at: new Date().toISOString() }).eq('family_id', familyId);
  return json({ results });
});
