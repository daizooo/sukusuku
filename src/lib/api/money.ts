import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables } from '@/types/supabase';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyCategoryKind,
  MoneyItem,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyRecurring,
  MoneyRecurringDraft,
  MoneyStore,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
} from '@/types/app';
import { DEFAULT_CATEGORIES, type StoreUse } from '@/lib/moneyUtils';

type CategoryRow = Tables<'money_categories'>;
type BudgetRow = Tables<'money_budgets'>;
type WalletRow = Tables<'money_wallets'>;
type StoreRow = Tables<'money_stores'>;
type RecordRow = Tables<'money_records'>;
type ItemRow = Tables<'money_items'>;
type RecurringRow = Tables<'money_recurring'>;
type BalanceRow = Tables<'money_wallet_balances'>;
type SupabaseDb = SupabaseClient<Database>;

// 家計タブの読み書き（種類・予算・出金元・記録。docs/kakei.md §3・§5）。
// mobile版の `mobile/src/lib/api/money.ts` と同じ。

export const rowToCategory = (row: CategoryRow): MoneyCategory => ({
  id: row.id,
  kind: row.kind === 'income' ? 'income' : 'living',
  parentId: row.parent_id,
  name: row.name,
  icon: row.icon ?? null,
  iconColor: row.icon_color ?? null,
  position: row.position,
  archived: row.archived_at !== null,
});

export const rowToBudget = (row: BudgetRow): MoneyBudget => ({
  id: row.id,
  categoryId: row.category_id,
  year: row.fiscal_year,
  // 古い行（month_amounts が無い）は、12か月ぜんぶが同じ額。
  monthAmounts:
    row.month_amounts !== null && row.month_amounts.length === 12
      ? row.month_amounts
      : Array.from({ length: 12 }, () => row.monthly_amount),
});

const WALLET_TYPES = ['card', 'cash', 'bank', 'prepaid', 'qr', 'securities'] as const;

export const rowToWallet = (row: WalletRow): MoneyWallet => ({
  id: row.id,
  name: row.name,
  type: WALLET_TYPES.find((type) => type === row.type) ?? 'cash',
  isSaving: row.is_saving,
  savingTarget: row.saving_target,
  closeDay: row.close_day,
  payDay: row.pay_day,
  payMonthOffset: row.pay_month_offset,
  payWalletId: row.pay_wallet_id,
  iconColor: row.icon_color,
  position: row.position,
  archived: row.archived_at !== null,
});

export const rowToBalance = (row: BalanceRow): MoneyWalletBalance => ({
  id: row.id,
  walletId: row.wallet_id,
  balanceOn: row.balance_on,
  amount: row.amount,
  showInHistory: row.show_in_history,
});

export const rowToStore = (row: StoreRow): MoneyStore => ({
  id: row.id,
  name: row.name,
  archived: row.archived_at !== null,
});

const rowToItem = (row: ItemRow): MoneyItem => ({
  id: row.id,
  amount: row.amount,
  categoryId: row.category_id,
  specialItemId: row.special_item_id,
  specialPlanId: row.special_plan_id,
  productId: row.product_id,
  quantity: row.quantity,
  unitPrice: row.unit_price,
  name: row.name,
  memo: row.memo,
});

export const rowToRecord = (row: RecordRow & { money_items: ItemRow[] }): MoneyRecord => ({
  id: row.id,
  kind: row.kind === 'income' ? 'income' : row.kind === 'transfer' ? 'transfer' : 'expense',
  occurredOn: row.occurred_on,
  walletId: row.wallet_id,
  toWalletId: row.to_wallet_id,
  store: row.store,
  createdBy: row.created_by,
  isEstimate: row.is_estimate,
  recurringId: row.recurring_id,
  month: row.month === null ? null : row.month.slice(0, 7),
  items: [...row.money_items].sort((a, b) => a.position - b.position).map(rowToItem),
});

