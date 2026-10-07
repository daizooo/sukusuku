import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesUpdate } from '@/types/supabase';
import type { HouseholdProduct, HouseholdProductDraft } from '@/types/app';
import { planShoppingAdd } from '@/lib/shoppingUtils';
import { insertItem } from '@/lib/api/lists';

type ProductRow = Tables<'household_products'>;
type SupabaseDb = SupabaseClient<Database>;

// 日用品の台帳と、買い出しリストへ送る（暮らしタブ。docs/home.md §4）。
// mobile版の `mobile/src/lib/api/householdProducts.ts` と同じ。

const rowToProduct = (row: ProductRow): HouseholdProduct => ({
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
