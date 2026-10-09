import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/types/supabase';
import type {
  MoneyHolding,
  MoneyHoldingAccount,
  MoneyHoldingValue,
  MoneySecuritiesData,
  MoneySecurity,
  MoneySecurityDraft,
  MoneySecurityKind,
} from '@/types/app';

// 証券の銘柄・保有・日々の評価額（docs/kakei.md §9.2）。
// PWA版の `src/lib/api/moneySecurities.ts` と同じ。
// 価格と評価額はサーバー（Edge Function fetch-security-prices・pg_cron）が作るので、ここでは読むだけ。
// 銘柄を足したとき（コードを変えたとき）は、関数に過去1年の価格と評価額を作らせる。

type SupabaseDb = SupabaseClient<Database>;
type SecurityRow = Tables<'money_securities'>;
type HoldingRow = Tables<'money_holdings'>;
type ValueRow = Pick<Tables<'money_holding_values'>, 'holding_id' | 'value_on' | 'quantity' | 'price' | 'fx' | 'value' | 'cost'>;

const KINDS: MoneySecurityKind[] = ['us_stock', 'jp_fund', 'cash'];
const ACCOUNTS: MoneyHoldingAccount[] = ['nisa', 'nisa_tsumitate', 'tokutei', 'ippan'];

export const rowToSecurity = (row: SecurityRow): MoneySecurity => ({
  id: row.id,
  name: row.name,
  kind: KINDS.find((kind) => kind === row.kind) ?? 'cash',
  code: row.code,
  fundCode: row.fund_code,
  currency: row.currency === 'USD' ? 'USD' : 'JPY',
  position: row.position,
  archived: row.archived_at !== null,
});

export const rowToHolding = (row: HoldingRow): MoneyHolding => ({
  id: row.id,
  walletId: row.wallet_id,
  securityId: row.security_id,
  account: ACCOUNTS.find((account) => account === row.account) ?? 'tokutei',
  quantity: Number(row.quantity),
  costPrice: row.cost_price === null ? null : Number(row.cost_price),
  archived: row.archived_at !== null,
});

export const rowToValue = (row: ValueRow): MoneyHoldingValue => ({
  holdingId: row.holding_id,
  valueOn: row.value_on,
  quantity: Number(row.quantity),
  price: Number(row.price),
  fx: Number(row.fx),
  value: Number(row.value),
  cost: row.cost === null ? null : Number(row.cost),
});

/** 一度に読む行数（Supabase の Data API は1回に1000行まで）。 */
const PAGE = 1000;

/** 推移に要る列だけ読む（family_id・created_at は使わない）。 */
const VALUE_COLUMNS = 'holding_id, value_on, quantity, price, fx, value, cost';

/**
 * 家族の日々の評価額をすべて読む（保有ごとに1日1行。1年で数千行になる）。
 * 1ページ目で総数が分かるので、残りのページは並べて読む（順番に読むと往復が行数に比例して増える）。
 */
export async function loadSecurityHistory(supabase: SupabaseDb, familyId: string): Promise<MoneyHoldingValue[]> {
  const readPage = (from: number) =>
    supabase
      .from('money_holding_values')
      .select(VALUE_COLUMNS, { count: 'exact' })
      .eq('family_id', familyId)
      // (value_on, holding_id) は主キーの一部なので、ページをまたいでも並びが変わらない。
      .order('value_on', { ascending: true })
      .order('holding_id', { ascending: true })
      .range(from, from + PAGE - 1);

  const first = await readPage(0);
  if (first.error) throw first.error;
  const total = first.count ?? 0;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, index) => readPage((index + 1) * PAGE)),
  );
  const rows = [...(first.data ?? [])];
  for (const page of rest) {
    if (page.error) throw page.error;
    rows.push(...(page.data ?? []));
  }
  return rows.map(rowToValue);
}

/** 保有ごとの最新の評価額の1行（口座の一覧の残高用。DBの money_latest_holding_values）。 */
async function loadLatestValues(supabase: SupabaseDb, familyId: string): Promise<MoneyHoldingValue[]> {
  const { data, error } = await supabase.rpc('money_latest_holding_values', { p_family_id: familyId });
  if (error) throw error;
  return (data ?? []).map(rowToValue);
}

/**
 * 銘柄・保有と日々の評価額を読む。評価額は、はじめは保有ごとの最新の1行だけ（口座の一覧が早く出るように）。
 * 推移・銘柄の詳細を開くときに、withHistory を true にするか loadSecurityHistory で履歴まで読む。
 */
