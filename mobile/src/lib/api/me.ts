import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { LoginRole } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

// ログインした本人の所属。すべてのAPIが family_id を要る作りなので、
// 画面を出す前にこれを1回取る。
//
// Web版ではサーバー側(src/app/page.tsx)が同じ問い合わせをして画面に渡していた。
// ネイティブにはサーバー側が無いので、起動後にクライアントから取りに行く。

export interface Membership {
  userId: string;
  /** まだ家族に属していなければ null（Web版の /family-setup 相当がこれから要る）。 */
  familyId: string | null;
  role: LoginRole;
}

export async function getMyMembership(supabase: SupabaseDb, userId: string): Promise<Membership> {
  const { data, error } = await supabase
    .from('users')
    .select('family_id, role')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return {
    userId,
    familyId: data.family_id,
    role: data.role === 'papa' || data.role === 'mama' ? data.role : null,
  };
}
