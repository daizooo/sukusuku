import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/types/supabase';
import type { AnchorType, Label, Task } from '@/types/app';
import { normalizeTime } from '@/lib/dateUtils';
import { INITIAL_EVENTS, INITIAL_TODOS } from '@/lib/seedData';

type TaskRow = Tables<'tasks'>;
type SupabaseDb = SupabaseClient<Database>;

// 旧ラベル('二人で'/'未定')が残っている行は '家族' として扱う
const toLabel = (value: string | null): Label => {
  if (value === 'パパ' || value === 'ママ') return value;
  return '家族';
};

// DBの行(snake_case) <-> アプリの型(camelCase) を変換する
export const rowToTask = (row: TaskRow): Task => ({
  id: row.id,
  category: row.category,
  title: row.title,
  place: row.place ?? '',
  note: row.note ?? '',
  anchorType: (row.anchor_type as AnchorType) ?? 'absolute',
  startDate: row.start_date,
  startTime: normalizeTime(row.start_time),
  endTime: normalizeTime(row.end_time),
  daysAfterBirth: row.days_after_birth,
  label: toLabel(row.assignee),
  remindMinutesBefore: row.remind_minutes_before,
  done: row.is_done,
  timing: row.timing_memo ?? '',
  belongings: row.belongings ?? '',
});

export type NewTaskInput = Omit<Task, 'id' | 'done'>;

const toWritableRow = (input: NewTaskInput) => ({
  title: input.title,
  category: input.category,
  place: input.place,
  note: input.note,
  anchor_type: input.anchorType,
  // 出生日基準のときだけ日数が意味を持つ。日付指定のときは start_date を使う。
  start_date: input.anchorType === 'absolute' ? input.startDate : null,
  start_time: input.startTime,
  end_time: input.endTime,
  days_after_birth: input.daysAfterBirth,
  assignee: input.label,
  remind_minutes_before: input.remindMinutesBefore,
  // has_notification は remind_minutes_before に置き換えたが、
  // カラムが残っている間は整合させておく（0007 で削除予定）。
  has_notification: input.remindMinutesBefore !== null,
  timing_memo: input.timing,
  belongings: input.belongings,
});

export async function listTasks(supabase: SupabaseDb, familyId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('family_id', familyId)
    .order('start_date', { ascending: true, nullsFirst: false })
    .order('days_after_birth', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToTask);
}

export async function insertTask(
  supabase: SupabaseDb,
  familyId: string,
  input: NewTaskInput,
): Promise<Task> {
  const row: TablesInsert<'tasks'> = { family_id: familyId, ...toWritableRow(input) };
  const { data, error } = await supabase.from('tasks').insert(row).select('*').single();
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
    .update({ ...toWritableRow(task), is_done: task.done })
    .eq('id', task.id);
  if (error) throw error;
}

export async function deleteTask(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// 家族を新規作成した直後に、出生手続き等の定番ToDoをまとめて登録する。
export async function seedDefaultTasks(supabase: SupabaseDb, familyId: string): Promise<void> {
  const rows: TablesInsert<'tasks'>[] = [...INITIAL_TODOS, ...INITIAL_EVENTS].map((t) => ({
    family_id: familyId,
    ...toWritableRow(t),
    is_done: false,
  }));
  const { error } = await supabase.from('tasks').insert(rows);
  if (error) throw error;
}
