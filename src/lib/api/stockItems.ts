import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesUpdate } from '@/types/supabase';
import type { StockItem, StockItemDraft } from '@/types/app';

type StockItemRow = Tables<'stock_items'>;
type SupabaseDb = SupabaseClient<Database>;

// 防災備蓄（暮らしタブ。docs/home.md §3）。mobile版の `mobile/src/lib/api/stockItems.ts` と同じ。

const rowToStockItem = (row: StockItemRow): StockItem => ({
  id: row.id,
  category: row.category,
  name: row.name,
  quantity: Number(row.quantity),
  unit: row.unit,
  expiresOn: row.expires_on,
  expiresMonthOnly: row.expires_month_only,
  note: row.note,
  position: row.position,
});

const draftToRow = (draft: StockItemDraft): TablesUpdate<'stock_items'> => ({
  category: draft.category.trim(),
  name: draft.name.trim(),
  quantity: draft.quantity,
  unit: draft.unit.trim(),
  expires_on: draft.expiresOn,
  expires_month_only: draft.expiresOn !== null && draft.expiresMonthOnly,
  note: draft.note.trim(),
});

/** 備蓄は数十行なので、一度に読んで並べ替え・絞り込みは画面側で行う。 */
export async function loadStockItems(supabase: SupabaseDb, familyId: string): Promise<StockItem[]> {
  const { data, error } = await supabase
    .from('stock_items')
    .select('*')
    .eq('family_id', familyId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToStockItem);
}

export async function insertStockItem(
  supabase: SupabaseDb,
  familyId: string,
  draft: StockItemDraft,
): Promise<StockItem> {
  const { data, error } = await supabase
    .from('stock_items')
    .insert({ ...draftToRow(draft), name: draft.name.trim(), family_id: familyId })
    .select('*')
    .single();
  if (error) throw error;
  return rowToStockItem(data);
}

export async function updateStockItem(
  supabase: SupabaseDb,
  id: string,
  draft: StockItemDraft,
): Promise<StockItem> {
  const { data, error } = await supabase
    .from('stock_items')
    .update(draftToRow(draft))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToStockItem(data);
}

export async function deleteStockItem(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('stock_items').delete().eq('id', id);
  if (error) throw error;
}
