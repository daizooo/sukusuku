// 用件が済んだお知らせを、端末から消す。
//
// **PWA版（src/lib/notificationCleanup.ts）と同じ考え方・同じ規則にする**
// （ルートの CLAUDE.md）。届いたお知らせは、タップするか手で払うまで残り続けるため
// 「妻が授乳を記録したのに、夫の端末には『そろそろ次の授乳』が出たまま」
// 「アプリを開いても、お知らせだけがいつまでも残る」ことが起きる。
// そこで、アプリを開いた・前面に戻したときに、いま出ているお知らせを見て
// もう済んでいるものをこちらから閉じる。
//
// 済んだかどうかは、届いたお知らせの中身ではなく「いまのデータ」で判断する。
// 相手の端末で記録された分もこちらのデータには入っているので、これなら
// どちらが記録しても両方の端末から消える。
//
// PWA版と違うのは2か所だけ。
//
//   1. 出ているお知らせの数え方。PWA版は Service Worker の getNotifications()、
//      こちらは expo-notifications の getPresentedNotificationsAsync()
//   2. 判断の材料の集め方。PWA版は画面が既に持っている値を使うが、ネイティブ版は
//      タブごとに別々に持っているので、ここで必要な分だけ取り直す（§ 判断の材料）

import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { getMyMembership } from '@/lib/api/me';
import { listRecentMilkLogs, listRecentTemperatureLogs } from '@/lib/api/careLogs';
import { listFamilyNursingState } from '@/lib/api/nursingAlarms';
import { readCachedLogsInRange } from '@/lib/offline/careLogs';
import { getFeedingSettings } from '@/lib/api/feedingSettings';
import { getTemperatureReminderSettings } from '@/lib/api/temperatureReminderSettings';
import { listTasks } from '@/lib/api/tasks';
import {
  activePendingNursing,
  nextFeedingSchedule,
  resolveLastFeeding,
} from '@/lib/feedingSchedule';
import { hasNursingSession, localPendingNursing } from '@/lib/nursingTimer';
import { onNotificationCleanupRequest } from '@/lib/notificationCleanupTrigger';

/**
 * お知らせに付くタグ（＝お知らせの種類）。組み立て側は
 * supabase/functions/_shared/deliver.ts の tagOf で、PWA版の public/sw.js とも同じ値。
 * 送る側・PWA版・ここの3か所で揃えること。
 */
export const NOTIFICATION_TAG = {
  /** 授乳の経過時間のお知らせ。ネイティブ版では前面サービスが出す。 */
  nursing: 'nursing-alarm',
  /** 次の授乳の目安のお知らせ。 */
  feeding: 'feeding-reminder',
  /** 朝・夕の検温のお知らせ。 */
  temperature: 'temperature-reminder',
} as const;

/** 予定のリマインダーは、予定ごとに `task-<id>` のタグが付く。 */
const TASK_TAG_PREFIX = 'task-';

const DAY_MS = 24 * 60 * 60_000;

/** 検温の時刻の設定（'HH:mm'）。 */
export interface TemperatureSlotTimes {
  morningTime: string;
  eveningTime: string;
}

/** お知らせが済んだかを決める材料。 */
export interface NotificationSubjects {
  /** 次の授乳の目安をもう過ぎているか（feedingSchedule.ts で求めたもの）。 */
  isFeedingDue: boolean;
  /** 記録前の授乳が端末に残っているか（計測中・計測後の記録待ちを含む）。 */
  hasNursingSession: boolean;
  /** 直近の体温の記録の時刻。まだ記録が無ければ null。 */
  lastTemperatureAt: Date | null;
  temperatureTimes: TemperatureSlotTimes;
  /** 済んだ予定のid。 */
  doneTaskIds: readonly string[];
  now: number;
}

/** 'HH:mm' を、その日の時刻(ミリ秒)にする。 */
const timeOnDay = (base: Date, hhmm: string): number => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const at = new Date(base);
  at.setHours(hours || 0, minutes || 0, 0, 0);
  return at.getTime();
};

