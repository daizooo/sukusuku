import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { FamilyMember } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

const RELATION_TO_ROLE: Record<string, string> = { husband: 'papa', wife: 'mama' };

// 記録した人の名前を出すための、アカウントを持つ家族の一覧（id はアカウントのid）。
// 名前は「家族」の名（フルネームの名前部分）で、設定タブのアカウントの「お名前」と同じ
// （docs/family-app.md §4.3）。家族の情報そのものは lib/api/members.ts。
export async function listFamilyMembers(supabase: SupabaseDb, familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('user_id,relation,given_name,display_name')
    .eq('family_id', familyId)
    .not('user_id', 'is', null)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((row) =>
    row.user_id
      ? [
          {
            id: row.user_id,
            name: row.given_name || row.display_name,
            role: RELATION_TO_ROLE[row.relation] ?? null,
          },
        ]
      : [],
  );
}