export async function loadSecurities(
  supabase: SupabaseDb,
  familyId: string,
  withHistory = false,
): Promise<MoneySecuritiesData> {
  const [securityResult, holdingResult, values] = await Promise.all([
    supabase.from('money_securities').select('*').eq('family_id', familyId).order('position', { ascending: true }),
    supabase.from('money_holdings').select('*').eq('family_id', familyId),
    withHistory ? loadSecurityHistory(supabase, familyId) : loadLatestValues(supabase, familyId),
  ]);
  if (securityResult.error) throw securityResult.error;
  if (holdingResult.error) throw holdingResult.error;
  return {
    securities: (securityResult.data ?? []).map(rowToSecurity),
    holdings: (holdingResult.data ?? []).map(rowToHolding),
    values,
    historyLoaded: withHistory,
  };
}

/**
 * 銘柄を保存する（target が null なら足す）。保有は預り区分ごとに、保有数があれば入れ、
 * 0 にした区分は使わなくする（その日から評価額 0。前の日の評価額は残る）。
 * 戻り値は、過去1年の価格と評価額を作り直す必要があるか（足したとき・コードを変えたとき）。
 */
export async function saveSecurity(
  supabase: SupabaseDb,
  familyId: string,
  walletId: string,
  target: MoneySecurity | null,
  draft: MoneySecurityDraft,
  holdings: readonly MoneyHolding[],
  position: number,
): Promise<{ securityId: string; needsBackfill: boolean }> {
  const fields = {
    name: draft.name,
    kind: draft.kind,
    code: draft.kind === 'cash' ? null : draft.code,
    fund_code: draft.kind === 'jp_fund' ? draft.fundCode : null,
    currency: draft.currency,
  };
  let securityId: string;
  if (target === null) {
    const { data, error } = await supabase
      .from('money_securities')
      .insert({ ...fields, family_id: familyId, position })
      .select('id')
      .single();
    if (error) throw error;
    securityId = data.id;
  } else {
    // 使わなくした銘柄に保有を足し直したときのために、また使うにする。
    const { error } = await supabase.from('money_securities').update({ ...fields, archived_at: null }).eq('id', target.id);
    if (error) throw error;
    securityId = target.id;
  }

  const now = new Date().toISOString();
  for (const entry of draft.holdings) {
    const existing = holdings.find(
      (holding) => holding.walletId === walletId && holding.securityId === securityId && holding.account === entry.account,
    );
    if (entry.quantity > 0) {
      const { error } = await supabase.from('money_holdings').upsert(
        {
          family_id: familyId,
          wallet_id: walletId,
          security_id: securityId,
          account: entry.account,
          quantity: entry.quantity,
          cost_price: draft.kind === 'cash' ? null : entry.costPrice,
          archived_at: null,
        },
        { onConflict: 'wallet_id,security_id,account' },
      );
      if (error) throw error;
    } else if (existing && !existing.archived) {
      const { error } = await supabase.from('money_holdings').update({ archived_at: now }).eq('id', existing.id);
      if (error) throw error;
    }
  }

  const needsBackfill =
    target === null || target.kind !== draft.kind || target.code !== fields.code || target.fundCode !== fields.fund_code;
  return { securityId, needsBackfill };
}

/** 銘柄を使わなくする（売った。その口座の保有もすべて使わなくする）。過去の評価額は残る。 */
export async function archiveSecurity(supabase: SupabaseDb, walletId: string, security: MoneySecurity): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('money_holdings')
    .update({ archived_at: now })
    .eq('wallet_id', walletId)
    .eq('security_id', security.id)
    .is('archived_at', null);
  if (error) throw error;
  // ほかの口座で持っていなければ、銘柄も使わなくする（毎朝の価格の取得から外れる）。
  const { count, error: countError } = await supabase
    .from('money_holdings')
    .select('id', { count: 'exact', head: true })
    .eq('security_id', security.id)
    .is('archived_at', null);
  if (countError) throw countError;
  if ((count ?? 0) === 0) {
    const { error: archiveError } = await supabase.from('money_securities').update({ archived_at: now }).eq('id', security.id);
    if (archiveError) throw archiveError;
  }
}

/** 銘柄の過去1年の価格を取り、評価額を作る（Edge Function fetch-security-prices）。 */
export async function requestSecurityBackfill(supabase: SupabaseDb, securityId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('fetch-security-prices', { body: { security_id: securityId } });
  if (error) throw error;
}
