import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type {
  Household,
  HouseholdDraft,
  Member,
  MemberColor,
  MemberDraft,
  MemberRelation,
} from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;
type MemberRow = Omit<
  Database['public']['Tables']['family_members']['Row'],
  'family_id' | 'created_at' | 'updated_at'
>;

// 家族メンバー（family_members）と世帯情報（families）。docs/family-app.md §3。
//
// 見るのは家族全員、編集は保護者なら全員分・そうでなければ自分の行だけ。
// 世帯情報の編集は保護者だけ（いずれもRLSで守っている。0046）。
// lib/api/familyMembers.ts は記録者の名前を出すためのアカウント一覧で、別物。

const MEMBER_COLUMNS =
  'id,user_id,relation,is_guardian,display_name,family_name,given_name,family_name_kana,given_name_kana,birth_date,phone,email,workplace,workplace_phone,color,sort_order';

const toRelation = (value: string): MemberRelation =>
  value === 'husband' || value === 'wife' ? value : 'child';

const toColor = (value: string): MemberColor =>
  value === 'blue' || value === 'pink' || value === 'emerald' ? value : 'gray';

const toMember = (row: MemberRow): Member => ({
  id: row.id,
  userId: row.user_id,
  relation: toRelation(row.relation),
  isGuardian: row.is_guardian,
  displayName: row.display_name,
  familyName: row.family_name,
  givenName: row.given_name,
  familyNameKana: row.family_name_kana,
  givenNameKana: row.given_name_kana,
  birthDate: row.birth_date ?? '',
  phone: row.phone,
  email: row.email,
  workplace: row.workplace,
  workplacePhone: row.workplace_phone,
  color: toColor(row.color),
  sortOrder: row.sort_order,
});

export async function listMembers(supabase: SupabaseDb, familyId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select(MEMBER_COLUMNS)
    .eq('family_id', familyId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toMember);
}

export async function updateMember(
  supabase: SupabaseDb,
  memberId: string,
  draft: MemberDraft,
): Promise<Member> {
  const { data, error } = await supabase
    .from('family_members')
    .update({
      display_name: draft.displayName.trim(),
      family_name: draft.familyName.trim(),
      given_name: draft.givenName.trim(),
      family_name_kana: draft.familyNameKana.trim(),
      given_name_kana: draft.givenNameKana.trim(),
      birth_date: draft.birthDate || null,
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      workplace: draft.workplace.trim(),
      workplace_phone: draft.workplacePhone.trim(),
    })
    .eq('id', memberId)
    .select(MEMBER_COLUMNS)
    .single();
  if (error) throw error;
  return toMember(data);
}

/**
 * 育児の対象の子（並び順で最初の子）。生後日数・成長曲線の誕生日に使う。
 * 子がいなければ null。
 */
export async function getChildMember(supabase: SupabaseDb, familyId: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('family_members')
    .select(MEMBER_COLUMNS)
    .eq('family_id', familyId)
    .eq('relation', 'child')
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toMember(data) : null;
}

export async function getHousehold(supabase: SupabaseDb, familyId: string): Promise<Household> {
  const { data, error } = await supabase
    .from('families')
    .select('id,name,postal_code,address,home_phone')
    .eq('id', familyId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    postalCode: data.postal_code,
    address: data.address,
    homePhone: data.home_phone,
  };
}

export async function updateHousehold(
  supabase: SupabaseDb,
  familyId: string,
  draft: HouseholdDraft,
): Promise<Household> {
  const { data, error } = await supabase
    .from('families')
    .update({
      name: draft.name.trim(),
      postal_code: draft.postalCode.trim(),
      address: draft.address.trim(),
      home_phone: draft.homePhone.trim(),
    })
    .eq('id', familyId)
    .select('id,name,postal_code,address,home_phone')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    postalCode: data.postal_code,
    address: data.address,
    homePhone: data.home_phone,
  };
}
