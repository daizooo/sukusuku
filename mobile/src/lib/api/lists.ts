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
  isPrivate: row.is_private,
  createdBy: row.created_by,
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
  // グループと項目は、リストの一覧を待たずに並べて読む（待つと往復が1つ増える）。
  // 見える行はDBのRLSがリストの見え方（家族・自分だけのリスト）に合わせて絞る。念のため、読んだリストのものだけ使う。
  const [listResult, groupResult, itemResult] = await Promise.all([
    supabase
      .from('lists')
      .select('*')
      .eq('family_id', familyId)
      // 固定したリストが先。中は position の順（画面側の並びと同じ）。
      .order('is_pinned', { ascending: false })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('list_groups')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('list_items')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);
  if (listResult.error) throw listResult.error;
  if (groupResult.error) throw groupResult.error;
  if (itemResult.error) throw itemResult.error;

  const lists = (listResult.data ?? []).map(rowToList);
  const listIds = new Set(lists.map((list) => list.id));
  return {
    lists,
    groups: (groupResult.data ?? []).filter((row) => listIds.has(row.list_id)).map(rowToGroup),
    items: (itemResult.data ?? []).filter((row) => listIds.has(row.list_id)).map(rowToItem),
  };
}

// ============================================================
// リスト
// ============================================================

export async function insertList(
  supabase: SupabaseDb,
  familyId: string,
  input: { name: string; groupLabel: string; position: number; isPrivate: boolean },
  createdBy: string,
): Promise<ListBoard> {
  const row: TablesInsert<'lists'> = {
    family_id: familyId,
    name: input.name,
    group_label: input.groupLabel,
    position: input.position,
    is_private: input.isPrivate,
    created_by: createdBy,
  };
  const { data, error } = await supabase.from('lists').insert(row).select('*').single();
  if (error) throw error;
  return rowToList(data);
}

export async function updateList(supabase: SupabaseDb, list: ListBoard): Promise<void> {
  const { error } = await supabase
    .from('lists')
    .update({
      name: list.name,
      group_label: list.groupLabel,
      position: list.position,
      is_private: list.isPrivate,
      created_by: list.createdBy,
    })
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
 * 未分類の項目をまとめてグループへ入れる。未分類の見出しに名前を付けたときに使う
 * （未分類はグループの行を持たないので、名前を付けるとグループを作ってそこへ移す）。
 */
export async function moveUngroupedItems(supabase: SupabaseDb, listId: string, groupId: string): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .update({ group_id: groupId })
    .eq('list_id', listId)
    .is('group_id', null);
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

/** 項目の書き換え。持っているのは内容だけなので、書き換えるのも内容だけ。 */
export async function updateItemTitle(supabase: SupabaseDb, id: string, title: string): Promise<void> {
  const { error } = await supabase.from('list_items').update({ title }).eq('id', id);
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
 *
 * 共有設定は他のリストと同じく「自分だけ」。家族に見せたいものは、作ったあと
 * リストの設定で「共有」に切り替える。
 */
export async function seedDefaultLists(
  supabase: SupabaseDb,
  familyId: string,
  createdBy: string,
): Promise<ListBoard[]> {
  // 共有設定は他のリストと同じく「自分だけ」。DB側の既定は共有なので明示して入れる。
  const rows: TablesInsert<'lists'>[] = [
    { name: '買い出し', position: 0 },
    { name: 'やりたいこと', position: 1 },
    { name: 'やること', position: 2 },
  ].map((row) => ({ ...row, family_id: familyId, created_by: createdBy, is_private: true }));
  const { data, error } = await supabase.from('lists').insert(rows).select('*');
  if (error) throw error;
  return (data ?? []).map(rowToList);
}
