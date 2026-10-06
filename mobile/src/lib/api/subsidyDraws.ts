import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/types/supabase';
import type { SubsidyDraw, SubsidyDrawDraft, SubsidyPrizeId } from '@/types/app';

type DrawRow = Tables<'subsidy_draws'>;
type SupabaseDb = SupabaseClient<Database>;

// 補助くじの記録（暮らしタブ。docs/home.md §9）。
// PWA版の `src/lib/api/subsidyDraws.ts` と同じ。

const rowToDraw = (row: DrawRow): SubsidyDraw => ({
  id: row.id,
  drawnBy: row.drawn_by,
  itemName: row.item_name,
  price: row.price,
  prize: row.prize as SubsidyPrizeId,
  subsidy: row.subsidy,
  drawnAt: row.drawn_at,
});

/** 履歴に出す件数の上限。月2回×2人なら年間で約50件。 */
const HISTORY_LIMIT = 100;

/** 家族の記録を新しい順に読む。 */
export async function loadSubsidyDraws(supabase: SupabaseDb, familyId: string): Promise<SubsidyDraw[]> {
  const { data, error } = await supabase
    .from('subsidy_draws')
    .select('*')
    .eq('family_id', familyId)
    .order('drawn_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? []).map(rowToDraw);
}

/**
 * くじの結果を記録する。1人あたり月2回までの上限は、DBのトリガーでも守られる
 * （上限を超えると失敗する）。結果を見せる前に必ず記録して、引き直しを防ぐ。
 */
export async function insertSubsidyDraw(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
  draft: SubsidyDrawDraft,
): Promise<SubsidyDraw> {
  const { data, error } = await supabase
    .from('subsidy_draws')
    .insert({
      family_id: familyId,
      drawn_by: userId,
      item_name: draft.itemName.trim(),
      price: draft.price,
      prize: draft.prize,
      subsidy: draft.subsidy,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToDraw(data);
}
