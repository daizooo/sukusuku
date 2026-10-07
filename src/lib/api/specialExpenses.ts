import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesUpdate } from '@/types/supabase';
import type {
  SpecialActual,
  SpecialActualDraft,
  SpecialItem,
  SpecialItemDraft,
  SpecialKind,
  SpecialPlan,
} from '@/types/app';

type ItemRow = Tables<'special_items'>;
type PlanRow = Tables<'special_plans'>;
type ActualRow = Tables<'special_actuals'>;
type SupabaseDb = SupabaseClient<Database>;

// 特別費の項目・予定・実績の読み書き（暮らしタブ。docs/home.md §5.4）。
// mobile版の `mobile/src/lib/api/specialExpenses.ts` と同じ。

const rowToPlan = (row: PlanRow): SpecialPlan => ({
  id: row.id,
  month: row.month,
  amount: row.amount,
  tentative: row.tentative,
});

const rowToItem = (row: ItemRow, plans: PlanRow[]): SpecialItem => ({
  id: row.id,
  kind: row.kind === 'income' ? 'income' : 'expense',
  category: row.category,
  name: row.name,
  cycleYears: row.cycle_years,
  baseYear: row.base_year,
  note: row.note,
  position: row.position,
  plans: plans.filter((plan) => plan.item_id === row.id).map(rowToPlan),
});

const rowToActual = (row: ActualRow): SpecialActual => ({
  id: row.id,
  itemId: row.item_id,
  planId: row.plan_id,
  occurredOn: row.occurred_on,
  amount: row.amount,
  note: row.note,
});

const itemFields = (draft: SpecialItemDraft): TablesUpdate<'special_items'> => ({
  kind: draft.kind,
  category: draft.category.trim(),
  name: draft.name.trim(),
  cycle_years: draft.cycleYears,
  // 毎年なら起点は任意（入れておけばその年度から数える）。
  base_year: draft.baseYear,
  note: draft.note.trim(),
});

export async function loadSpecialExpenses(
  supabase: SupabaseDb,
  familyId: string,
): Promise<{ items: SpecialItem[]; actuals: SpecialActual[] }> {
  const [itemResult, planResult, actualResult] = await Promise.all([
    supabase.from('special_items').select('*').eq('family_id', familyId).order('position', { ascending: true }),
    supabase.from('special_plans').select('*').eq('family_id', familyId),
    supabase.from('special_actuals').select('*').eq('family_id', familyId).order('occurred_on', { ascending: true }),
  ]);
  if (itemResult.error) throw itemResult.error;
  if (planResult.error) throw planResult.error;
  if (actualResult.error) throw actualResult.error;
  const plans = planResult.data ?? [];
  return {
    items: (itemResult.data ?? []).map((row) => rowToItem(row, plans)),
    actuals: (actualResult.data ?? []).map(rowToActual),
  };
}

/** 項目と予定を足す。 */
export async function insertSpecialItem(
  supabase: SupabaseDb,
  familyId: string,
  draft: SpecialItemDraft,
  position: number,
): Promise<SpecialItem> {
  const { data, error } = await supabase
    .from('special_items')
    .insert({ ...itemFields(draft), name: draft.name.trim(), family_id: familyId, position })
    .select('*')
    .single();
  if (error) throw error;

  if (draft.plans.length === 0) return rowToItem(data, []);
  const { data: planRows, error: planError } = await supabase
    .from('special_plans')
    .insert(
      draft.plans.map((plan) => ({
        family_id: familyId,
        item_id: data.id,
        month: plan.month,
        amount: plan.amount,
        tentative: plan.tentative,
      })),
    )
    .select('*');
  if (planError) {
    // 予定だけ入らなかった項目を残さない（残ると、行の無い項目になる）。
    await supabase.from('special_items').delete().eq('id', data.id);
    throw planError;
  }
  return rowToItem(data, planRows ?? []);
}

