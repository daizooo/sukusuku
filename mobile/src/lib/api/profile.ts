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

// 1項目の「内容」を取り出す。
// 現在の形式は values(配列)。1つの見出しに内容が1つしか持てなかった頃に保存された
// データは value(文字列)しか持たないため、その場合は1件の配列として読む。
const parseValues = (values: Json | undefined, legacyValue: Json | undefined): string[] | null => {
  if (Array.isArray(values)) {
    const parsed = values.filter((v): v is string => typeof v === 'string');
    if (parsed.length > 0) return parsed;
  }
  if (typeof legacyValue === 'string') return [legacyValue];
  return null;
};

// DBのjsonbカラムを安全にProfileField[]へ変換する（想定外の形式は無視して空配列にする）
const parseFieldArray = (value: Json | null): ProfileField[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProfileField[] => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const { id, label, value: fieldValue, values, key } = item as Record<string, Json | undefined>;
    if (typeof id !== 'string' || typeof label !== 'string') return [];
    const parsedValues = parseValues(values, fieldValue);
    if (!parsedValues) return [];
    const field: ProfileField = { id, label, values: parsedValues };
    if (typeof key === 'string' && RESERVED_KEYS.has(key)) field.key = key as ProfileFieldKey;
    return [field];
  });
};

// 未入力のまま残った内容は保存しない（1件も残らない場合だけ空文字を1つ持たせる）
const normalizeValues = (values: string[]): string[] => {
  const filled = values.filter((value) => value.trim() !== '');
  return filled.length > 0 ? filled : [''];
};

// valuesと合わせて旧形式のvalue(先頭の内容)も書き出す。
// 家族の相手側の端末が古いままだと、valueが無い項目は読み飛ばされて表示が消えたり、
// そのまま保存し直されて内容が失われたりするため。
const fieldsToJson = (fields: ProfileField[]): Json =>
  fields.map((field) => {
    const values = normalizeValues(field.values);
    const base = { id: field.id, label: field.label, value: values[0], values };
    return field.key ? { ...base, key: field.key } : base;
  });

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
