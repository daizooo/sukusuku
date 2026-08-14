import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type SupabaseDb = SupabaseClient<Database>;

export interface ChildProfile {
  id: string | null;
  name: string;
  birthDate: string; // 'YYYY-MM-DD' / 未設定なら ''
}

// 家族の子ども情報を取得する。まだ登録がなければ null を返す。
export async function fetchChild(
  supabase: SupabaseDb,
  familyId: string,
): Promise<ChildProfile | null> {
  const { data, error } = await supabase
    .from('children')
    .select('id, name, birth_date')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name ?? '',
    birthDate: data.birth_date ?? '',
  };
}

// 子どもの名前・誕生日を保存する。行がなければ作成する。
// 誕生日は出生日基準の予定の日付計算に使うため、保存後に start_date を再計算する。
export async function saveChild(
  supabase: SupabaseDb,
  familyId: string,
  input: { id: string | null; name: string; birthDate: string },
): Promise<ChildProfile> {
  const values = {
    name: input.name || null,
    birth_date: input.birthDate || null,
  };

  const { data, error } = input.id
    ? await supabase
        .from('children')
        .update(values)
        .eq('id', input.id)
        .select('id, name, birth_date')
        .single()
    : await supabase
        .from('children')
        .insert({ family_id: familyId, ...values })
        .select('id, name, birth_date')
        .single();

  if (error) throw error;

  return {
    id: data.id,
    name: data.name ?? '',
    birthDate: data.birth_date ?? '',
  };
}
