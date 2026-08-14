import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables } from '@/types/supabase';
import type { ProfileField, ProfileFieldKey, UserProfile } from '@/types/app';

type FamilyProfileRow = Tables<'family_profiles'>;
type SupabaseDb = SupabaseClient<Database>;

const RESERVED_KEYS: ReadonlySet<string> = new Set<ProfileFieldKey>([
  'babyName',
  'birthDate',
  'hospitalPhone',
  'pediatricPhone',
  'papaCompanyPhone',
  'papaContactPhone',
  'mamaCompanyPhone',
  'mamaContactPhone',
]);

// DBのjsonbカラムを安全にProfileField[]へ変換する（想定外の形式は無視して空配列にする）
const parseFieldArray = (value: Json | null): ProfileField[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProfileField[] => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const { id, label, value: fieldValue, key } = item as Record<string, Json | undefined>;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof fieldValue !== 'string') return [];
    const field: ProfileField = { id, label, value: fieldValue };
    if (typeof key === 'string' && RESERVED_KEYS.has(key)) field.key = key as ProfileFieldKey;
    return [field];
  });
};

const fieldsToJson = (fields: ProfileField[]): Json =>
  fields.map((field) =>
    field.key
      ? { id: field.id, label: field.label, value: field.value, key: field.key }
      : { id: field.id, label: field.label, value: field.value },
  );

// DBの行(snake_case) <-> アプリの型(camelCase) を変換する
const rowToProfile = (row: FamilyProfileRow): UserProfile => ({
  childFields: parseFieldArray(row.child_fields),
  familyFields: parseFieldArray(row.family_fields),
  emergencyFields: parseFieldArray(row.emergency_fields),
  customFields: parseFieldArray(row.custom_fields),
});

// 設定タブ（お子様情報・パパママ情報・緊急連絡先・カスタム項目）を取得する。まだ保存されていない場合はnull。
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
    child_fields: fieldsToJson(profile.childFields),
    family_fields: fieldsToJson(profile.familyFields),
    emergency_fields: fieldsToJson(profile.emergencyFields),
    custom_fields: fieldsToJson(profile.customFields),
  });
  if (error) throw error;
}
