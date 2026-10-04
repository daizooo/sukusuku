import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cancelWakeAlarm,
  dismissWakeRing,
  isNursingAlarmAvailable,
  scheduleWakeAlarm,
} from '../../modules/nursing-alarm';
import { supabase } from '@/lib/supabase';
import { getMyMembership } from '@/lib/api/me';
import { listRecentMilkLogs } from '@/lib/api/careLogs';
import { listFamilyNursingState } from '@/lib/api/nursingAlarms';
import { getFeedingSettings } from '@/lib/api/feedingSettings';
import { readCachedLogsInRange } from '@/lib/offline/careLogs';
import { activePendingNursing, resolveLastFeeding } from '@/lib/feedingSchedule';
import { localPendingNursing } from '@/lib/nursingTimer';
import { onNotificationCleanupRequest } from '@/lib/notificationCleanupTrigger';
import { planWakeAlarm } from '@/lib/wakeAlarmPlan';
import { loadWakeAlarmSettings, onWakeAlarmSettingsChange } from '@/lib/wakeAlarmSettings';
import { getPushTokenIfAllowed } from '@/lib/push';
import { saveFeedingQuietHours } from '@/lib/api/pushSubscriptions';

// 夜間の起床アラームの予約を、いまのデータに合わせて組み直す（docs/night-wake-alarm.md §3・§4）。
//
// 予約は端末の目覚まし（ネイティブ）に預けてあるので、鳴るのは通信が無くても確実。
// その代わり「次の授乳の目安」が動いたら、こちらから組み直さないと古い時刻のまま鳴る。
// 組み直すきっかけは次のとおり。
//
//   - アプリを開いた・前面に戻ったとき
//   - 授乳を記録・修正・削除した、計測を始めた（notificationCleanupTrigger の合図）
//   - この設定（オン/オフ・おやすみ時間）を変えたとき
//
// 端末の再起動はネイティブ側（WakeAlarmBootReceiver）が控えから掛け直す。
// 相手が記録しても、この端末は次に開くまで気づけない。そのあいだ古い予約が鳴ること
// （空振り）は許容している（寝過ごすよりよいため）。

const DAY_MS = 24 * 60 * 60_000;
const BASICS_KEY = 'sukusuku.wakeAlarm.basics';

/** 圏外でも組み直せるよう、前に取れた家族のidと間隔を控えておく。 */
interface Basics {
  familyId: string;
  intervalMinutes: number;
}

async function loadBasics(userId: string): Promise<Basics | null> {
  try {
    const membership = await getMyMembership(supabase, userId);
    if (!membership.familyId) return null;
    const settings = await getFeedingSettings(supabase, membership.familyId);
    const basics = { familyId: membership.familyId, intervalMinutes: settings.intervalMinutes };
    await AsyncStorage.setItem(BASICS_KEY, JSON.stringify(basics)).catch(() => undefined);
    return basics;
  } catch {
    try {
      const raw = await AsyncStorage.getItem(BASICS_KEY);
      return raw ? (JSON.parse(raw) as Basics) : null;
    } catch {
      return null;
    }
  }
}

/** 予約を組み直す。取れなかったら何もしない（いまの予約を残す）。 */
export async function syncWakeAlarm(userId: string): Promise<void> {
  if (!isNursingAlarmAvailable()) return;

  const settings = await loadWakeAlarmSettings();
  if (!settings.enabled) {
    await cancelWakeAlarm();
    return;
  }

  const basics = await loadBasics(userId);
  if (!basics) return;

  const now = Date.now();
  // 記録した直後は圏外だとサーバーにまだ無いので、この端末の控え（送信待ちを含む）も見る
  // （notificationCleanup.ts の collectSubjects と同じ材料）。
  const [milkLogs, familyNursing, cachedLogs, localNursing] = await Promise.all([
    listRecentMilkLogs(supabase, basics.familyId, 1).catch(() => []),
    listFamilyNursingState(supabase).catch(() => []),
    readCachedLogsInRange(
      basics.familyId,
      new Date(now - 3 * DAY_MS),
      new Date(now + DAY_MS),
    ).catch(() => []),
    localPendingNursing(),
  ]);

  const lastMilkAt = [
    milkLogs[0]?.time,
    ...cachedLogs.filter((log) => log.type === 'milk').map((log) => log.time),
  ].reduce<Date | null>((best, at) => (at && (!best || at > best) ? at : best), null);

  const pending = activePendingNursing(
    localNursing ? [...familyNursing, localNursing] : familyNursing,
    now,
  );
  const plan = planWakeAlarm({
    enabled: true,
    quiet: settings.quiet,
    lastFeeding: resolveLastFeeding(lastMilkAt, pending),
    intervalMinutes: basics.intervalMinutes,
    now,
  });

  if (plan) {
    await scheduleWakeAlarm(plan.triggerAt, plan.dueAt);
  } else {
    await cancelWakeAlarm();
  }
}

/**
 * 「おやすみ時間は次の授乳の通知を止める」を、この端末の宛先の行に写す。
 *
 * 止めるのはサーバー（send-feeding-reminders）なので、設定を変えたときだけでなく、
 * アプリを開くたびに合わせ直す（通知を入れ直して行が作り直されると、列が空に戻るため）。
 * 通知をオンにしていない端末には宛先がなく、何も起きない。
 */
export async function syncFeedingQuietHours(): Promise<void> {
  const settings = await loadWakeAlarmSettings();
  const token = await getPushTokenIfAllowed();
  if (!token) return;
  await saveFeedingQuietHours(supabase, token, settings.muteFeedingNotifications ? settings.quiet : null);
}

/**
 * 起床アラームの予約をアプリ全体で1つだけ見守る。ネイティブが無い環境では何もしない。
 *
 * 前面に戻ったときは、鳴っている起床アラームも止める（アプリを開く操作で止まる仕様）。
 */
export function useWakeAlarmSync(userId: string | null): void {
  useEffect(() => {
    if (!userId || !isNursingAlarmAvailable()) return;

    // 同時に何本も走らせない。走っている間に合図が来たら、終わってからもう1回だけ回す。
    let running = false;
    let again = false;
    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          // 通知を止める設定の反映が圏外で失敗しても、起床アラームの予約は組み直す。
          await syncFeedingQuietHours().catch((err: unknown) =>
            console.error('Failed to sync feeding quiet hours:', err),
          );
          await syncWakeAlarm(userId);
        } while (again);
      } catch (err) {
        // 予約を組み直せなくても、いまの予約は残るので止めない。
        console.error('Failed to sync wake alarm:', err);
      } finally {
        running = false;
      }
    };

    void run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void dismissWakeRing();
      void run();
    });
    const unsubscribeCleanup = onNotificationCleanupRequest(() => void run());
    const unsubscribeSettings = onWakeAlarmSettingsChange(() => void run());
    return () => {
      subscription.remove();
      unsubscribeCleanup();
      unsubscribeSettings();
    };
  }, [userId]);
}
