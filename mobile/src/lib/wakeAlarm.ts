import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cancelWakeAlarm,
  dismissWakeRing,
  getScheduledWakeAlarm,
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
import { evaluateWakeAlarm } from '@/lib/wakeAlarmPlan';
import { publishWakeAlarmStatus } from '@/lib/wakeAlarmStatus';
import { loadWakeAlarmSettings, onWakeAlarmSettingsChange } from '@/lib/wakeAlarmSettings';

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
const TEST_KEY = 'sukusuku.wakeAlarm.testAt';

/** 設定画面の「テスト鳴動」までの待ち時間。 */
const TEST_DELAY_MS = 10_000;

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

/**
 * 設定画面の「テスト鳴動」。10秒後に鳴らす予約を入れる（実際の予約と同じ仕組みを通る）。
 * 音が出るか・マナーモードや通知の設定で消されていないか、を昼間のうちに確かめるためのもの。
 * 鳴るまでのあいだは、組み直しがこの予約を取り消さないよう、時刻を控えておく。
 */
export async function scheduleTestWakeAlarm(): Promise<void> {
  const now = Date.now();
  const triggerAt = now + TEST_DELAY_MS;
  await AsyncStorage.setItem(TEST_KEY, String(triggerAt));
  // 目安の時刻は15分後に置く（止めなければ5分後にもう一度鳴る＝再鳴動の確認もできる）。
  await scheduleWakeAlarm(triggerAt, now + 15 * 60_000);
  publishWakeAlarmStatus({ kind: 'test', triggerAt });
}

/** 予約を組み直す。取れなかったら何もしない（いまの予約を残す）。 */
export async function syncWakeAlarm(userId: string): Promise<void> {
  if (!isNursingAlarmAvailable()) return;

  // テスト鳴動の予約が鳴る前なら、組み直して取り消さない。
  const testAt = Number(await AsyncStorage.getItem(TEST_KEY).catch(() => null));
  if (testAt > Date.now()) {
    publishWakeAlarmStatus({ kind: 'test', triggerAt: testAt });
    return;
  }

  const settings = await loadWakeAlarmSettings();
  if (!settings.enabled) {
    await cancelWakeAlarm();
    publishWakeAlarmStatus({ kind: 'evaluated', evaluation: { kind: 'off' }, nativeTriggerAt: null });
    return;
  }

  const basics = await loadBasics(userId);
  if (!basics) {
    publishWakeAlarmStatus({ kind: 'no-family' });
    return;
  }

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
  const evaluation = evaluateWakeAlarm({
    enabled: true,
    quiet: settings.quiet,
    lastFeeding: resolveLastFeeding(lastMilkAt, pending),
    intervalMinutes: basics.intervalMinutes,
    now,
  });

  if (evaluation.kind === 'scheduled') {
    await scheduleWakeAlarm(evaluation.triggerAt, evaluation.dueAt);
  } else {
    await cancelWakeAlarm();
  }
  // 端末の目覚ましに本当に入ったかを読み戻して、設定画面に出す。
  publishWakeAlarmStatus({
    kind: 'evaluated',
    evaluation,
    nativeTriggerAt: await getScheduledWakeAlarm(),
  });
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
          await syncWakeAlarm(userId);
        } while (again);
      } catch (err) {
        // 予約を組み直せなくても、いまの予約は残るので止めない。
        console.error('Failed to sync wake alarm:', err);
        publishWakeAlarmStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
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
