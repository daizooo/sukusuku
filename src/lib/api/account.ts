import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { LoginRole } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

export type FamilyRole = 'papa' | 'mama';

export const ROLE_LABEL: Record<FamilyRole, string> = { papa: 'パパ', mama: 'ママ' };

// 設定タブのアカウントカード用。lib/api/familyMembers.ts の FamilyMember と違い、
// 未設定の名前を役割ラベルで補完せずそのまま返す（編集フォームの初期値に使うため）。
export interface AccountMember {
  id: string;
  role: LoginRole;
  name: string;
}

const toRole = (value: string | null): LoginRole => (value === 'papa' || value === 'mama' ? value : null);

// 同じ家族に属するメンバー（自分とパートナー）を取得する。
// users_select_self_or_family ポリシーにより、自分の家族の行だけが返る。
export async function listAccountMembers(supabase: SupabaseDb, familyId: string): Promise<AccountMember[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id,name,role')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, role: toRole(row.role), name: row.name ?? '' }));
}

export interface AccountUpdateInput {
  role: FamilyRole;
  name: string;
}

// 自分の役割・表示名を更新する。
// users_update_self ポリシーにより、自分の行のみ更新できる。
export async function updateMyAccount(
  supabase: SupabaseDb,
  userId: string,
  input: AccountUpdateInput,
): Promise<AccountMember> {
  const { data, error } = await supabase
    .from('users')
    .update({ role: input.role, name: input.name.trim() || null })
    .eq('id', userId)
    .select('id,name,role')
    .single();
  if (error) throw error;
  return { id: data.id, role: toRole(data.role), name: data.name ?? '' };
}
