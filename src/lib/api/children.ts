import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type SupabaseDb = SupabaseClient<Database>;

// 成長記録(growth_records)はchild_idに紐づくため、家族の子ども行を1件確保して返す。
// まだ子ども情報の入力画面がないため、存在しなければ空のレコードを1件作成する。
export async function ensureChildId(supabase: SupabaseDb, familyId: string): Promise<string> {
  const { data, error } = await supabase
    .from('children')
    .select('id')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id;

  const { data: created, error: insertError } = await supabase
    .from('children')
    .insert({ family_id: familyId })
    .select('id')
    .single();
  if (insertError) throw insertError;
  return created.id;
}
