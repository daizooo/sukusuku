import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/types/supabase';
import type { CareLog, LogType } from '@/types/app';

type CareLogRow = Tables<'care_logs'>;
type SupabaseDb = SupabaseClient<Database>;

// DBには種別ごとの表示名を持たないため、typeから導出する
export const LOG_TYPE_LABEL: Record<LogType, string> = {
  milk: 'ミルク',
  diaper: 'おむつ',
  sleep: '睡眠',
};

export const rowToCareLog = (row: CareLogRow): CareLog => ({
  id: row.id,
  type: row.type as LogType,
  label: LOG_TYPE_LABEL[row.type as LogType] ?? row.type,
  amount: row.amount ?? '',
  time: new Date(row.logged_at),
  note: row.note ?? '',
  createdBy: row.created_by,
});

export async function listCareLogs(supabase: SupabaseDb, familyId: string): Promise<CareLog[]> {
  const { data, error } = await supabase
    .from('care_logs')
    .select('*')
    .eq('family_id', familyId)
    .order('logged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToCareLog);
}

export interface NewCareLogInput {
  type: LogType;
  amount: string;
  note: string;
  loggedAt?: Date;
}

export async function insertCareLog(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
  input: NewCareLogInput,
): Promise<CareLog> {
  const row: TablesInsert<'care_logs'> = {
    family_id: familyId,
    type: input.type,
    amount: input.amount,
    note: input.note,
    logged_at: (input.loggedAt ?? new Date()).toISOString(),
    created_by: userId,
  };
  const { data, error } = await supabase.from('care_logs').insert(row).select('*').single();
  if (error) throw error;
  return rowToCareLog(data);
}

export async function updateCareLog(supabase: SupabaseDb, log: CareLog): Promise<void> {
  const { error } = await supabase
    .from('care_logs')
    .update({ amount: log.amount, note: log.note, logged_at: log.time.toISOString() })
    .eq('id', log.id);
  if (error) throw error;
}

export async function deleteCareLog(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('care_logs').delete().eq('id', id);
  if (error) throw error;
}