const RECORD_KINDS = ['expense', 'income', 'transfer'] as const;
const HOLIDAY_RULES = ['next', 'prev', 'none'] as const;

export const rowToRecurring = (row: RecurringRow): MoneyRecurring => ({
  id: row.id,
  kind: RECORD_KINDS.find((kind) => kind === row.kind) ?? 'expense',
  day: row.day,
  months: row.months,
  holiday: HOLIDAY_RULES.find((rule) => rule === row.holiday) ?? 'next',
  amountMode: row.amount_mode === 'fixed' ? 'fixed' : 'estimate',
  amount: row.amount,
  walletId: row.wallet_id,
  toWalletId: row.to_wallet_id,
  store: row.store,
  categoryId: row.category_id,
  specialItemId: row.special_item_id,
  name: row.name,
  position: row.position,
  archived: row.archived_at !== null,
});

/** 一度に読む行数（Supabase の Data API は1回に1000行まで）。 */
const PAGE = 500;

/**
 * 家族の記録をすべて読む（古い順）。1ページ目で総数が分かるので、残りのページは並べて読む
 * （順に読むと、記録が増えるほど往復が増えて家計タブの表示が遅くなる）。
 */
async function loadRecords(supabase: SupabaseDb, familyId: string): Promise<MoneyRecord[]> {
  const readPage = (from: number) =>
    supabase
      .from('money_records')
      .select('*, money_items(*)', { count: 'exact' })
      .eq('family_id', familyId)
      .order('occurred_on', { ascending: true })
      .order('created_at', { ascending: true })
      // 同じ日時の記録があってもページをまたいで並びが変わらないよう、最後は id で決める。
      .order('id', { ascending: true })
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
  return rows.map(rowToRecord);
}

export interface MoneyData {
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  recurring: MoneyRecurring[];
  balances: MoneyWalletBalance[];
}

export async function loadMoney(supabase: SupabaseDb, familyId: string): Promise<MoneyData> {
  const [categoryResult, budgetResult, walletResult, storeResult, recurringResult, balanceResult, records] =
    await Promise.all([
      supabase.from('money_categories').select('*').eq('family_id', familyId),
      supabase.from('money_budgets').select('*').eq('family_id', familyId),
      supabase.from('money_wallets').select('*').eq('family_id', familyId).order('position', { ascending: true }),
      supabase.from('money_stores').select('*').eq('family_id', familyId),
      supabase.from('money_recurring').select('*').eq('family_id', familyId).order('position', { ascending: true }),
      supabase.from('money_wallet_balances').select('*').eq('family_id', familyId),
      loadRecords(supabase, familyId),
    ]);
  if (categoryResult.error) throw categoryResult.error;
  if (budgetResult.error) throw budgetResult.error;
  if (walletResult.error) throw walletResult.error;
  if (storeResult.error) throw storeResult.error;
  if (recurringResult.error) throw recurringResult.error;
  if (balanceResult.error) throw balanceResult.error;
  return {
    categories: (categoryResult.data ?? []).map(rowToCategory),
    budgets: (budgetResult.data ?? []).map(rowToBudget),
    wallets: (walletResult.data ?? []).map(rowToWallet),
    stores: (storeResult.data ?? []).map(rowToStore),
    records,
    recurring: (recurringResult.data ?? []).map(rowToRecurring),
    balances: (balanceResult.data ?? []).map(rowToBalance),
  };
}

// ---- 記録 ----

async function loadRecord(supabase: SupabaseDb, id: string): Promise<MoneyRecord> {
  const { data, error } = await supabase.from('money_records').select('*, money_items(*)').eq('id', id).single();
  if (error) throw error;
  return rowToRecord(data);
}

