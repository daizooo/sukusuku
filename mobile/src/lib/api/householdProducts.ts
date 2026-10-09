import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesUpdate } from '@/types/supabase';
import type { HouseholdProduct, HouseholdProductCategory, HouseholdProductDraft } from '@/types/app';
import { planShoppingAdd } from '@/lib/shoppingUtils';
import { resolveUnitPrice, type PurchaseLine } from '@/lib/productPurchases';
import { insertItem } from '@/lib/api/lists';

type ProductRow = Tables<'household_products'>;
type SupabaseDb = SupabaseClient<Database>;

// 日用品の台帳と、買い出しリストへ送る（暮らしタブ。docs/home.md §4）。
// PWA版の `src/lib/api/householdProducts.ts` と同じ。

export const rowToProduct = (row: ProductRow): HouseholdProduct => ({
  id: row.id,
  name: row.name,
  category: row.category,
  store: row.store,
  price: row.price,
  note: row.note,
  lastAddedAt: row.last_added_at,
  moneyCategoryId: row.money_category_id,
});

const draftToRow = (draft: HouseholdProductDraft): TablesUpdate<'household_products'> => ({
  name: draft.name.trim(),
  category: draft.category.trim(),
  store: draft.store.trim(),
  price: draft.price,
  note: draft.note.trim(),
});

export async function loadHouseholdProducts(supabase: SupabaseDb, familyId: string): Promise<HouseholdProduct[]> {
  const { data, error } = await supabase
    .from('household_products')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToProduct);
}

/**
 * 家族の台帳をRLSに任せて読む（family_id を持っていない画面から使う。リストの追加欄の候補）。
 * 見えるのは自分の家族の行だけ。
 */
export async function loadVisibleHouseholdProducts(supabase: SupabaseDb): Promise<HouseholdProduct[]> {
  const { data, error } = await supabase.from('household_products').select('*');
  if (error) throw error;
  return (data ?? []).map(rowToProduct);
}

export async function insertHouseholdProduct(
  supabase: SupabaseDb,
  familyId: string,
  draft: HouseholdProductDraft,
): Promise<HouseholdProduct> {
  const { data, error } = await supabase
    .from('household_products')
    .insert({ ...draftToRow(draft), name: draft.name.trim(), family_id: familyId })
    .select('*')
    .single();
  if (error) throw error;
  return rowToProduct(data);
}

export async function updateHouseholdProduct(
  supabase: SupabaseDb,
  id: string,
  draft: HouseholdProductDraft,
): Promise<HouseholdProduct> {
  const { data, error } = await supabase
    .from('household_products')
    .update(draftToRow(draft))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToProduct(data);
}

export async function deleteHouseholdProduct(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('household_products').delete().eq('id', id);
  if (error) throw error;
}

