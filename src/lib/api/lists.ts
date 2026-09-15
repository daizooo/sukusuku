import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/types/supabase';
import type { ListBoard, ListGroup, ListItem } from '@/types/app';

type ListRow = Tables<'lists'>;
type ListGroupRow = Tables<'list_groups'>;
type ListItemRow = Tables<'list_items'>;
type SupabaseDb = SupabaseClient<Database>;

// DBの行(snake_case) <-> アプリの型(camelCase) を変換する
const rowToList = (row: ListRow): ListBoard => ({
  id: row.id,
  name: row.name,
  groupLabel: row.group_label,
  pinned: row.is_pinned,
  position: row.position,
});

const rowToGroup = (row: ListGroupRow): ListGroup => ({
  id: row.id,
  listId: row.list_id,
  name: row.name,
  position: row.position,
});

const rowToItem = (row: ListItemRow): ListItem => ({
  id: row.id,
  listId: row.list_id,
  groupId: row.group_id,
  title: row.title,
  note: row.note ?? '',
  done: row.is_done,
  doneAt: row.done_at ? new Date(row.done_at) : null,
  position: row.position,
});

/**
 * リスト・グループ・項目をまとめて読む。
 * リストは多くても数個、項目もKeepの運用で数十件なので、
 * 切り替えのたびに取り直さず一度に読んで画面側で絞る。
 */
export interface ListsSnapshot {
  lists: ListBoard[];
  groups: ListGroup[];
  items: ListItem[];
}

export async function loadLists(supabase: SupabaseDb, familyId: string): Promise<ListsSnapshot> {
  const { data: listRows, error: listError } = await supabase
    .from('lists')
    .select('*')
    .eq('family_id', familyId)
    // 固定したリストが先。中は position の順（画面側の並びと同じ）。
    .order('is_pinned', { ascending: false })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (listError) throw listError;

  const lists = (listRows ?? []).map(rowToList);
  if (lists.length === 0) return { lists, groups: [], items: [] };

  const listIds = lists.map((list) => list.id);
  const [groupResult, itemResult] = await Promise.all([
    supabase
      .from('list_groups')
      .select('*')
      .in('list_id', listIds)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('list_items')
      .select('*')
      .in('list_id', listIds)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);
  if (groupResult.error) throw groupResult.error;
  if (itemResult.error) throw itemResult.error;

  return {
    lists,
    groups: (groupResult.data ?? []).map(rowToGroup),
    items: (itemResult.data ?? []).map(rowToItem),
  };
}

// ============================================================
// リスト
// ============================================================

export async function insertList(
  supabase: SupabaseDb,
  familyId: string,
  input: { name: string; groupLabel: string; position: number },
): Promise<ListBoard> {
  const row: TablesInsert<'lists'> = {
    family_id: familyId,
    name: input.name,
    group_label: input.groupLabel,
    position: input.position,
  };
  const { data, error } = await supabase.from('lists').insert(row).select('*').single();
  if (error) throw error;
  return rowToList(data);
}

export async function updateList(supabase: SupabaseDb, list: ListBoard): Promise<void> {
  const { error } = await supabase
    .from('lists')
    .update({ name: list.name, group_label: list.groupLabel, position: list.position })
    .eq('id', list.id);
  if (error) throw error;
}

/** 一覧の先頭に固定するかを切り替える。並び順（position）はそのまま残す。 */
export async function updateListPinned(supabase: SupabaseDb, id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('lists').update({ is_pinned: pinned }).eq('id', id);
  if (error) throw error;
}

/**
 * 並べ替えの保存。渡された順に position を 0,1,2... と振り直す。
 *
 * 件数はリストで数個・項目でも数十件なので、1件ずつ更新しても十分に速い。
 * まとめて upsert すると他の列まで送ることになり、同時に触った相手の
 * 変更を戻してしまうため採らない。
 */
async function updatePositions(
  supabase: SupabaseDb,
  table: 'lists' | 'list_groups' | 'list_items',
  orderedIds: string[],
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, position) => supabase.from(table).update({ position }).eq('id', id)),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

export function updateListPositions(supabase: SupabaseDb, orderedIds: string[]): Promise<void> {
  return updatePositions(supabase, 'lists', orderedIds);
}

export function updateGroupPositions(supabase: SupabaseDb, orderedIds: string[]): Promise<void> {
  return updatePositions(supabase, 'list_groups', orderedIds);
}

export function updateItemPositions(supabase: SupabaseDb, orderedIds: string[]): Promise<void> {
  return updatePositions(supabase, 'list_items', orderedIds);
}

/** リストを消すとグループ・項目も消える（外部キーの on delete cascade）。 */
export async function deleteList(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('lists').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
// グループ
// ============================================================

export async function insertGroup(
  supabase: SupabaseDb,
  input: { listId: string; name: string; position: number },
): Promise<ListGroup> {
  const row: TablesInsert<'list_groups'> = {
    list_id: input.listId,
    name: input.name,
    position: input.position,
  };
  const { data, error } = await supabase.from('list_groups').insert(row).select('*').single();
  if (error) throw error;
  return rowToGroup(data);
}

export async function updateGroupName(supabase: SupabaseDb, id: string, name: string): Promise<void> {
  const { error } = await supabase.from('list_groups').update({ name }).eq('id', id);
  if (error) throw error;
}

/**
 * グループを消す。中の項目は消さず未分類へ落ちる
 * （外部キーの on delete set null）。買い忘れを生まないため。
 */
export async function deleteGroup(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('list_groups').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
// 項目
// ============================================================

export async function insertItem(
  supabase: SupabaseDb,
  input: { listId: string; groupId: string | null; title: string; position: number },
): Promise<ListItem> {
  const row: TablesInsert<'list_items'> = {
    list_id: input.listId,
    group_id: input.groupId,
    title: input.title,
    position: input.position,
  };
  const { data, error } = await supabase.from('list_items').insert(row).select('*').single();
  if (error) throw error;
  return rowToItem(data);
}

/** 完了を切り替える。完了した時刻も一緒に持つ（あとで「よく買うもの」を出すため）。 */
export async function updateItemDone(
  supabase: SupabaseDb,
  id: string,
  done: boolean,
  doneAt: Date | null,
): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .update({ is_done: done, done_at: doneAt ? doneAt.toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function updateItem(supabase: SupabaseDb, item: ListItem): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .update({ title: item.title, note: item.note, group_id: item.groupId })
    .eq('id', item.id);
  if (error) throw error;
}

export async function deleteItem(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('list_items').delete().eq('id', id);
  if (error) throw error;
}

/** 完了した項目をまとめて消す。表示中のリストのぶんだけを対象にする。 */
export async function deleteDoneItems(supabase: SupabaseDb, listId: string): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .delete()
    .eq('list_id', listId)
    .eq('is_done', true);
  if (error) throw error;
}

/**
 * リストが1つも無いときに、いつも使う3つをまとめて作る。
 * グループはまだ作らない（使いながら必要なぶんだけ足すほうが、要らない区切りが残らない）。
 */
export async function seedDefaultLists(supabase: SupabaseDb, familyId: string): Promise<ListBoard[]> {
  const rows: TablesInsert<'lists'>[] = [
    { family_id: familyId, name: '買い出し', position: 0 },
    { family_id: familyId, name: 'やりたいこと', position: 1 },
    { family_id: familyId, name: 'やること', position: 2 },
  ];
  const { data, error } = await supabase.from('lists').insert(rows).select('*');
  if (error) throw error;
  return (data ?? []).map(rowToList);
}
