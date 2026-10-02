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

/** アプリを開いたときに最初に出すタブ。users.start_tab に対応（docs/family-app.md §3.4）。 */
export type StartTab = 'schedule' | 'list' | 'care' | 'settings';

export const START_TABS: StartTab[] = ['schedule', 'list', 'care', 'settings'];

export const START_TAB_LABEL: Record<StartTab, string> = {
  schedule: '予定',
  list: 'リスト',
  care: '育児',
  settings: '設定',
};

/** start_tab の値と、タブのパス（設定タブのファイルは info.tsx）。 */
export const START_TAB_ROUTE: Record<StartTab, string> = {
  schedule: '/schedule',
  list: '/list',
  care: '/care',
  settings: '/info',
};

const toStartTab = (value: string | null | undefined): StartTab =>
  START_TABS.find((tab) => tab === value) ?? 'schedule';

export async function getMyStartTab(supabase: SupabaseDb, userId: string): Promise<StartTab> {
  const { data, error } = await supabase.from('users').select('start_tab').eq('id', userId).single();
  if (error) throw error;
  return toStartTab(data.start_tab);
}

export async function updateMyStartTab(
  supabase: SupabaseDb,
  userId: string,
  tab: StartTab,
): Promise<void> {
  const { error } = await supabase.from('users').update({ start_tab: tab }).eq('id', userId);
  if (error) throw error;
}
