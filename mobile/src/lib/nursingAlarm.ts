import { PermissionsAndroid, Platform, Vibration } from 'react-native';
import {
  isNursingAlarmAvailable,
  startNursingAlarm,
  stopNursingAlarm,
  type NursingAlarmTarget,
} from '../../modules/nursing-alarm';
import { buildAlarmPattern, toVibrationSequence } from '@/lib/alarmPattern';

// 授乳中のお知らせを、どこで鳴らすかを決める層。
//
// 本命は前面サービス（modules/nursing-alarm）。授乳中だけ常駐通知を出しながら経過時間を数え、
// 区切りが5分に達したところで1回だけ鳴らす。画面が消えていてもアプリを閉じていても圏外でも鳴り、
// マナーモードでも鳴る（docs/native-app-android.md §3の案②）。
//
// 鳴らすのは区切りごとに1回だけで、鳴らし続けない。ほしいのは「次へ移る合図」であって、
// 鳴り続けると赤ちゃんも親も休めないため（PWA版 src/lib/nursingTimer.ts と同じ考え方）。
//
// 前面サービスは開発ビルドにしか入らないので、Expo Goでは代わりにJSのタイマーで振動だけさせる。
// アプリを開いている間しか効かない控えめなもので、画面の確認用。

export type { NursingAlarmTarget };

export const isNursingForegroundServiceAvailable = isNursingAlarmAvailable;

/**
 * 常駐通知を出す許可をもらう。Android 13以降は実行時の許可が要り、
 * 無いと前面サービスを始めても通知が出ない（サービス自体は動く）。
 */
export async function requestNursingNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || typeof Platform.Version !== 'number' || Platform.Version < 33) {
    return true;
  }
  const result = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// --- 前面サービスが無いときの代わり（Expo Go）---

let fallbackTimerId: ReturnType<typeof setInterval> | null = null;
let fallbackTarget: NursingAlarmTarget | null = null;
/** いまの区切りで鳴らし終えたか。アプリを開いている間だけの数えなので控えない。 */
let fallbackNotified = false;

/** その区切りが何分たったか。 */
const elapsedMinutes = (target: NursingAlarmTarget): number =>
  Math.floor(Math.max(0, Date.now() - target.baselineAt) / 60000);

const fallbackTick = () => {
  if (!fallbackTarget || fallbackNotified) return;
  if (elapsedMinutes(fallbackTarget) < fallbackTarget.phaseMinutes) return;
  fallbackNotified = true;
  const sequence = toVibrationSequence(buildAlarmPattern(fallbackTarget.phaseMinutes));
  if (sequence.length > 0) Vibration.vibrate(sequence);
};

const applyFallback = (target: NursingAlarmTarget | null) => {
  fallbackTarget = target;
  if (!target) {
    if (fallbackTimerId !== null) clearInterval(fallbackTimerId);
    fallbackTimerId = null;
    Vibration.cancel();
    return;
  }
  // 預け直しで鳴り直さないよう、もう5分を過ぎている区切りは鳴らし済みとして始める。
  fallbackNotified = elapsedMinutes(target) >= target.phaseMinutes;
  if (fallbackTimerId === null) fallbackTimerId = setInterval(fallbackTick, 1000);
};

/**
 * いま測っている区切りと、その区切りの合計時間が0だった時刻を、鳴らす側へ預ける。
 * 測っていなければ null を渡す（＝前面サービスを止め、常駐通知も消える）。
 *
 * 区切りの切り替えも「新しい baselineAt での預け直し」として同じ入口を通る。
 */
export function applyNursingAlarm(target: NursingAlarmTarget | null): void {
  if (!isNursingAlarmAvailable()) {
    applyFallback(target);
    return;
  }
  if (target) {
    void startNursingAlarm(target);
  } else {
    void stopNursingAlarm();
  }
}
