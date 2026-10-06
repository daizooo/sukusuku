import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesUpdate } from '@/types/supabase';
import type { StockItem, StockItemDraft, StockTarget, StockTargetDraft } from '@/types/app';
import { DEFAULT_STOCK_PLAN, type StockPlan } from '@/lib/stockUtils';

type StockItemRow = Tables<'stock_items'>;
type StockTargetRow = Tables<'stock_targets'>;
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
  targetId: row.target_id,
  amountPerUnit: Number(row.amount_per_unit),
});

const draftToRow = (draft: StockItemDraft): TablesUpdate<'stock_items'> => ({
  category: draft.category.trim(),
  name: draft.name.trim(),
  quantity: draft.quantity,
  unit: draft.unit.trim(),
  expires_on: draft.expiresOn,
  expires_month_only: draft.expiresOn !== null && draft.expiresMonthOnly,
  note: draft.note.trim(),
  target_id: draft.targetId,
  amount_per_unit: draft.amountPerUnit,
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

// ---- 必要数（目標。docs/home.md §3.5） ----

const rowToStockTarget = (row: StockTargetRow): StockTarget => ({
  id: row.id,
  category: row.category,
  name: row.name,
  quantity: Number(row.quantity),
  perPersonDay: row.per_person_day,
  unit: row.unit,
  note: row.note,
  position: row.position,
});

const targetDraftToRow = (draft: StockTargetDraft): TablesUpdate<'stock_targets'> => ({
  category: draft.category.trim(),
  name: draft.name.trim(),
  quantity: draft.quantity,
  per_person_day: draft.perPersonDay,
  unit: draft.unit.trim(),
  note: draft.note.trim(),
});

export async function loadStockTargets(supabase: SupabaseDb, familyId: string): Promise<StockTarget[]> {
  const { data, error } = await supabase
    .from('stock_targets')
    .select('*')
    .eq('family_id', familyId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToStockTarget);
}

export async function insertStockTarget(
  supabase: SupabaseDb,
  familyId: string,
  draft: StockTargetDraft,
  position: number,
): Promise<StockTarget> {
  const { data, error } = await supabase
    .from('stock_targets')
    .insert({ ...targetDraftToRow(draft), name: draft.name.trim(), family_id: familyId, position })
    .select('*')
    .single();
  if (error) throw error;
  return rowToStockTarget(data);
}

export async function updateStockTarget(
  supabase: SupabaseDb,
  id: string,
  draft: StockTargetDraft,
): Promise<StockTarget> {
  const { data, error } = await supabase
    .from('stock_targets')
    .update(targetDraftToRow(draft))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToStockTarget(data);
}

/** 目標を消すと、数えていたロットの target_id は null に戻る（DBの on delete set null）。 */
export async function deleteStockTarget(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('stock_targets').delete().eq('id', id);
  if (error) throw error;
}

/** 何人の何日分を備えるか（families.stock_people / stock_days）。 */
export async function loadStockPlan(supabase: SupabaseDb, familyId: string): Promise<StockPlan> {
  const { data, error } = await supabase
    .from('families')
    .select('stock_people, stock_days')
    .eq('id', familyId)
    .single();
  if (error) throw error;
  return data ? { people: data.stock_people, days: data.stock_days } : DEFAULT_STOCK_PLAN;
}

export async function updateStockPlan(supabase: SupabaseDb, familyId: string, plan: StockPlan): Promise<void> {
  const { error } = await supabase
    .from('families')
    .update({ stock_people: plan.people, stock_days: plan.days })
    .eq('id', familyId);
  if (error) throw error;
}
