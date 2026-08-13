import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/types/supabase';
import type { Nursery } from '@/types/app';

type NurseryRow = Tables<'nurseries'>;
type SupabaseDb = SupabaseClient<Database>;

export const rowToNursery = (row: NurseryRow): Nursery => ({
  id: row.id,
  name: row.name,
  distance: row.distance ?? '',
  status: row.status,
  phone: row.phone ?? '',
  memo: row.memo ?? '',
});

export interface NurseryInput {
  name: string;
  distance: string;
  status: string;
  phone: string;
  memo: string;
}

const toInsertRow = (familyId: string, input: NurseryInput): TablesInsert<'nurseries'> => ({
  family_id: familyId,
  name: input.name,
  distance: input.distance,
  status: input.status,
  phone: input.phone,
  memo: input.memo,
});

export async function listNurseries(supabase: SupabaseDb, familyId: string): Promise<Nursery[]> {
  const { data, error } = await supabase.from('nurseries').select('*').eq('family_id', familyId).order('name');
  if (error) throw error;
  return (data ?? []).map(rowToNursery);
}

export async function insertNursery(supabase: SupabaseDb, familyId: string, input: NurseryInput): Promise<Nursery> {
  const { data, error } = await supabase.from('nurseries').insert(toInsertRow(familyId, input)).select('*').single();
  if (error) throw error;
  return rowToNursery(data);
}

export async function updateNursery(supabase: SupabaseDb, nursery: Nursery): Promise<void> {
  const { error } = await supabase
    .from('nurseries')
    .update({
      name: nursery.name,
      distance: nursery.distance,
      status: nursery.status,
      phone: nursery.phone,
      memo: nursery.memo,
    })
    .eq('id', nursery.id);
  if (error) throw error;
}

export async function deleteNursery(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('nurseries').delete().eq('id', id);
  if (error) throw error;
}
