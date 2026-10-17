import { supabase } from '@/lib/supabase';
import { getMyMembership } from '@/lib/api/me';
import { listRecentMilkLogs } from '@/lib/api/careLogs';
import { listFamilyNursingState } from '@/lib/api/nursingAlarms';
import { getFeedingSettings } from '@/lib/api/feedingSettings';
import { activePendingNursing, nextFeedingSchedule, resolveLastFeeding } from '@/lib/feedingSchedule';

// ホーム画面のウィジェットに出す中身を読む（docs/widgets.md §3）。中身を出すのは育児の「次の目安」だけ。
//
// ウィジェットはアプリの画面を開かずに、裏（ヘッドレスJS）で描く。ログインの情報はアプリと同じ
// 端末の保存（AsyncStorage）から読むので、アプリでログインしていれば同じ人として読める。
// 数え方はアプリの画面と同じ関数を使う（feedingSchedule）。ウィジェット独自の数え方は作らない。

/** 読めなかった理由。ウィジェットにはボタンだけ出し、目安の代わりに一言添える。 */
export type WidgetDataError = 'signed-out' | 'no-family' | 'offline';

export type WidgetData<T> = { ok: true; value: T } | { ok: false; error: WidgetDataError };

export interface CareWidgetData {
  /** 家族のだれかが、いま授乳している（計測中）。 */
  isNursing: boolean;
  /** 次の授乳の目安の時刻。授乳の記録が無ければ null。 */
  dueAt: Date | null;
}

/**
 * 次の授乳の目安。育児タブの見出しの「次の授乳」と同じ決め方
 * （記録に入る前の授乳＝家族の端末の計測中・記録待ちも前回の授乳として扱う）。
 *
 * ウィジェットは30分ごとにしか描き直されないので、「あと◯分」のような時間とともに古くなる値は出さず、
 * 時刻だけを渡す（docs/widgets.md §3.2）。
 */
export async function loadCareWidgetData(): Promise<WidgetData<CareWidgetData>> {
  const first = await loadCareWidgetDataOnce();
  if (first.ok || first.error !== 'offline') return first;
  // 裏で動き出した直後は通信がまだつながっていないことがあるので、少し待って1回だけ読み直す。
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return loadCareWidgetDataOnce();
}

async function loadCareWidgetDataOnce(): Promise<WidgetData<CareWidgetData>> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return { ok: false, error: 'signed-out' };
    const { familyId } = await getMyMembership(supabase, userId);
    if (!familyId) return { ok: false, error: 'no-family' };
    const [milkLogs, nursingStates, feeding] = await Promise.all([
      listRecentMilkLogs(supabase, familyId, 1),
      // 通知をオフにしている端末は印を預けないので、読めなくても記録だけで出す。
      listFamilyNursingState(supabase).catch(() => []),
      getFeedingSettings(supabase, familyId),
    ]);
    const now = Date.now();
    const last = resolveLastFeeding(milkLogs[0]?.time ?? null, activePendingNursing(nursingStates, now));
    const schedule = nextFeedingSchedule(last.lastFedAt, feeding.intervalMinutes, now);
    return { ok: true, value: { isNursing: last.isNursing, dueAt: schedule?.dueAt ?? null } };
  } catch (error) {
    console.warn('ウィジェットの次の目安を読めませんでした', error);
    return { ok: false, error: 'offline' };
  }
}
