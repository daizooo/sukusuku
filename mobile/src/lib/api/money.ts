import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables } from '@/types/supabase';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyCategoryKind,
  MoneyItem,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyWallet,
  MoneyWalletDraft,
} from '@/types/app';
import { DEFAULT_CATEGORIES } from '@/lib/moneyUtils';

type CategoryRow = Tables<'money_categories'>;
type BudgetRow = Tables<'money_budgets'>;
type WalletRow = Tables<'money_wallets'>;
type RecordRow = Tables<'money_records'>;
type ItemRow = Tables<'money_items'>;
type SupabaseDb = SupabaseClient<Database>;

// 家計タブの読み書き（種類・予算・出金元・記録。docs/kakei.md §3・§5）。
// PWA版の `src/lib/api/money.ts` と同じ。

const rowToCategory = (row: CategoryRow): MoneyCategory => ({
  id: row.id,
  kind: row.kind === 'income' ? 'income' : 'living',
  parentId: row.parent_id,
  name: row.name,
  position: row.position,
  archived: row.archived_at !== null,
});

const rowToBudget = (row: BudgetRow): MoneyBudget => ({
  id: row.id,
  categoryId: row.category_id,
  fiscalYear: row.fiscal_year,
  monthlyAmount: row.monthly_amount,
});

const WALLET_TYPES = ['card', 'cash', 'bank', 'prepaid', 'qr'] as const;

const rowToWallet = (row: WalletRow): MoneyWallet => ({
  id: row.id,
  name: row.name,
  type: WALLET_TYPES.find((type) => type === row.type) ?? 'cash',
  isSaving: row.is_saving,
  savingTarget: row.saving_target,
  position: row.position,
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

const rowToRecord = (row: RecordRow & { money_items: ItemRow[] }): MoneyRecord => ({
  id: row.id,
  kind: row.kind === 'income' ? 'income' : row.kind === 'transfer' ? 'transfer' : 'expense',
  occurredOn: row.occurred_on,
  walletId: row.wallet_id,
  toWalletId: row.to_wallet_id,
  store: row.store,
  createdBy: row.created_by,
  items: [...row.money_items].sort((a, b) => a.position - b.position).map(rowToItem),
});

/** 一度に読む行数（Supabase の Data API は1回に1000行まで）。 */
const PAGE = 500;

/** 家族の記録をすべて読む（古い順）。 */
async function loadRecords(supabase: SupabaseDb, familyId: string): Promise<MoneyRecord[]> {
  const records: MoneyRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('money_records')
      .select('*, money_items(*)')
      .eq('family_id', familyId)
      .order('occurred_on', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    records.push(...(data ?? []).map(rowToRecord));
    if (!data || data.length < PAGE) return records;
  }
}

export interface MoneyData {
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  records: MoneyRecord[];
}

export async function loadMoney(supabase: SupabaseDb, familyId: string): Promise<MoneyData> {
  const [categoryResult, budgetResult, walletResult, records] = await Promise.all([
    supabase.from('money_categories').select('*').eq('family_id', familyId),
    supabase.from('money_budgets').select('*').eq('family_id', familyId),
    supabase.from('money_wallets').select('*').eq('family_id', familyId).order('position', { ascending: true }),
    loadRecords(supabase, familyId),
  ]);
  if (categoryResult.error) throw categoryResult.error;
  if (budgetResult.error) throw budgetResult.error;
  if (walletResult.error) throw walletResult.error;
  return {
    categories: (categoryResult.data ?? []).map(rowToCategory),
    budgets: (budgetResult.data ?? []).map(rowToBudget),
    wallets: (walletResult.data ?? []).map(rowToWallet),
    records,
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
  fields: { kind: MoneyCategoryKind; parentId: string | null; name: string; position: number },
): Promise<MoneyCategory> {
  const { data, error } = await supabase
    .from('money_categories')
    .insert({
      family_id: familyId,
      kind: fields.kind,
      parent_id: fields.parentId,
      name: fields.name.trim(),
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
  fields: { name?: string; position?: number; archived?: boolean },
): Promise<MoneyCategory> {
  const { data, error } = await supabase
    .from('money_categories')
    .update({
      ...(fields.name !== undefined && { name: fields.name.trim() }),
      ...(fields.position !== undefined && { position: fields.position }),
      ...(fields.archived !== undefined && { archived_at: fields.archived ? new Date().toISOString() : null }),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToCategory(data);
}

/** 標準の種類（moneyUtils の DEFAULT_CATEGORIES）を入れる。種類がまだ無い家族向け。 */
export async function insertDefaultMoneyCategories(supabase: SupabaseDb, familyId: string): Promise<MoneyCategory[]> {
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

/** 大分類の、その年度の月の予算を決める。 */
export async function saveMoneyBudget(
  supabase: SupabaseDb,
  familyId: string,
  categoryId: string,
  fiscalYear: number,
  monthlyAmount: number,
): Promise<MoneyBudget> {
  const { data, error } = await supabase
    .from('money_budgets')
    .upsert(
      { family_id: familyId, category_id: categoryId, fiscal_year: fiscalYear, monthly_amount: monthlyAmount },
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
