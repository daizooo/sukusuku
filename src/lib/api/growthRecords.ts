import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/types/supabase';
import type { GrowthRecord } from '@/types/app';

type GrowthRow = Tables<'growth_records'>;
type SupabaseDb = SupabaseClient<Database>;

export const rowToGrowthRecord = (row: GrowthRow): GrowthRecord => ({
  id: row.id,
  month: row.month_age,
  height: row.height,
  weight: row.weight,
  recordedDate: row.recorded_date,
});

export interface GrowthRecordInput {
  monthAge: number | null;
  height: number | null;
  weight: number | null;
  recordedDate: string;
}

const toRow = (childId: string, input: GrowthRecordInput): TablesInsert<'growth_records'> => ({
  child_id: childId,
  month_age: input.monthAge,
  height: input.height,
  weight: input.weight,
  recorded_date: input.recordedDate,
});

export async function listGrowthRecords(supabase: SupabaseDb, childId: string): Promise<GrowthRecord[]> {
  const { data, error } = await supabase
    .from('growth_records')
    .select('*')
    .eq('child_id', childId)
    .order('recorded_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToGrowthRecord);
}

export async function insertGrowthRecord(
  supabase: SupabaseDb,
  childId: string,
  input: GrowthRecordInput,
): Promise<GrowthRecord> {
  const { data, error } = await supabase.from('growth_records').insert(toRow(childId, input)).select('*').single();
  if (error) throw error;
  return rowToGrowthRecord(data);
}

export async function updateGrowthRecord(supabase: SupabaseDb, record: GrowthRecord): Promise<void> {
  const { error } = await supabase
    .from('growth_records')
    .update({
      month_age: record.month,
      height: record.height,
      weight: record.weight,
      recorded_date: record.recordedDate,
    })
    .eq('id', record.id);
  if (error) throw error;
}

export async function deleteGrowthRecord(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('growth_records').delete().eq('id', id);
  if (error) throw error;
}
