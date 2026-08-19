import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables, TablesInsert } from '@/types/supabase';
import type { Nursery, NurseryChecklist } from '@/types/app';
import { INITIAL_NURSERIES } from '@/lib/seedData';

type NurseryRow = Tables<'nurseries'>;
type SupabaseDb = SupabaseClient<Database>;

// 見学チェックリストの状態は nurseries.checklist (jsonb) に入れる。
// 項目の増減やアプリ側の定義変更で想定外の値が入っていても表示を壊さないよう、
// 読み出しは1項目ずつ検証する。
const toChecklist = (value: Json): NurseryChecklist => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: NurseryChecklist = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { checked, memo } = entry as Record<string, unknown>;
    result[key] = {
      checked: checked === true,
      memo: typeof memo === 'string' ? memo : '',
    };
  }
  return result;
};

export const rowToNursery = (row: NurseryRow): Nursery => ({
  id: row.id,
  name: row.name,
  distance: row.distance ?? '',
  status: row.status,
  phone: row.phone ?? '',
  memo: row.memo ?? '',
  checklist: toChecklist(row.checklist),
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

export async function updateNurseryChecklist(
  supabase: SupabaseDb,
  id: string,
  checklist: NurseryChecklist,
): Promise<void> {
  const { error } = await supabase
    .from('nurseries')
    .update({ checklist: checklist as unknown as Json })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteNursery(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('nurseries').delete().eq('id', id);
  if (error) throw error;
}

// 見学候補の保育園をまとめて登録する。家族の新規作成時と、
// 保活メモがまだ空のときに保活タブから呼ぶ。
export async function seedDefaultNurseries(supabase: SupabaseDb, familyId: string): Promise<Nursery[]> {
  const rows = INITIAL_NURSERIES.map((n) => toInsertRow(familyId, n));
  const { data, error } = await supabase.from('nurseries').insert(rows).select('*');
  if (error) throw error;
  return (data ?? []).map(rowToNursery);
}
