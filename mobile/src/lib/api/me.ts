import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

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
}

// 所属と「最初に開くタブ」は同じ users の1行なので、1回の問い合わせで両方取って使い回す。
// 各タブ・起動の入口・裏の処理（通知の掃除など）がそれぞれ取りに行くと、同じ問い合わせが何度も走り、
// どのタブもデータを読み始める前にこの往復を待つことになる。ログインしたところで先に取っておく（prefetchMe）。
interface Me {
  membership: Membership;
  startTab: StartTab;
}

const meRequests = new Map<string, Promise<Me>>();

async function fetchMe(supabase: SupabaseDb, userId: string): Promise<Me> {
  const { data, error } = await supabase
    .from('users')
    .select('family_id, start_tab')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return {
    membership: {
      userId,
      familyId: data.family_id,
    },
    startTab: toStartTab(data.start_tab),
  };
}

function loadMe(supabase: SupabaseDb, userId: string): Promise<Me> {
  const cached = meRequests.get(userId);
  if (cached) return cached;
  const request = fetchMe(supabase, userId);
  meRequests.set(userId, request);
  // 読めなかったとき・まだ家族に属していないときは覚えない（次に呼んだときに取り直す）。
  request.then(
    (me) => {
      if (me.membership.familyId === null) meRequests.delete(userId);
    },
    () => meRequests.delete(userId),
  );
  return request;
}

/** 控えた所属を捨てる（ログアウトしたとき。次にログインした人の分を取り直す）。 */
export function clearMyMembershipCache(): void {
  meRequests.clear();
}

/** ログインしたところで先に取っておく。画面が開く頃には届いている。失敗は無視してよい（開いた画面が取り直す）。 */
export function prefetchMe(supabase: SupabaseDb, userId: string): void {
  loadMe(supabase, userId).catch(() => {});
}

export async function getMyMembership(supabase: SupabaseDb, userId: string): Promise<Membership> {
  return (await loadMe(supabase, userId)).membership;
}

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

/** start_tab の値と、タブのパス（設定タブのファイルは info.tsx）。 */
export const START_TAB_ROUTE: Record<StartTab, string> = {
  schedule: '/schedule',
  list: '/list',
  care: '/care',
  money: '/money',
  settings: '/info',
};

// 暮らしタブ（'living'）は廃止した。本番DBの users.start_tab に残っていても、予定から始める。
const toStartTab = (value: string | null | undefined): StartTab =>
  START_TABS.find((tab) => tab === value) ?? 'schedule';

export async function getMyStartTab(supabase: SupabaseDb, userId: string): Promise<StartTab> {
  return (await loadMe(supabase, userId)).startTab;
}

export async function updateMyStartTab(
  supabase: SupabaseDb,
  userId: string,
  tab: StartTab,
): Promise<void> {
  const { error } = await supabase.from('users').update({ start_tab: tab }).eq('id', userId);
  if (error) throw error;
  // 控えていた最初のタブが古くなったので、次に読むときに取り直す。
  meRequests.delete(userId);
}
