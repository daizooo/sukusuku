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
type ValueRow = Tables<'money_holding_values'>;

const KINDS: MoneySecurityKind[] = ['us_stock', 'jp_fund', 'cash'];
const ACCOUNTS: MoneyHoldingAccount[] = ['nisa', 'nisa_tsumitate', 'tokutei', 'ippan'];

const rowToSecurity = (row: SecurityRow): MoneySecurity => ({
  id: row.id,
  name: row.name,
  kind: KINDS.find((kind) => kind === row.kind) ?? 'cash',
  code: row.code,
  fundCode: row.fund_code,
  currency: row.currency === 'USD' ? 'USD' : 'JPY',
  position: row.position,
  archived: row.archived_at !== null,
});

const rowToHolding = (row: HoldingRow): MoneyHolding => ({
  id: row.id,
  walletId: row.wallet_id,
  securityId: row.security_id,
  account: ACCOUNTS.find((account) => account === row.account) ?? 'tokutei',
  quantity: Number(row.quantity),
  costPrice: row.cost_price === null ? null : Number(row.cost_price),
  archived: row.archived_at !== null,
});

const rowToValue = (row: ValueRow): MoneyHoldingValue => ({
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

/** 家族の日々の評価額をすべて読む（保有ごとに1日1行。1年で数千行になる）。 */
async function loadValues(supabase: SupabaseDb, familyId: string): Promise<MoneyHoldingValue[]> {
  const values: MoneyHoldingValue[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('money_holding_values')
      .select('*')
      .eq('family_id', familyId)
      .order('value_on', { ascending: true })
      .order('holding_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    values.push(...(data ?? []).map(rowToValue));
    if (!data || data.length < PAGE) return values;
  }
}

export async function loadSecurities(supabase: SupabaseDb, familyId: string): Promise<MoneySecuritiesData> {
  const [securityResult, holdingResult, values] = await Promise.all([
    supabase.from('money_securities').select('*').eq('family_id', familyId).order('position', { ascending: true }),
    supabase.from('money_holdings').select('*').eq('family_id', familyId),
    loadValues(supabase, familyId),
  ]);
  if (securityResult.error) throw securityResult.error;
  if (holdingResult.error) throw holdingResult.error;
  return {
    securities: (securityResult.data ?? []).map(rowToSecurity),
    holdings: (holdingResult.data ?? []).map(rowToHolding),
    values,
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
