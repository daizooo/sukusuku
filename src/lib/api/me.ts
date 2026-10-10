import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { TabId } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

// ログインしている本人の設定。mobile版の `mobile/src/lib/api/me.ts` と同じ値を扱う。

/** アプリを開いたときに最初に出すタブ。users.start_tab に対応（docs/family-app.md §3.4）。 */
export type StartTab = 'schedule' | 'list' | 'care' | 'money' | 'settings';

export const START_TABS: StartTab[] = ['schedule', 'list', 'care', 'money', 'settings'];

export const START_TAB_LABEL: Record<StartTab, string> = {
  schedule: '予定',
  list: 'リスト',
  care: '育児',
  money: '家計',
  settings: '設定',
};

/** start_tab の値と、画面のタブ（設定タブのidは info）。 */
export const START_TAB_TO_TAB_ID: Record<StartTab, TabId> = {
  schedule: 'schedule',
  list: 'list',
  care: 'care',
  money: 'money',
  settings: 'info',
};

// 暮らしタブ（'living'）は廃止した。本番DBの users.start_tab に残っていても、予定から始める。
export const toStartTab = (value: string | null | undefined): StartTab =>
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
