import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/types/supabase';
import type { Assignee, Task } from '@/types/app';
import { INITIAL_EVENTS, INITIAL_TODOS } from '@/lib/seedData';

type TaskRow = Tables<'tasks'>;
type SupabaseDb = SupabaseClient<Database>;

// DBの行(snake_case) <-> アプリの型(camelCase) を変換する
export const rowToTask = (row: TaskRow): Task => ({
  id: row.id,
  category: row.category,
  title: row.title,
  place: row.place ?? '',
  timing: row.timing_memo ?? '',
  daysAfterBirth: row.days_after_birth,
  done: row.is_done,
  note: row.note ?? '',
  belongings: row.belongings ?? '',
  assignee: (row.assignee as Assignee) ?? '未定',
  notification: row.has_notification,
});

export interface NewTaskInput {
  title: string;
  category: string;
  timing: string;
  daysAfterBirth: number;
  place: string;
  note: string;
  belongings: string;
  assignee: Assignee;
  notification: boolean;
}

const toInsertRow = (familyId: string, input: NewTaskInput): TablesInsert<'tasks'> => ({
  family_id: familyId,
  title: input.title,
  category: input.category,
  days_after_birth: input.daysAfterBirth,
  timing_memo: input.timing,
  place: input.place,
  note: input.note,
  belongings: input.belongings,
  assignee: input.assignee,
  has_notification: input.notification,
});

export async function listTasks(supabase: SupabaseDb, familyId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('family_id', familyId)
    .order('days_after_birth', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToTask);
}

export async function insertTask(supabase: SupabaseDb, familyId: string, input: NewTaskInput): Promise<Task> {
  const { data, error } = await supabase.from('tasks').insert(toInsertRow(familyId, input)).select('*').single();
  if (error) throw error;
  return rowToTask(data);
}

export async function updateTaskDone(supabase: SupabaseDb, id: string, done: boolean): Promise<void> {
  const { error } = await supabase.from('tasks').update({ is_done: done }).eq('id', id);
  if (error) throw error;
}

export async function updateTask(supabase: SupabaseDb, task: Task): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({
      title: task.title,
      category: task.category,
      days_after_birth: task.daysAfterBirth,
      timing_memo: task.timing,
      place: task.place,
      note: task.note,
      belongings: task.belongings,
      assignee: task.assignee,
      is_done: task.done,
      has_notification: task.notification,
    })
    .eq('id', task.id);
  if (error) throw error;
}

export async function deleteTask(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// 家族を新規作成した直後に、出生手続き等の定番ToDoをまとめて登録する。
// (基本設計書のプロトタイプに含まれていた初期チェックリストを踏襲)
export async function seedDefaultTasks(supabase: SupabaseDb, familyId: string): Promise<void> {
  const rows: TablesInsert<'tasks'>[] = [...INITIAL_TODOS, ...INITIAL_EVENTS].map((t) => ({
    family_id: familyId,
    title: t.title,
    category: t.category,
    days_after_birth: t.daysAfterBirth,
    timing_memo: t.timing,
    place: t.place,
    note: t.note,
    belongings: t.belongings,
    assignee: t.assignee,
    has_notification: t.notification,
    is_done: false,
  }));
  const { error } = await supabase.from('tasks').insert(rows);
  if (error) throw error;
}
