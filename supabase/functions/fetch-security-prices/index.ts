// かぞく手帳: 証券の価格と為替を取り、日々の評価額を作る（家計タブ。docs/kakei.md §9.2）
//
// 呼ばれ方は2つ。
//   1. pg_cron から毎朝（日本時間7時）: 使っている全銘柄の最新の価格と、ドルの為替を取り、
//      今日の評価額の行を作る（refresh_money_holding_values(今日, 今日)）
//   2. アプリから、銘柄を足したとき（body: { security_id }）: その銘柄の過去1年の価格と為替を取り、
//      過去1年の評価額の行を今の保有数で作る（§9.2.5）
//
// 取得元の応答を読むのは _shared/securityPrices.ts（試せるよう外に出してある）。
//   米国株  Alpha Vantage（鍵は secret の ALPHA_VANTAGE_API_KEY。無料は1分5回・1日25回なので、間を空けて1銘柄1回）
//   投信    投資信託協会の基準価額CSV（ISIN と協会コード。設定来の全部が返るので、要る分だけ入れる）
//   為替    Frankfurter（鍵なし）
// 同じコードの銘柄が複数の家族にあっても、取りに行くのは1回。
//
// 認証: 1 は共有シークレットのヘッダー（予定のリマインダーと同じ REMINDER_CRON_SECRET）。
//       2 はアプリのログインの JWT を確かめ、その人の家族の銘柄であることを見る。
//       どちらも自前で確かめるので、supabase/config.toml で verify_jwt = false にしている。

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  addDays,
  alphaVantageNotice,
  parseFrankfurter,
  parseFundCsv,
  parseGlobalQuote,
  parseTimeSeries,
  todayJst,
  type DatedValue,
} from '../_shared/securityPrices.ts';

// 過去に遡って作る日数（§9.2.5）。
const BACKFILL_DAYS = 365;
// Alpha Vantage の無料の鍵は1分5回まで。呼ぶ間を空ける。
const ALPHA_VANTAGE_INTERVAL_MS = 12_500;

interface SecurityRow {
  id: string;
  family_id: string;
  kind: 'us_stock' | 'jp_fund' | 'cash';
  code: string | null;
  fund_code: string | null;
  currency: 'JPY' | 'USD';
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const today = todayJst(Date.now());

  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET');
  if (cronSecret && request.headers.get('x-reminder-secret') === cronSecret) {
    // 取れるかだけ確かめる（保存しない）: body: { check: { us: ['ティッカー', …] } }
    const check = (await request.json().catch(() => ({})))?.check;
    if (Array.isArray(check?.us)) return json(await runCheck(check.us));
    return json(await runDaily(supabase, today));
  }

  // アプリから: ログインした人の家族の銘柄か確かめる
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const securityId = typeof body?.security_id === 'string' ? body.security_id : null;
  if (!securityId) return json({ error: 'security_id が要る' }, 400);
  // RLS が効く client で読めれば、その人の家族の銘柄
  const { data: security, error: securityError } = await userClient
    .from('money_securities')
    .select('id, family_id, kind, code, fund_code, currency')
    .eq('id', securityId)
    .maybeSingle<SecurityRow>();
  if (securityError) return json({ error: securityError.message }, 500);
  if (!security) return json({ error: 'not found' }, 404);

  return json(await runBackfill(supabase, security, today));
});

/** 毎朝: 全銘柄の最新の価格と為替を入れ、今日の評価額を作る。 */
async function runDaily(supabase: SupabaseClient, today: string) {
  const { data: securities, error } = await supabase
    .from('money_securities')
    .select('id, family_id, kind, code, fund_code, currency')
    .is('archived_at', null)
    .returns<SecurityRow[]>();
  if (error) return { error: error.message };

  const errors: string[] = [];
  const fx = await fetchFx(addDays(today, -7), today).catch((e) => {
    errors.push(`fx: ${e}`);
    return [];
  });
  await saveFx(supabase, fx, errors);

  let prices = 0;
  let alphaVantageCalls = 0;
  for (const group of groupByCode(securities ?? [])) {
    const sample = group[0];
    try {
      if (sample.kind === 'us_stock' && alphaVantageCalls++ > 0) await sleep(ALPHA_VANTAGE_INTERVAL_MS);
      const values =
        sample.kind === 'us_stock'
          ? parseOrThrow(await alphaVantage('GLOBAL_QUOTE', sample.code!), parseGlobalQuote)
          : (await fetchFund(sample)).slice(-7);
      prices += await savePrices(supabase, group, values);
    } catch (e) {
      errors.push(`${sample.code}: ${e}`);
    }
  }

  const { data: rows, error: refreshError } = await supabase.rpc('refresh_money_holding_values', {
    p_from: today,
    p_to: today,
  });
  if (refreshError) errors.push(`refresh: ${refreshError.message}`);
  return { today, securities: securities?.length ?? 0, prices, fx: fx.length, values: rows ?? 0, errors };
}

