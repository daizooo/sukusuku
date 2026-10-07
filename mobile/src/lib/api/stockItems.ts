import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesUpdate } from '@/types/supabase';
import type { StockItem, StockItemDraft, StockTarget, StockTargetDraft } from '@/types/app';
import { DEFAULT_STOCK_PLAN, jstDateOf, type StockPlan } from '@/lib/stockUtils';

type StockItemRow = Tables<'stock_items'>;
type StockTargetRow = Tables<'stock_targets'>;
type SupabaseDb = SupabaseClient<Database>;

// 防災備蓄（暮らしタブ。docs/home.md §3）。PWA版の `src/lib/api/stockItems.ts` と同じ。

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
  storage: row.storage === 'carry' ? 'carry' : 'home',
  // migration 0062 の適用前は、これらの列が返らない（undefined）。null として扱って壊れないようにする。
  inspectedOn: row.inspected_on ?? null,
  inspectIntervalMonths: row.inspect_interval_months ?? null,
  createdOn: jstDateOf(row.created_at),
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
  storage: draft.storage,
  inspected_on: draft.inspectedOn,
  inspect_interval_months: draft.inspectIntervalMonths,
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

/** 行から、保存に渡す形（id・並び順を除いたもの）を作る。 */
export const toDraft = (item: StockItem): StockItemDraft => ({
  category: item.category,
  name: item.name,
  quantity: item.quantity,
  unit: item.unit,
  expiresOn: item.expiresOn,
  expiresMonthOnly: item.expiresMonthOnly,
  note: item.note,
  targetId: item.targetId,
  amountPerUnit: item.amountPerUnit,
  storage: item.storage,
  inspectedOn: item.inspectedOn,
  inspectIntervalMonths: item.inspectIntervalMonths,
});

/**
 * ロットの一部（count個）を別の保管場所へ移す（docs/home.md §3.6）。全部なら場所を書き換えるだけ。
 * 一部なら元の数を減らし、移した先に同じ品名・期限・数え先のロットがあればそこへ足し、
 * 無ければ新しいロットを作る。返すのは書き換えたあとの行（消えた行は含まない）。
 */
export async function moveStockItem(
  supabase: SupabaseDb,
  familyId: string,
  item: StockItem,
  count: number,
  to: StockItem['storage'],
  items: StockItem[],
): Promise<{ updated: StockItem[]; removedIds: string[] }> {
  const draft = toDraft(item);
  const moveAll = count >= item.quantity;
  const merge = items.find(
    (other) =>
      other.id !== item.id &&
      other.storage === to &&
      other.name === item.name &&
      other.expiresOn === item.expiresOn &&
      other.targetId === item.targetId &&
      other.amountPerUnit === item.amountPerUnit &&
      other.unit === item.unit,
  );
  if (merge) {
    const merged = await updateStockItem(supabase, merge.id, { ...toDraft(merge), quantity: merge.quantity + count });
    if (moveAll) {
      await deleteStockItem(supabase, item.id);
      return { updated: [merged], removedIds: [item.id] };
    }
    const rest = await updateStockItem(supabase, item.id, { ...draft, quantity: item.quantity - count });
    return { updated: [merged, rest], removedIds: [] };
  }
  if (moveAll) {
    const moved = await updateStockItem(supabase, item.id, { ...draft, storage: to });
    return { updated: [moved], removedIds: [] };
  }
  const rest = await updateStockItem(supabase, item.id, { ...draft, quantity: item.quantity - count });
  const created = await insertStockItem(supabase, familyId, { ...draft, quantity: count, storage: to });
  return { updated: [rest, created], removedIds: [] };
}

/** 数だけを書き換える（「食べた・使った」の −1）。 */
export async function setStockQuantity(supabase: SupabaseDb, id: string, quantity: number): Promise<void> {
  const { error } = await supabase.from('stock_items').update({ quantity }).eq('id', id);
  if (error) throw error;
}

/** 点検した日をまとめて記録する（持ち出しバッグ・備品の一括点検。docs/home.md §10.2）。 */
export async function markStockInspected(supabase: SupabaseDb, ids: string[], on: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('stock_items').update({ inspected_on: on }).in('id', ids);
  if (error) throw error;
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
  carry: row.carry,
  unit: row.unit,
  note: row.note,
  position: row.position,
});

const targetDraftToRow = (draft: StockTargetDraft): TablesUpdate<'stock_targets'> => ({
  category: draft.category.trim(),
  name: draft.name.trim(),
  quantity: draft.quantity,
  per_person_day: draft.perPersonDay,
  carry: draft.carry,
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

/** 何人の何日分を備えるか（families.stock_people / stock_days）と、持ち出しの日数（stock_carry_days）。 */
export async function loadStockPlan(supabase: SupabaseDb, familyId: string): Promise<StockPlan> {
  const { data, error } = await supabase
    .from('families')
    .select('stock_people, stock_days, stock_carry_days')
    .eq('id', familyId)
    .single();
  if (error) throw error;
  return data
    ? { people: data.stock_people, days: data.stock_days, carryDays: data.stock_carry_days }
    : DEFAULT_STOCK_PLAN;
}

export async function updateStockPlan(supabase: SupabaseDb, familyId: string, plan: StockPlan): Promise<void> {
  const { error } = await supabase
    .from('families')
    .update({ stock_people: plan.people, stock_days: plan.days, stock_carry_days: plan.carryDays })
    .eq('id', familyId);
  if (error) throw error;
}