/**
 * 直近に過ぎた検温の時刻。出ているお知らせは必ずこの回のものなので
 * （同じタグで差し替わるため）、これより後に測っていれば済んでいる。
 */
const lastTemperatureSlotAt = (times: TemperatureSlotTimes, now: number): number => {
  const base = new Date(now);
  const today = [timeOnDay(base, times.morningTime), timeOnDay(base, times.eveningTime)];
  // 今日の朝の分もまだ来ていない時間帯なら、前の日の夕方の分が直近になる。
  const candidates = [...today, ...today.map((at) => at - DAY_MS)].filter((at) => at <= now);
  return Math.max(...candidates);
};

/** このタグのお知らせは、もう用が済んでいるか。知らないタグは触らない。 */
export const isSettledNotification = (tag: string, subjects: NotificationSubjects): boolean => {
  if (tag === NOTIFICATION_TAG.nursing) {
    // 記録（またはリセット）まで済めば、計測の残りは無くなる。
    return !subjects.hasNursingSession;
  }

  if (tag === NOTIFICATION_TAG.feeding) {
    // 授乳を記録すれば次の目安は先へ動く。目安がまだ先なら、このお知らせは役目を終えている。
    return !subjects.isFeedingDue;
  }

  if (tag === NOTIFICATION_TAG.temperature) {
    if (!subjects.lastTemperatureAt) return false;
    return (
      subjects.lastTemperatureAt.getTime() >=
      lastTemperatureSlotAt(subjects.temperatureTimes, subjects.now)
    );
  }

  if (tag.startsWith(TASK_TAG_PREFIX)) {
    return subjects.doneTaskIds.includes(tag.slice(TASK_TAG_PREFIX.length));
  }

  return false;
};

// --- ここからネイティブ版だけの話 ---

/**
 * 出ているお知らせから、そのタグを取る。分からなければ null（触らない）。
 *
 * 出どころが2つあり、取り方が違う。
 *
 * **アプリを閉じている間に届いた分**はFCMがそのまま出すので、expo-notifications から見ると
 * 「よそのお知らせ」になる。このとき identifier は
 * `expo-notifications://foreign_notifications?tag=<タグ>&id=<番号>` の形に組み立てられ、
 * 送るときに付けたタグがそこに入っている（expo-notifications の ExpoPresentationDelegate）。
 *
 * **開いている間に届いた分**は expo-notifications 自身が出すので、identifier はFCMの
 * メッセージidになりタグは入らない。こちらは data から組み立て直す（送る側
 * supabase/functions/_shared/deliver.ts の tagOf と同じ規則）。
 */
export const notificationTagOf = (
  identifier: string,
  data: Record<string, unknown> | null | undefined,
): string | null => {
  const foreign = /[?&]tag=([^&]*)/.exec(identifier);
  if (identifier.startsWith('expo-notifications://') && foreign) {
    return decodeURIComponent(foreign[1]);
  }

  const kind = data?.kind;
  if (typeof kind === 'string' && kind in NOTIFICATION_TAG) {
    return NOTIFICATION_TAG[kind as keyof typeof NOTIFICATION_TAG];
  }

  const taskId = data?.taskId;
  if (typeof taskId === 'string' && taskId) return `${TASK_TAG_PREFIX}${taskId}`;

  return null;
};

/**
 * 判断の材料を集める。
 *
 * PWA版は1つの画面が記録・体温・予定をまとめて持っているのでそこから渡せるが、
 * ネイティブ版はタブごとに別々に持っていて、開いていないタブの分は無い。
 * そのため必要な分だけここで取り直す。**出ているお知らせが1つも無ければ呼ばない**ので、
 * 前面に戻るたびに毎回問い合わせが増えるわけではない。
 */