/** 銘柄を足したとき: その銘柄の過去1年の価格と為替を入れ、過去1年の評価額を作る。 */
async function runBackfill(supabase: SupabaseClient, security: SecurityRow, today: string) {
  const from = addDays(today, -BACKFILL_DAYS);
  // 期間のはじめの日にも、その前の価格・為替があるよう少し前から取る
  const fetchFrom = addDays(from, -10);
  const errors: string[] = [];

  if (security.currency === 'USD') {
    const fx = await fetchFx(fetchFrom, today).catch((e) => {
      errors.push(`fx: ${e}`);
      return [];
    });
    await saveFx(supabase, fx, errors);
  }

  let prices = 0;
  if (security.kind !== 'cash') {
    try {
      const values = (security.kind === 'us_stock' ? await fetchUsHistory(security.code!) : await fetchFund(security))
        .filter((v) => v.on >= fetchFrom);
      prices = await savePrices(supabase, [security], values);
    } catch (e) {
      errors.push(`${security.code}: ${e}`);
    }
  }

  const { data: holdings } = await supabase
    .from('money_holdings')
    .select('id')
    .eq('security_id', security.id)
    .is('archived_at', null);
  let values = 0;
  for (const holding of holdings ?? []) {
    const { data, error } = await supabase.rpc('refresh_money_holding_values', {
      p_from: from,
      p_to: today,
      p_holding_id: holding.id,
    });
    if (error) errors.push(`refresh: ${error.message}`);
    values += data ?? 0;
  }
  return { today, prices, values, errors };
}

/** 米国株の過去の終値が取れるかだけ確かめる（銘柄を足す前に。保存しない）。 */
async function runCheck(symbols: string[]) {
  const today = () => todayJst(Date.now());
  const results = [];
  for (const [i, symbol] of symbols.entries()) {
    if (i > 0) await sleep(ALPHA_VANTAGE_INTERVAL_MS);
    const body = await alphaVantage('TIME_SERIES_WEEKLY_ADJUSTED', String(symbol)).catch((e) => String(e));
    const values = parseTimeSeries(body, '5. adjusted close');
    results.push({
      symbol,
      points: values.length,
      first: values[0] ?? null,
      last: values.at(-1) ?? null,
      yearAgo: values.find((v) => v.on >= addDays(today(), -BACKFILL_DAYS)) ?? null,
      notice: values.length === 0 ? alphaVantageNotice(body) ?? String(body) : null,
    });
  }
  return { results };
}

/** 同じ取得元・コードの銘柄をまとめる（取りに行くのは1回）。預り金は取らない。 */
function groupByCode(securities: SecurityRow[]): SecurityRow[][] {
  const groups = new Map<string, SecurityRow[]>();
  for (const s of securities) {
    if (s.kind === 'cash' || !s.code) continue;
    const key = `${s.kind}:${s.code}:${s.fund_code ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()];
}

async function alphaVantage(fn: string, symbol: string, extra = ''): Promise<unknown> {
  const key = Deno.env.get('ALPHA_VANTAGE_API_KEY');
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY が未設定');
  const url = `https://www.alphavantage.co/query?function=${fn}&symbol=${encodeURIComponent(symbol)}${extra}&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage ${res.status}`);
  return res.json();
}

function parseOrThrow(body: unknown, parse: (b: unknown) => DatedValue[]): DatedValue[] {
  const values = parse(body);
  if (values.length === 0) throw new Error(alphaVantageNotice(body) ?? '値が無い');
  return values;
}

/**
 * 米国株の過去の終値。日次の全期間は有料なので（無料の鍵では断られる。2026-10-08に確かめた）、
 * 週次の、分割・配当を調整した終値を使う。分割の前の値がそのままだと、今の保有数を掛けたときに
 * 跳ねるため（例: 2026年4月に1→5の分割をした銘柄がある）。調整は過去の値だけに効くので、
 * 直近の値は毎朝取る終値とつながる。
 */
async function fetchUsHistory(symbol: string): Promise<DatedValue[]> {
  return parseOrThrow(await alphaVantage('TIME_SERIES_WEEKLY_ADJUSTED', symbol), (body) =>
    parseTimeSeries(body, '5. adjusted close'),
  );
}

/** 投資信託協会の基準価額CSV（設定来）。Shift_JIS。 */
async function fetchFund(security: SecurityRow): Promise<DatedValue[]> {
  const url =
    'https://toushin-lib.fwg.ne.jp/FdsWeb/FDST030000/csv-file-download' +
    `?isinCd=${encodeURIComponent(security.code!)}&associFundCd=${encodeURIComponent(security.fund_code ?? '')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`投信CSV ${res.status}`);
  const values = parseFundCsv(new TextDecoder('shift_jis').decode(await res.arrayBuffer()));
  if (values.length === 0) throw new Error('投信CSVに値が無い');
  return values;
}

/** ドル → 円の為替（from〜to）。 */
async function fetchFx(from: string, to: string): Promise<DatedValue[]> {
  const res = await fetch(`https://api.frankfurter.dev/v1/${from}..${to}?base=USD&symbols=JPY`);
  if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
  return parseFrankfurter(await res.json());
}

async function saveFx(supabase: SupabaseClient, fx: DatedValue[], errors: string[]) {
  if (fx.length === 0) return;
  const { error } = await supabase
    .from('money_fx_rates')
    .upsert(fx.map((v) => ({ currency: 'USD', rate_on: v.on, rate: v.value })));
  if (error) errors.push(`fx: ${error.message}`);
}

async function savePrices(supabase: SupabaseClient, group: SecurityRow[], values: DatedValue[]): Promise<number> {
  if (values.length === 0) return 0;
  const rows = group.flatMap((s) =>
    values.map((v) => ({ family_id: s.family_id, security_id: s.id, price_on: v.on, price: v.value })),
  );
  const { error } = await supabase.from('money_security_prices').upsert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
