import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/types/supabase';
import type { Gift } from '@/types/app';

type GiftRow = Tables<'gifts'>;
type SupabaseDb = SupabaseClient<Database>;

export const rowToGift = (row: GiftRow): Gift => ({
  id: row.id,
  from: row.sender_name,
  item: row.received_item ?? '',
  date: row.received_date ?? '',
  returnStatus: row.return_status,
  returnItem: row.return_item ?? '',
  note: row.note ?? '',
});

export interface GiftInput {
  from: string;
  item: string;
  date: string;
  returnStatus: string;
  returnItem: string;
  note: string;
}

const toInsertRow = (familyId: string, input: GiftInput): TablesInsert<'gifts'> => ({
  family_id: familyId,
  sender_name: input.from,
  received_item: input.item,
  received_date: input.date || null,
  return_status: input.returnStatus,
  return_item: input.returnItem,
  note: input.note,
});

export async function listGifts(supabase: SupabaseDb, familyId: string): Promise<Gift[]> {
  const { data, error } = await supabase
    .from('gifts')
    .select('*')
    .eq('family_id', familyId)
    .order('received_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToGift);
}

export async function insertGift(supabase: SupabaseDb, familyId: string, input: GiftInput): Promise<Gift> {
  const { data, error } = await supabase.from('gifts').insert(toInsertRow(familyId, input)).select('*').single();
  if (error) throw error;
  return rowToGift(data);
}

export async function updateGift(supabase: SupabaseDb, gift: Gift): Promise<void> {
  const { error } = await supabase
    .from('gifts')
    .update({
      sender_name: gift.from,
      received_item: gift.item,
      received_date: gift.date || null,
      return_status: gift.returnStatus,
      return_item: gift.returnItem,
      note: gift.note,
    })
    .eq('id', gift.id);
  if (error) throw error;
}

export async function deleteGift(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('gifts').delete().eq('id', id);
  if (error) throw error;
}