async function collectSubjects(userId: string): Promise<NotificationSubjects | null> {
  const membership = await getMyMembership(supabase, userId);
  const familyId = membership.familyId;
  if (!familyId) return null;

  // 記録した直後は圏外だとサーバーにまだ無いので、この端末の控え（送信待ちを含む）も見る。
  // サーバーへの問い合わせが失敗しても、控えだけで判断できるようにここでは止めない。
  const now = Date.now();
  const cacheFrom = new Date(now - 3 * DAY_MS);
  const cacheTo = new Date(now + DAY_MS);
  const [
    milkLogs,
    temperatureLogs,
    familyNursing,
    cachedLogs,
    feedingSettings,
    temperatureTimes,
    tasks,
    nursing,
    localNursing,
  ] = await Promise.all([
    // 目安に要るのは前回の授乳だけ、平熱ではなく直近の1件だけ、という具合に最小限にする。
    listRecentMilkLogs(supabase, familyId, 1).catch(() => []),
    listRecentTemperatureLogs(supabase, familyId, 1).catch(() => []),
    listFamilyNursingState(supabase).catch(() => []),
    readCachedLogsInRange(familyId, cacheFrom, cacheTo).catch(() => []),
    getFeedingSettings(supabase, familyId),
    getTemperatureReminderSettings(supabase, familyId),
    listTasks(supabase, familyId),
    hasNursingSession(),
    localPendingNursing(),
  ]);

  const latestTime = (times: (Date | undefined)[]): Date | null =>
    times.reduce<Date | null>((best, at) => (at && (!best || at > best) ? at : best), null);
  const lastMilkAt = latestTime([
    milkLogs[0]?.time,
    ...cachedLogs.filter((log) => log.type === 'milk').map((log) => log.time),
  ]);
  const lastTemperatureAt = latestTime([
    temperatureLogs[0]?.time,
    ...cachedLogs.filter((log) => log.type === 'temperature').map((log) => log.time),
  ]);

  // 測り始めた時点で「そろそろ次の授乳」は済んだ扱い（母乳は保存まで記録に入らないため、
  // この端末の計測とパートナーが預けた印も前回の授乳として数える）。
  const pending = activePendingNursing(
    localNursing ? [...familyNursing, localNursing] : familyNursing,
    now,
  );
  const last = resolveLastFeeding(lastMilkAt, pending);
  const schedule = nextFeedingSchedule(last.lastFedAt, feedingSettings.intervalMinutes, now);

  return {
    // まだ一度も記録が無ければ目安の出しようがないので、消さずに残す。
    isFeedingDue: last.isNursing ? false : (schedule?.isOverdue ?? true),
    hasNursingSession: nursing,
    lastTemperatureAt,
    temperatureTimes,
    doneTaskIds: tasks.filter((task) => task.done).map((task) => task.id),
    now,
  };
}

/** いま端末に出ているお知らせのうち、用が済んだものを閉じる。 */
export async function closeSettledNotifications(userId: string): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  if (presented.length === 0) return;

  const subjects = await collectSubjects(userId);
  if (!subjects) return;

  for (const notification of presented) {
    const identifier = notification.request.identifier;
    const tag = notificationTagOf(
      identifier,
      notification.request.content.data as Record<string, unknown> | undefined,
    );
    if (tag && isSettledNotification(tag, subjects)) {
      await Notifications.dismissNotificationAsync(identifier);
    }
  }
}

/**
 * 用が済んだお知らせを閉じる。アプリ全体で1回だけ動かす。
 *
 * 開いたとき・前面に戻ったときに加えて、記録や計測の開始の直後にも見る
 * （notificationCleanupTrigger.ts）。PWA版が visibilitychange で取り直しているのと
 * 同じ間合い（src/components/sukusuku/SukusukuApp.tsx）。
 */
export function useSettledNotificationCleanup(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;

    const run = () => {
      // 消せなくても記録そのものには関わらないので、ここで止めない。
      void closeSettledNotifications(userId).catch((err: unknown) =>
        console.error('Failed to close settled notifications:', err),
      );
    };

    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    // アプリを開いている最中の記録・計測開始でも見直す。
    const unsubscribe = onNotificationCleanupRequest(run);
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, [userId]);
}
