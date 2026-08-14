import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/types/supabase';

type UserRow = Tables<'users'>;
type SupabaseDb = SupabaseClient<Database>;

export type FamilyRole = 'papa' | 'mama';

export const ROLE_LABEL: Record<FamilyRole, string> = { papa: 'パパ', mama: 'ママ' };

export interface FamilyMember {
  id: string;
  familyId: string | null;
  role: FamilyRole | null;
  name: string;
}

const isFamilyRole = (value: string | null): value is FamilyRole => value === 'papa' || value === 'mama';

const rowToMember = (row: UserRow): FamilyMember => ({
  id: row.id,
  familyId: row.family_id,
  role: isFamilyRole(row.role) ? row.role : null,
  name: row.name ?? '',
});

// 同じ家族に属するメンバー（自分とパートナー）を取得する。
// users_select_self_or_family ポリシーにより、自分の家族の行だけが返る。
export async function listFamilyMembers(supabase: SupabaseDb, familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToMember);
}

export interface ProfileUpdateInput {
  role: FamilyRole;
  name: string;
}

// 自分のプロフィール（役割・表示名）を更新する。
// users_update_self ポリシーにより、自分の行のみ更新できる。
export async function updateMyProfile(
  supabase: SupabaseDb,
  userId: string,
  input: ProfileUpdateInput,
): Promise<FamilyMember> {
  const { data, error } = await supabase
    .from('users')
    .update({ role: input.role, name: input.name.trim() || null })
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return rowToMember(data);
}
