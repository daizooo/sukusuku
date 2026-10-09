import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/types/supabase';
import type { HouseholdProduct, MoneySecuritiesData, SpecialItem } from '@/types/app';
import {
  rowToBalance,
  rowToBudget,
  rowToCategory,
  rowToRecord,
  rowToRecurring,
  rowToStore,
  rowToWallet,
  type MoneyData,
} from '@/lib/api/money';
import { loadSecurityHistory, rowToHolding, rowToSecurity, rowToValue } from '@/lib/api/moneySecurities';
import { rowToProduct } from '@/lib/api/householdProducts';
import { rowToItem as rowToSpecialItem } from '@/lib/api/specialExpenses';

type SupabaseDb = SupabaseClient<Database>;

// 家計タブの起動で読むものを、DBの関数 money_bootstrap(p_family_id)（0076）で1回にまとめて読む（docs/kakei.md §9.2.6）。
// mobile版 の `mobile/src/lib/api/moneyBootstrap.ts` と同じ。
// 種類・予算・出金元・お店・定期・残高・記録（品目つき）・日用品の台帳・特別費の項目と予定・証券の銘柄と保有・
// 保有ごとの最新の評価額を、表の行そのままの JSON で返すので、行 → 画面の型への変換は個別に読むときと同じものを使う。

export interface MoneyBootstrap {
  money: MoneyData;
  products: HouseholdProduct[];
  special: SpecialItem[];
  securities: MoneySecuritiesData;
}

type RpcRows = Record<string, unknown[]>;
type SecurityValueRow = Parameters<typeof rowToValue>[0];

/**
 * 家計タブの起動で読むものをすべて読む。評価額の履歴は返さない（推移を開いたときに読む）。
 * withHistory が true のとき（履歴を読んだあとの読み直し）だけ、履歴も並べて読む。履歴が読めなかったときは
 * 最新の1行だけにして、historyLoaded を false にする（推移を開き直すと読み直す）。
 */
export async function loadMoneyBootstrap(
  supabase: SupabaseDb,
  familyId: string,
  withHistory = false,
): Promise<MoneyBootstrap> {
  const [rpc, history] = await Promise.all([
    supabase.rpc('money_bootstrap', { p_family_id: familyId }),
    withHistory ? loadSecurityHistory(supabase, familyId).catch(() => null) : Promise.resolve(null),
  ]);
  if (rpc.error) throw rpc.error;
  const data = rpc.data as unknown as RpcRows;
  const rows = <T>(key: string) => (data[key] ?? []) as T[];

  const planRows = rows<Tables<'special_plans'>>('special_plans');
  return {
    money: {
      categories: rows<Tables<'money_categories'>>('categories').map(rowToCategory),
      budgets: rows<Tables<'money_budgets'>>('budgets').map(rowToBudget),
      wallets: rows<Tables<'money_wallets'>>('wallets').map(rowToWallet),
      stores: rows<Tables<'money_stores'>>('stores').map(rowToStore),
      records: rows<Parameters<typeof rowToRecord>[0]>('records').map(rowToRecord),
      recurring: rows<Tables<'money_recurring'>>('recurring').map(rowToRecurring),
      balances: rows<Tables<'money_wallet_balances'>>('balances').map(rowToBalance),
    },
    products: rows<Tables<'household_products'>>('products').map(rowToProduct),
    special: rows<Tables<'special_items'>>('special_items').map((row) => rowToSpecialItem(row, planRows)),
    securities: {
      securities: rows<Tables<'money_securities'>>('securities').map(rowToSecurity),
      holdings: rows<Tables<'money_holdings'>>('holdings').map(rowToHolding),
      values: history ?? rows<SecurityValueRow>('latest_values').map(rowToValue),
      historyLoaded: history !== null,
    },
  };
}