/**
 * 項目と予定を直す。予定は、残すもの（id がある）を更新し、無くなったものを消し、
 * 増えたもの（id が無い）を足す。実績のひも付きを保つため、予定を作り直さない。
 */
export async function updateSpecialItem(
  supabase: SupabaseDb,
  familyId: string,
  id: string,
  draft: SpecialItemDraft,
  currentPlans: readonly SpecialPlan[],
): Promise<SpecialItem> {
  const { data, error } = await supabase
    .from('special_items')
    .update(itemFields(draft))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;

  const keptIds = new Set(draft.plans.map((plan) => plan.id).filter((planId): planId is string => planId !== null));
  const removedIds = currentPlans.map((plan) => plan.id).filter((planId) => !keptIds.has(planId));
  if (removedIds.length > 0) {
    const { error: removeError } = await supabase.from('special_plans').delete().in('id', removedIds);
    if (removeError) throw removeError;
  }
  for (const plan of draft.plans.filter((entry) => entry.id !== null)) {
    const { error: updateError } = await supabase
      .from('special_plans')
      .update({ month: plan.month, amount: plan.amount, tentative: plan.tentative })
      .eq('id', plan.id!);
    if (updateError) throw updateError;
  }
  const added = draft.plans.filter((plan) => plan.id === null);
  if (added.length > 0) {
    const { error: insertError } = await supabase.from('special_plans').insert(
      added.map((plan) => ({
        family_id: familyId,
        item_id: id,
        month: plan.month,
        amount: plan.amount,
        tentative: plan.tentative,
      })),
    );
    if (insertError) throw insertError;
  }

  const { data: planRows, error: planError } = await supabase.from('special_plans').select('*').eq('item_id', id);
  if (planError) throw planError;
  return rowToItem(data, planRows ?? []);
}

/** 項目を消す。予定・実績もいっしょに消える（DBの on delete cascade）。 */
export async function deleteSpecialItem(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('special_items').delete().eq('id', id);
  if (error) throw error;
}

/** 実績を足す。planId があれば予定の実績（「済」）、無ければ予定外。 */
export async function insertSpecialActual(
  supabase: SupabaseDb,
  familyId: string,
  itemId: string,
  planId: string | null,
  draft: SpecialActualDraft,
): Promise<SpecialActual> {
  const { data, error } = await supabase
    .from('special_actuals')
    .insert({
      family_id: familyId,
      item_id: itemId,
      plan_id: planId,
      occurred_on: draft.occurredOn,
      amount: draft.amount,
      note: draft.note.trim(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToActual(data);
}

export async function updateSpecialActual(
  supabase: SupabaseDb,
  id: string,
  draft: SpecialActualDraft,
): Promise<SpecialActual> {
  const { data, error } = await supabase
    .from('special_actuals')
    .update({ occurred_on: draft.occurredOn, amount: draft.amount, note: draft.note.trim() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToActual(data);
}

export async function deleteSpecialActual(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('special_actuals').delete().eq('id', id);
  if (error) throw error;
}

/**
 * 予定外の出費（すでに払ったもの）を、予定の無い項目＋実績として足す。
 * 項目は「1回きり」で、実績の年度に出る（シートの「予算0・実績あり」と同じ）。
 */
export async function insertUnplannedSpecial(
  supabase: SupabaseDb,
  familyId: string,
  fields: { kind: SpecialKind; category: string; name: string },
  actual: SpecialActualDraft,
  fiscalYear: number,
  position: number,
): Promise<{ item: SpecialItem; actual: SpecialActual }> {
  const item = await insertSpecialItem(
    supabase,
    familyId,
    { ...fields, cycleYears: 0, baseYear: fiscalYear, note: '', plans: [] },
    position,
  );
  try {
    const created = await insertSpecialActual(supabase, familyId, item.id, null, actual);
    return { item, actual: created };
  } catch (error) {
    await supabase.from('special_items').delete().eq('id', item.id);
    throw error;
  }
}
