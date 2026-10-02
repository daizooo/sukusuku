import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables, TablesInsert } from '@/types/supabase';
import type { AnchorType, Participant, Recurrence, Task, TaskKind } from '@/types/app';
import { normalizeTime } from '@/lib/dateUtils';
import { INITIAL_EVENTS, INITIAL_TODOS } from '@/lib/seedData';

type TaskRow = Tables<'tasks'>;
type SupabaseDb = SupabaseClient<Database>;

// 参加者・主体は家族メンバーの表示名。家族の名前は変わりうるので、ここでは絞り込まない
// （表示名を変えるとDBのトリガーが予定の名前も書き換える。0048）。
const toParticipants = (value: string[] | null): Participant[] => value ?? [];

const toOwner = (value: string | null): Participant | null => value;

const toKind = (value: string | null): TaskKind => (value === 'task' ? 'task' : 'event');

// DBのjsonbは型を保証しないため、最低限の形（freq/interval を持つオブジェクト）だけ
// 確認して復元する。壊れたデータが来ても落ちないように、合わなければ繰り返し無し扱いにする。
const toRecurrence = (value: TaskRow['recurrence']): Recurrence | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.freq !== 'string' || typeof v.interval !== 'number') return null;
  return v as unknown as Recurrence;
};

// 「持ち物」は詳細(note)に統合したため、旧データの belongings は詳細の末尾に取り込んで扱う。
// 一度保存し直せば belongings は空になり、以降は詳細だけを見ればよくなる。
const mergeBelongingsIntoNote = (note: string | null, belongings: string | null): string => {
  const base = note ?? '';
  const items = (belongings ?? '').trim();
  if (!items) return base;
  return base ? `${base}\n持ち物: ${items}` : `持ち物: ${items}`;
};

// DBの行(snake_case) <-> アプリの型(camelCase) を変換する
export const rowToTask = (row: TaskRow): Task => ({
  id: row.id,
  title: row.title,
  place: row.place ?? '',
  note: mergeBelongingsIntoNote(row.note, row.belongings),
  anchorType: (row.anchor_type as AnchorType) ?? 'absolute',
  startDate: row.start_date,
  startTime: normalizeTime(row.start_time),
  endTime: normalizeTime(row.end_time),
  daysAfterBirth: row.days_after_birth,
  kind: toKind(row.kind),
  owner: toOwner(row.owner),
  participants: toParticipants(row.participants),
  remindMinutesBefore: row.remind_minutes_before,
  done: row.is_done,
  isPrivate: row.is_private,
  recurrence: toRecurrence(row.recurrence),
  timing: row.timing_memo ?? '',
});

export type NewTaskInput = Omit<Task, 'id' | 'done'>;

const toWritableRow = (input: NewTaskInput) => ({
  title: input.title,
  place: input.place,
  note: input.note,
  kind: input.kind,
  anchor_type: input.anchorType,
  // 出生日基準のときだけ日数が意味を持つ。日付指定のときは start_date を使う。
  start_date: input.anchorType === 'absolute' ? input.startDate : null,
  start_time: input.startTime,
  end_time: input.endTime,
  days_after_birth: input.daysAfterBirth,
  owner: input.owner,
  participants: input.participants,
  remind_minutes_before: input.remindMinutesBefore,
  is_private: input.isPrivate,
  // Recurrenceは自己完結したJSON互換の形だが、interfaceにインデックスシグネチャが
  // 無いためJsonへは構造的に代入できない。中身はJSONとして書き出せる値のみなのでキャストする。
  recurrence: input.recurrence as Json | null,
  timing_memo: input.timing,
  // 持ち物は詳細(note)へ統合済み。旧データを保存し直したときに残らないよう空にする。
  belongings: null,
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
  createdBy: string,
): Promise<Task> {
  const row: TablesInsert<'tasks'> = {
    family_id: familyId,
    created_by: createdBy,
    ...toWritableRow(input),
  };
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
