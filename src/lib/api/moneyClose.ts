import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/types/supabase';
import type { FamilyMember, MoneyMonthRequest, MoneyMonthWalletCheck } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

// 月の締めを夫婦で行う（docs/kakei.md §4.5。2026-10-24）。mobile版の `mobile/src/lib/api/moneyClose.ts` と同じ。
// - 振り返りの「この月を締める」で合図を出し（request_money_month_close）、夫婦が5分以内に押すと money_months.close_started_at が入る
// - 締めの画面では、口座ごとにひとりずつ OK を押す（money_month_wallet_checks。押したときの額を残す）


export interface MoneyCloseData {
  requests: MoneyMonthRequest[];
  checks: MoneyMonthWalletCheck[];
  /** 締めに加わる人（保護者のアカウント。夫婦）。 */
  guardians: FamilyMember[];
}

const rowToRequest = (row: Pick<Tables<'money_month_requests'>, 'month' | 'user_id' | 'requested_at'>): MoneyMonthRequest => ({
  month: row.month.slice(0, 7),
  userId: row.user_id,
  requestedAt: row.requested_at,
});

const rowToCheck = (row: Pick<Tables<'money_month_wallet_checks'>, 'month' | 'wallet_id' | 'user_id' | 'amount'>): MoneyMonthWalletCheck => ({
  month: row.month.slice(0, 7),
  walletId: row.wallet_id,
  userId: row.user_id,
  amount: row.amount,
});

export async function loadMoneyClose(supabase: SupabaseDb, familyId: string): Promise<MoneyCloseData> {
  const [requestResult, checkResult, memberResult] = await Promise.all([
    supabase.from('money_month_requests').select('month,user_id,requested_at').eq('family_id', familyId),
    supabase.from('money_month_wallet_checks').select('month,wallet_id,user_id,amount').eq('family_id', familyId),
    supabase
      .from('family_members')
      .select('user_id,given_name,display_name')
      .eq('family_id', familyId)
      .eq('is_guardian', true)
      .not('user_id', 'is', null)
      .order('sort_order', { ascending: true }),
  ]);
  if (requestResult.error) throw requestResult.error;
  if (checkResult.error) throw checkResult.error;
  if (memberResult.error) throw memberResult.error;
  return {
    requests: (requestResult.data ?? []).map(rowToRequest),
    checks: (checkResult.data ?? []).map(rowToCheck),
    guardians: (memberResult.data ?? []).flatMap((row) =>
      row.user_id ? [{ id: row.user_id, name: row.given_name || row.display_name }] : [],
    ),
  };
}

/** 「この月を締める」を押す。夫婦がそろって5分以内に押していれば、締めが始まる（started）。serverNow はサーバーの今。 */
export async function requestMonthClose(
  supabase: SupabaseDb,
  month: string,
): Promise<{ started: boolean; serverNow: string }> {
  const { data, error } = await supabase.rpc('request_money_month_close', { p_month: `${month}-01` });
  if (error) throw error;
  const result = (data ?? {}) as { started?: boolean; server_now?: string };
  return { started: result.started === true, serverNow: result.server_now ?? new Date().toISOString() };
}

/** 押した合図をやめる（行は消さず、requested_at を空にする）。 */
export async function cancelMonthClose(supabase: SupabaseDb, familyId: string, month: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('money_month_requests')
    .upsert({ family_id: familyId, month: `${month}-01`, user_id: userId, requested_at: null }, { onConflict: 'family_id,month,user_id' });
  if (error) throw error;
}

/** 口座の OK を押す（amount はそのときの額）／外す（null）。 */
export async function setMonthWalletCheck(
  supabase: SupabaseDb,
  familyId: string,
  check: MoneyMonthWalletCheck,
): Promise<void> {
  const { error } = await supabase.from('money_month_wallet_checks').upsert(
    {
      family_id: familyId,
      month: `${check.month}-01`,
      wallet_id: check.walletId,
      user_id: check.userId,
      amount: check.amount,
    },
    { onConflict: 'family_id,month,wallet_id,user_id' },
  );
  if (error) throw error;
}