/** 記録（詳細＋品目）を保存する。品目はすべて入れ替わる（DBの save_money_record）。 */
export async function saveMoneyRecord(supabase: SupabaseDb, draft: MoneyRecordDraft): Promise<MoneyRecord> {
  const record: Json = {
    id: draft.id,
    kind: draft.kind,
    occurred_on: draft.occurredOn,
    wallet_id: draft.walletId,
    to_wallet_id: draft.kind === 'transfer' ? draft.toWalletId : null,
    store: draft.kind === 'transfer' ? '' : draft.store.trim(),
    register_store: draft.registerStore === true,
    is_estimate: draft.isEstimate,
  };
  const items: Json = draft.items.map((item) => ({
    amount: item.amount,
    category_id: item.categoryId,
    special_item_id: item.specialItemId,
    special_plan_id: item.specialPlanId,
    product_id: item.productId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    name: item.name.trim(),
    memo: item.memo.trim(),
  }));
  const { data, error } = await supabase.rpc('save_money_record', { p_record: record, p_items: items });
  if (error) throw error;
  return loadRecord(supabase, data);
}

export async function deleteMoneyRecord(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_records').delete().eq('id', id);
  if (error) throw error;
}

// ---- 種類・予算 ----

export async function insertMoneyCategory(
  supabase: SupabaseDb,
  familyId: string,
  fields: {
    kind: MoneyCategoryKind;
    parentId: string | null;
    name: string;
    icon: string | null;
    iconColor?: string | null;
    position: number;
  },
): Promise<MoneyCategory> {
  const { data, error } = await supabase
    .from('money_categories')
    .insert({
      family_id: familyId,
      kind: fields.kind,
      parent_id: fields.parentId,
      name: fields.name.trim(),
      icon: fields.icon,
      icon_color: fields.iconColor ?? null,
      position: fields.position,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToCategory(data);
}

export async function updateMoneyCategory(
  supabase: SupabaseDb,
  id: string,
  fields: { name?: string; icon?: string | null; iconColor?: string | null; position?: number; archived?: boolean },
): Promise<MoneyCategory> {
  const { data, error } = await supabase
    .from('money_categories')
    .update({
      ...(fields.name !== undefined && { name: fields.name.trim() }),
      ...(fields.icon !== undefined && { icon: fields.icon }),
      ...(fields.iconColor !== undefined && { icon_color: fields.iconColor }),
      ...(fields.position !== undefined && { position: fields.position }),
      ...(fields.archived !== undefined && { archived_at: fields.archived ? new Date().toISOString() : null }),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToCategory(data);
}

/**
 * 標準の種類（moneyUtils の DEFAULT_CATEGORIES）を入れる。種類がまだ無い家族向け。
 * 読み込みに失敗して種類が空に見えているときに押されても二重に入らないよう、DBに種類が1つでもあれば何も足さない
 * （2026-10-08に、プレビューで読み込みに失敗したまま押されて、標準の種類が2回入った）。
 */
export async function insertDefaultMoneyCategories(supabase: SupabaseDb, familyId: string): Promise<MoneyCategory[]> {
  const { count, error: countError } = await supabase
    .from('money_categories')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', familyId);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new Error('この家族にはもう種類があります');
  const { data: parents, error } = await supabase
    .from('money_categories')
    .insert(
      DEFAULT_CATEGORIES.map((category, index) => ({
        family_id: familyId,
        kind: category.kind,
        name: category.name,
        position: index,
      })),
    )
    .select('*');
  if (error) throw error;
  const byName = new Map((parents ?? []).map((row) => [`${row.kind}:${row.name}`, row.id]));
  const children = DEFAULT_CATEGORIES.flatMap((category) =>
    category.children.map((name, index) => ({
      family_id: familyId,
      kind: category.kind,
      parent_id: byName.get(`${category.kind}:${category.name}`)!,
      name,
      position: index,
    })),
  );
  const { data: childRows, error: childError } = await supabase.from('money_categories').insert(children).select('*');
  if (childError) throw childError;
  return [...(parents ?? []), ...(childRows ?? [])].map(rowToCategory);
}

/**
 * 大分類の、その年の1月〜12月の月額を保存する（DBの列名は fiscal_year のまま。中身は暦年）。
 * monthAmounts は長さ12（null の月は予算なし）。monthly_amount には12月の額を入れる（古いアプリはこの列だけを読む）。
 */
export async function saveMoneyBudget(
  supabase: SupabaseDb,
  familyId: string,
  categoryId: string,
  year: number,
  monthAmounts: readonly (number | null)[],
): Promise<MoneyBudget> {
  const { data, error } = await supabase
    .from('money_budgets')
    .upsert(
      {
        family_id: familyId,
        category_id: categoryId,
        fiscal_year: year,
        monthly_amount: monthAmounts[11] ?? 0,
        month_amounts: monthAmounts as number[],
      },
      { onConflict: 'category_id,fiscal_year' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return rowToBudget(data);
}

// ---- 出金元 ----

const walletFields = (draft: MoneyWalletDraft) => ({
  name: draft.name.trim(),
  type: draft.type,
  is_saving: draft.isSaving,
  saving_target: draft.isSaving ? draft.savingTarget : null,
  // 締め日・引き落とし日・引き落とし口座はカードだけ（docs/kakei.md §3.4）。
  close_day: draft.type === 'card' ? draft.closeDay : null,
  pay_day: draft.type === 'card' ? draft.payDay : null,
  pay_month_offset: draft.type === 'card' && draft.payDay !== null ? draft.payMonthOffset : null,
  pay_wallet_id: draft.type === 'card' ? draft.payWalletId : null,
  icon_color: draft.iconColor,
});

export async function insertMoneyWallet(
  supabase: SupabaseDb,
  familyId: string,
  draft: MoneyWalletDraft,
  position: number,
): Promise<MoneyWallet> {
  const { data, error } = await supabase
    .from('money_wallets')
    .insert({ ...walletFields(draft), family_id: familyId, position })
    .select('*')
    .single();
  if (error) throw error;
  return rowToWallet(data);
}

export async function updateMoneyWallet(
  supabase: SupabaseDb,
  id: string,
  draft: MoneyWalletDraft,
): Promise<MoneyWallet> {
  const { data, error } = await supabase.from('money_wallets').update(walletFields(draft)).eq('id', id).select('*').single();
  if (error) throw error;
  return rowToWallet(data);
}

/** 出金元を使わなくする（記録には残る）。 */
export async function archiveMoneyWallet(supabase: SupabaseDb, id: string): Promise<MoneyWallet> {
  const { data, error } = await supabase
    .from('money_wallets')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToWallet(data);
}

/** 使わなくした出金元をまた使う。 */
export async function restoreMoneyWallet(supabase: SupabaseDb, id: string): Promise<MoneyWallet> {
  const { data, error } = await supabase.from('money_wallets').update({ archived_at: null }).eq('id', id).select('*').single();
  if (error) throw error;
  return rowToWallet(data);
}

// ---- 確定した残高（docs/kakei.md §9.3） ----

/** 出金元の、その日の終わりの残高を確定する。同じ日の確定があれば上書きする。 */
export async function saveMoneyWalletBalance(
  supabase: SupabaseDb,
  familyId: string,
  walletId: string,
  balanceOn: string,
  amount: number,
  showInHistory: boolean,
): Promise<MoneyWalletBalance> {
  const { data: session } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('money_wallet_balances')
    .upsert(
      {
        family_id: familyId,
        wallet_id: walletId,
        balance_on: balanceOn,
        amount,
        show_in_history: showInHistory,
        created_by: session.session?.user.id ?? null,
      },
      { onConflict: 'wallet_id,balance_on' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return rowToBalance(data);
}

/** 確定した残高を取り消す（入れ間違い）。 */
export async function deleteMoneyWalletBalance(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_wallet_balances').delete().eq('id', id);
  if (error) throw error;
}

// ---- お店（設定データ。docs/kakei.md §3.5） ----

/** お店の設定を読み直す（記録の保存で「お店に登録して使う」を選んだお店が登録されたあとなど）。 */
export async function loadMoneyStores(supabase: SupabaseDb, familyId: string): Promise<MoneyStore[]> {
  const { data, error } = await supabase.from('money_stores').select('*').eq('family_id', familyId);
  if (error) throw error;
  return (data ?? []).map(rowToStore);
}

/**
 * 記録で使ったお店を読む（古い順。お店の無い記録は除く）。日用品の編集で、家計の記録と同じお店の候補を出すため。
 * 記録を丸ごと（品目つきで）読まず、お店と日付だけにする。1ページ目で総数が分かるので、残りは並べて読む。
 */
export async function loadStoreUses(supabase: SupabaseDb, familyId: string): Promise<StoreUse[]> {
  const readPage = (from: number) =>
    supabase
      .from('money_records')
      .select('store, occurred_on', { count: 'exact' })
      .eq('family_id', familyId)
      .neq('store', '')
      .order('occurred_on', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
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
  return rows.map((row) => ({ store: row.store, occurredOn: row.occurred_on }));
}

/** お店を足す。同じ名前が使わなくなっていれば、また使えるようにする。 */
export async function insertMoneyStore(supabase: SupabaseDb, familyId: string, name: string): Promise<MoneyStore> {
  const { data, error } = await supabase
    .from('money_stores')
    .upsert({ family_id: familyId, name: name.trim(), archived_at: null }, { onConflict: 'family_id,name' })
    .select('*')
    .single();
  if (error) throw error;
  return rowToStore(data);
}

/** お店の名前を直す。記録のお店の名前は変わらない（設定だけ直す）。 */
export async function renameMoneyStore(supabase: SupabaseDb, id: string, name: string): Promise<MoneyStore> {
  const { data, error } = await supabase.from('money_stores').update({ name: name.trim() }).eq('id', id).select('*').single();
  if (error) throw error;
  return rowToStore(data);
}

/** お店を使わなくする／また使う（記録には残る）。 */
export async function setMoneyStoreArchived(supabase: SupabaseDb, id: string, archived: boolean): Promise<MoneyStore> {
  const { data, error } = await supabase
    .from('money_stores')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToStore(data);
}

// ---- 毎月の記録のルール（docs/kakei.md §3.3） ----

const recurringFields = (draft: MoneyRecurringDraft) => ({
  kind: draft.kind,
  day: draft.day,
  months: draft.months,
  holiday: draft.holiday,
  amount_mode: draft.amountMode,
  amount: draft.amount,
  wallet_id: draft.walletId,
  to_wallet_id: draft.kind === 'transfer' ? draft.toWalletId : null,
  store: draft.kind === 'transfer' ? '' : draft.store.trim(),
  category_id: draft.kind === 'transfer' ? null : draft.categoryId,
  special_item_id: draft.kind === 'transfer' ? null : draft.specialItemId,
  name: draft.name.trim(),
});

export async function insertMoneyRecurring(
  supabase: SupabaseDb,
  familyId: string,
  draft: MoneyRecurringDraft,
  position: number,
): Promise<MoneyRecurring> {
  const { data, error } = await supabase
    .from('money_recurring')
    .insert({ ...recurringFields(draft), family_id: familyId, position })
    .select('*')
    .single();
  if (error) throw error;
  return rowToRecurring(data);
}

export async function updateMoneyRecurring(
  supabase: SupabaseDb,
  id: string,
  draft: MoneyRecurringDraft,
): Promise<MoneyRecurring> {
  const { data, error } = await supabase
    .from('money_recurring')
    .update(recurringFields(draft))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToRecurring(data);
}

/** ルールを使わなくする／また使う。作った記録はそのまま残る。 */
export async function setMoneyRecurringArchived(
  supabase: SupabaseDb,
  id: string,
  archived: boolean,
): Promise<MoneyRecurring> {
  const { data, error } = await supabase
    .from('money_recurring')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToRecurring(data);
}
