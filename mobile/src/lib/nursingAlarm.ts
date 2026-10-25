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
// 5分たつごとに鳴らす。画面が消えていてもアプリを閉じていても圏外でも鳴り、
// マナーモードでも鳴る（docs/native-app-android.md §3の案②）。
//
// 鳴る回数は経過時間で変わる（5分=1回、10分=2回…。規則は src/lib/alarmPattern.ts）ので、
// 画面を見なくても何分たったかが分かる（PWA版 src/lib/nursingTimer.ts と同じ考え方）。
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
/** どこまで鳴らし終えたか（何回目の5分か）。アプリを開いている間だけの数えなので控えない。 */
let fallbackStep = 0;

/** いま何回目の5分か。 */
const currentStep = (target: NursingAlarmTarget): number =>
  Math.floor(Math.max(0, Date.now() - target.baselineAt) / (target.phaseMinutes * 60_000));

const fallbackTick = () => {
  if (!fallbackTarget) return;
  const step = currentStep(fallbackTarget);
  if (step <= fallbackStep) return;
  fallbackStep = step;
  const sequence = toVibrationSequence(buildAlarmPattern(step * fallbackTarget.phaseMinutes));
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
  // 預け直しで鳴り直さないよう、すでに過ぎた5分は鳴らし済みとして始める。
  fallbackStep = currentStep(target);
  if (fallbackTimerId === null) fallbackTimerId = setInterval(fallbackTick, 1000);
};

/**
 * いま測っている側と、その側の合計時間が0だった時刻を、鳴らす側へ預ける。
 * 測っていなければ null を渡す（＝前面サービスを止め、常駐通知も消える）。
 *
 * 左右の切り替えも「新しい baselineAt での預け直し」として同じ入口を通る。
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
