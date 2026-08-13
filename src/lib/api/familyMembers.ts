import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { FamilyMember } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

const ROLE_LABEL: Record<string, string> = { papa: 'パパ', mama: 'ママ' };

export async function listFamilyMembers(supabase: SupabaseDb, familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabase.from('users').select('id,name,role').eq('family_id', familyId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name || (row.role ? ROLE_LABEL[row.role] ?? row.role : ''),
    role: row.role,
  }));
}