/** 送った時刻を残す（台帳の並びと、リストの追加欄の候補の順に使う）。 */
export async function markHouseholdProductAdded(supabase: SupabaseDb, id: string, at: Date): Promise<void> {
  const { error } = await supabase
    .from('household_products')
    .update({ last_added_at: at.toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** 家計の記録から読む、その品の買った記録の1行（docs/home.md §4.6）。 */
interface PurchaseRow {
  quantity: number;
  amount: number;
  unit_price: number | null;
  money_records: { occurred_on: string; store: string } | { occurred_on: string; store: string }[] | null;
}

/**
 * 品ごとの買った記録を読む（docs/home.md §4.6）。家計の品目のうち、台帳から選んだもの
 * （`product_id` がこの品）だけ。見込みの記録・支出以外の記録は数えない。品名の一致では拾わない。
 */
export async function loadProductPurchases(supabase: SupabaseDb, productId: string): Promise<PurchaseLine[]> {
  const { data, error } = await supabase
    .from('money_items')
    .select('quantity, amount, unit_price, money_records!inner(occurred_on, store)')
    .eq('product_id', productId)
    .eq('money_records.kind', 'expense')
    .eq('money_records.is_estimate', false);
  if (error) throw error;
  const lines: PurchaseLine[] = [];
  for (const row of (data ?? []) as PurchaseRow[]) {
    const record = Array.isArray(row.money_records) ? row.money_records[0] : row.money_records;
    if (!record) continue;
    lines.push({
      on: record.occurred_on,
      quantity: row.quantity,
      amount: row.amount,
      unitPrice: resolveUnitPrice(row.amount, row.quantity, row.unit_price),
      store: record.store,
    });
  }
  return lines;
}

export type ShoppingAddResult =
  | { status: 'added'; groupName: string | null }
  | { status: 'duplicate'; groupName: string | null };

/**
 * 買い出しリスト（listId）へ title を送る。store と同じ名前のグループがあればそこへ、
 * 無ければ未分類へ。まだ買っていない同じ項目が既にあれば入れない（docs/home.md §4.2）。
 */
export async function addToShoppingList(
  supabase: SupabaseDb,
  listId: string,
  title: string,
  store: string,
): Promise<ShoppingAddResult> {
  const [groupResult, itemResult] = await Promise.all([
    supabase.from('list_groups').select('id, name').eq('list_id', listId),
    supabase.from('list_items').select('group_id, title, is_done, position').eq('list_id', listId),
  ]);
  if (groupResult.error) throw groupResult.error;
  if (itemResult.error) throw itemResult.error;
  const plan = planShoppingAdd(
    groupResult.data ?? [],
    (itemResult.data ?? []).map((row) => ({
      groupId: row.group_id,
      title: row.title,
      done: row.is_done,
      position: row.position,
    })),
    title,
    store,
  );
  if (plan.kind === 'duplicate') return { status: 'duplicate', groupName: plan.groupName };
  await insertItem(supabase, { listId, groupId: plan.groupId, title: title.trim(), position: plan.position });
  return { status: 'added', groupName: plan.groupName };
}

// ---- カテゴリの一覧（docs/home.md §4.1。household_product_categories） ----
// 品は今までどおりカテゴリを名前の文字列で持つ。名前を直す・消すときは、同じ名前の品も書き換える。

export async function loadProductCategories(
  supabase: SupabaseDb,
  familyId: string,
): Promise<HouseholdProductCategory[]> {
  const { data, error } = await supabase
    .from('household_product_categories')
    .select('id, name, position')
    .eq('family_id', familyId)
    .order('position', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function insertProductCategory(
  supabase: SupabaseDb,
  familyId: string,
  name: string,
  position: number,
): Promise<HouseholdProductCategory> {
  const { data, error } = await supabase
    .from('household_product_categories')
    .insert({ family_id: familyId, name: name.trim(), position })
    .select('id, name, position')
    .single();
  if (error) throw error;
  return data;
}

/**
 * 名前を直す。同じ名前の品の category も書き換える。直した名前が一覧に既にあるときは、
 * そちらへまとめる（この行を消す）。
 */
export async function renameProductCategory(
  supabase: SupabaseDb,
  familyId: string,
  category: HouseholdProductCategory,
  name: string,
  existing: HouseholdProductCategory | null,
): Promise<void> {
  const trimmed = name.trim();
  if (existing) {
    const { error } = await supabase.from('household_product_categories').delete().eq('id', category.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('household_product_categories')
      .update({ name: trimmed })
      .eq('id', category.id);
    if (error) throw error;
  }
  const { error } = await supabase
    .from('household_products')
    .update({ category: trimmed })
    .eq('family_id', familyId)
    .eq('category', category.name);
  if (error) throw error;
}

/** 消す。このカテゴリの品は「なし」（空）にする。 */
export async function deleteProductCategory(
  supabase: SupabaseDb,
  familyId: string,
  category: HouseholdProductCategory,
): Promise<void> {
  const { error } = await supabase.from('household_product_categories').delete().eq('id', category.id);
  if (error) throw error;
  const { error: productError } = await supabase
    .from('household_products')
    .update({ category: '' })
    .eq('family_id', familyId)
    .eq('category', category.name);
  if (productError) throw productError;
}

/** 並びを保存する（渡した順に 0, 1, 2…）。 */
export async function reorderProductCategories(
  supabase: SupabaseDb,
  categories: HouseholdProductCategory[],
): Promise<void> {
  const results = await Promise.all(
    categories.map((category, position) =>
      supabase.from('household_product_categories').update({ position }).eq('id', category.id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}
