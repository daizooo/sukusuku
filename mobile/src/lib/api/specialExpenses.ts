import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesUpdate } from '@/types/supabase';
import type { SpecialItem, SpecialItemDraft, SpecialPlan } from '@/types/app';

type ItemRow = Tables<'special_items'>;
type PlanRow = Tables<'special_plans'>;
type SupabaseDb = SupabaseClient<Database>;

// 特別費の項目・予定の読み書き（家計の設定の「支出予定・収入予定」。docs/home.md §5.4・docs/kakei.md §3.5）。
// PWA版の `src/lib/api/specialExpenses.ts` と同じ。
//
// 実績は家計の記録の品目（money_items）のうち、特別費の項目（special_item_id）を持つもの。ここでは読み書きしない
// （払った額は家計の記録として入れる。振り返りの内訳から追う）。

const rowToPlan = (row: PlanRow): SpecialPlan => ({
  id: row.id,
  month: row.month,
  amount: row.amount,
  tentative: row.tentative,
});

export const rowToItem = (row: ItemRow, plans: PlanRow[]): SpecialItem => ({
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

const itemFields = (draft: SpecialItemDraft): TablesUpdate<'special_items'> => ({
  kind: draft.kind,
  category: draft.category.trim(),
  name: draft.name.trim(),
  cycle_years: draft.cycleYears,
  // 毎年なら起点は任意（入れておけばその年から数える）。
  base_year: draft.baseYear,
  note: draft.note.trim(),
});

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

/**
 * 項目を消す。予定・実績（品目）もいっしょに消える（DBの on delete cascade）。
 * 品目が無くなった記録も残さない（特別費の品目だけの記録）。
 */
export async function deleteSpecialItem(supabase: SupabaseDb, id: string): Promise<void> {
  const { data: linked, error: linkedError } = await supabase
    .from('money_items')
    .select('record_id')
    .eq('special_item_id', id);
  if (linkedError) throw linkedError;
  const { error } = await supabase.from('special_items').delete().eq('id', id);
  if (error) throw error;
  await deleteEmptyRecords(supabase, [...new Set((linked ?? []).map((row) => row.record_id))]);
}

/** 品目が1つも無くなった記録を消す。 */
async function deleteEmptyRecords(supabase: SupabaseDb, recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;
  const { data: remaining, error } = await supabase.from('money_items').select('record_id').in('record_id', recordIds);
  if (error) throw error;
  const kept = new Set((remaining ?? []).map((row) => row.record_id));
  const empty = recordIds.filter((recordId) => !kept.has(recordId));
  if (empty.length === 0) return;
  const { error: deleteError } = await supabase.from('money_records').delete().in('id', empty);
  if (deleteError) throw deleteError;
}
