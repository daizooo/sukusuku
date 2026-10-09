import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { planShoppingAdd } from '@/lib/shoppingUtils';
import { insertItem } from '@/lib/api/lists';

type SupabaseDb = SupabaseClient<Database>;

// 買い出しリストへ送る（暮らしタブの防災備蓄の不足から。docs/home.md §4.2）。
// PWA版の `src/lib/api/shoppingList.ts` と同じ。

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
