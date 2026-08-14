import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables } from '@/types/supabase';
import type { ProfileField, UserProfile } from '@/types/app';

type FamilyProfileRow = Tables<'family_profiles'>;
type SupabaseDb = SupabaseClient<Database>;

// DBのjsonbカラムを安全にProfileField[]へ変換する（想定外の形式は無視して空配列にする）
const parseCustomFields = (value: Json | null): ProfileField[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProfileField[] => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const { id, label, value: fieldValue } = item as Record<string, Json | undefined>;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof fieldValue !== 'string') return [];
    return [{ id, label, value: fieldValue }];
  });
};

const customFieldsToJson = (fields: ProfileField[]): Json =>
  fields.map((field) => ({ id: field.id, label: field.label, value: field.value }));

// DBの行(snake_case) <-> アプリの型(camelCase) を変換する
const rowToProfile = (row: FamilyProfileRow): UserProfile => ({
  babyName: row.baby_name,
  birthDate: row.birth_date ?? '',
  momName: row.mom_name,
  momWorkplace: row.mom_workplace,
  dadName: row.dad_name,
  dadWorkplace: row.dad_workplace,
  address: row.address,
  hospitalName: row.hospital_name,
  hospitalPhone: row.hospital_phone,
  pediatricName: row.pediatric_name,
  pediatricPhone: row.pediatric_phone,
  papaCompanyPhone: row.papa_company_phone,
  papaContactPhone: row.papa_contact_phone,
  mamaCompanyPhone: row.mama_company_phone,
  mamaContactPhone: row.mama_contact_phone,
  customFields: parseCustomFields(row.custom_fields),
});

// 設定タブ（お子様情報・パパママ情報・緊急連絡先）を取得する。まだ保存されていない場合はnull。
export async function getProfile(supabase: SupabaseDb, familyId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('family_profiles')
    .select('*')
    .eq('family_id', familyId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProfile(data) : null;
}

// 設定タブの保存。行が無ければ作成、あれば更新する。
export async function saveProfile(supabase: SupabaseDb, familyId: string, profile: UserProfile): Promise<void> {
  const { error } = await supabase.from('family_profiles').upsert({
    family_id: familyId,
    baby_name: profile.babyName,
    birth_date: profile.birthDate || null,
    mom_name: profile.momName,
    mom_workplace: profile.momWorkplace,
    dad_name: profile.dadName,
    dad_workplace: profile.dadWorkplace,
    address: profile.address,
    hospital_name: profile.hospitalName,
    hospital_phone: profile.hospitalPhone,
    pediatric_name: profile.pediatricName,
    pediatric_phone: profile.pediatricPhone,
    papa_company_phone: profile.papaCompanyPhone,
    papa_contact_phone: profile.papaContactPhone,
    mama_company_phone: profile.mamaCompanyPhone,
    mama_contact_phone: profile.mamaContactPhone,
    custom_fields: customFieldsToJson(profile.customFields),
  });
  if (error) throw error;
}
