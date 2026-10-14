import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { getMyMembership } from '@/lib/api/me';
import { listRecentMilkLogs } from '@/lib/api/careLogs';
import { listFamilyNursingState } from '@/lib/api/nursingAlarms';
import { getFeedingSettings } from '@/lib/api/feedingSettings';
import { rowToRecord } from '@/lib/api/money';
import { loadLists } from '@/lib/api/lists';
import { readShoppingListId } from '@/lib/shoppingListPreference';
import { activePendingNursing, nextFeedingSchedule, resolveLastFeeding } from '@/lib/feedingSchedule';
import { buildMonthSummary, monthKeyOfDate, shiftMonth } from '@/lib/moneyUtils';
import { toDateString } from '@/lib/dateUtils';

// ホーム画面のウィジェットに出す中身を読む（docs/widgets.md §3）。
//
// ウィジェットはアプリの画面を開かずに、裏（ヘッドレスJS）で描く。ログインの情報はアプリと同じ
// 端末の保存（AsyncStorage）から読むので、アプリでログインしていれば同じ人として読める。
// 数え方はアプリの画面と同じ関数を使う（次の授乳の目安は feedingSchedule、今月の支出は buildMonthSummary）。
// ウィジェット独自の数え方は作らない。

/** 読めなかった理由。ウィジェットにはボタンだけ出し、理由を一言添える。 */
export type WidgetDataError = 'signed-out' | 'no-family' | 'offline';

export type WidgetData<T> = { ok: true; value: T } | { ok: false; error: WidgetDataError };

async function familyIdOrError(): Promise<WidgetData<string>> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return { ok: false, error: 'signed-out' };
  const membership = await getMyMembership(supabase, userId);
  if (!membership.familyId) return { ok: false, error: 'no-family' };
  return { ok: true, value: membership.familyId };
}

async function withFamily<T>(read: (familyId: string) => Promise<T>): Promise<WidgetData<T>> {
  try {
    const family = await familyIdOrError();
    if (!family.ok) return family;
    return { ok: true, value: await read(family.value) };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

// ---- 育児 ----

export interface CareWidgetData {
  /** 家族のだれかが、いま授乳している（計測中）。 */
  isNursing: boolean;
  /** 前回の授乳の時刻。記録が無ければ null。 */
  lastFedAt: Date | null;
  /** 次の授乳の目安の時刻。前回が無ければ null。 */
  dueAt: Date | null;
}

/**
 * 前回の授乳と次の目安。育児タブの見出しの「次の授乳」と同じ決め方
 * （記録に入る前の授乳＝家族の端末の計測中・記録待ちも前回の授乳として扱う）。
 *
 * ウィジェットは30分ごとにしか描き直されないので、「あと◯分」のような時間とともに古くなる値は出さず、
 * 時刻だけを渡す（docs/widgets.md §3.2）。
 */
export const loadCareWidgetData = (): Promise<WidgetData<CareWidgetData>> =>
  withFamily(async (familyId) => {
    const [milkLogs, nursingStates, feeding] = await Promise.all([
      listRecentMilkLogs(supabase, familyId, 1),
      // 通知をオフにしている端末は印を預けないので、読めなくても記録だけで出す。
      listFamilyNursingState(supabase).catch(() => []),
      getFeedingSettings(supabase, familyId),
    ]);
    const now = Date.now();
    const lastLoggedAt = milkLogs[0]?.time ?? null;
    const last = resolveLastFeeding(lastLoggedAt, activePendingNursing(nursingStates, now));
    const schedule = nextFeedingSchedule(last.lastFedAt, feeding.intervalMinutes, now);
    return { isNursing: last.isNursing, lastFedAt: last.lastFedAt, dueAt: schedule?.dueAt ?? null };
  });

// ---- 家計 ----

export interface MoneyWidgetData {
  /** 今月の支出（振り返りの「支出」と同じ数え方）。 */
  monthSpent: number;
  /** 今日の支出。 */
  todaySpent: number;
  /** 何月か（1〜12）。 */
  month: number;
}

/** 今月の支出と今日の支出。今月の記録だけを読む（家計タブのように全期間は読まない）。 */
export const loadMoneyWidgetData = (): Promise<WidgetData<MoneyWidgetData>> =>
  withFamily(async (familyId) => {
    const today = new Date();
    const monthKey = monthKeyOfDate(today);
    const { data, error } = await supabase
      .from('money_records')
      .select('*, money_items(*)')
      .eq('family_id', familyId)
      .gte('occurred_on', `${monthKey}-01`)
      .lt('occurred_on', `${shiftMonth(monthKey, 1)}-01`);
    if (error) throw error;
    const records = (data ?? []).map(rowToRecord);
    const todayKey = toDateString(today);
    return {
      monthSpent: buildMonthSummary(records, [], [], monthKey).living,
      todaySpent: buildMonthSummary(
        records.filter((record) => record.occurredOn === todayKey),
        [],
        [],
        monthKey,
      ).living,
      month: today.getMonth() + 1,
    };
  });

// ---- ToDo・買い物 ----

export interface ListWidgetData {
  listId: string;
  name: string;
  /** まだ済んでいない項目。ToDoタブで開いたときと同じ並び（グループの順 → 未分類、中は並び順）。 */
  items: { id: string; title: string }[];
}

/**
 * 出すリスト。暮らしタブの「買い出しリストへ送る」で選んだリスト（この端末で覚えている送り先）があればそれ、
 * 無ければToDoタブの一覧の先頭（固定したリストが先）。リストが1つも無ければ null。
 */
export const loadListWidgetData = (): Promise<WidgetData<ListWidgetData | null>> =>
  withFamily(async (familyId) => {
    const [snapshot, preferredId] = await Promise.all([loadLists(supabase, familyId), readShoppingListId()]);
    const sorted = [...snapshot.lists].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position,
    );
    const list = sorted.find((entry) => entry.id === preferredId) ?? sorted[0];
    if (!list) return null;
    const groupOrder = new Map(
      snapshot.groups.filter((group) => group.listId === list.id).map((group) => [group.id, group.position]),
    );
    const items = snapshot.items
      .filter((item) => item.listId === list.id && !item.done)
      .sort((a, b) => {
        const ga = a.groupId === null ? Number.MAX_SAFE_INTEGER : (groupOrder.get(a.groupId) ?? Number.MAX_SAFE_INTEGER);
        const gb = b.groupId === null ? Number.MAX_SAFE_INTEGER : (groupOrder.get(b.groupId) ?? Number.MAX_SAFE_INTEGER);
        return ga - gb || a.position - b.position;
      })
      .map((item) => ({ id: item.id, title: item.title }));
    return { listId: list.id, name: list.name, items };
  });

// ---- この端末の設定 ----

const HIDE_AMOUNTS_KEY = 'widget.hideAmounts';

/**
 * 家計のウィジェットで金額を隠すか。ホーム画面は人に見られやすいので、この端末ごとに選べる（既定は出す）。
 * 隠すと金額の代わりにボタンだけになる。
 */
export async function readWidgetHideAmounts(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HIDE_AMOUNTS_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function writeWidgetHideAmounts(hide: boolean): Promise<void> {
  await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, hide ? '1' : '0');
}
