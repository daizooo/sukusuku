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
// 区切りごとに長短を組み立てて鳴らす。画面が消えていてもアプリを閉じていても圏外でも鳴り、
// マナーモードでも鳴る（docs/native-app-android.md §3の案②）。
//
// 前面サービスは開発ビルドにしか入らないので、Expo Goでは代わりにJSのタイマーで振動だけさせる。
// アプリを開いている間しか効かない控えめなもので、フェーズ1の確認用。

export type { NursingAlarmTarget };

/** 何分ごとに知らせるか。設定画面はフェーズ2の設定タブで作るので、いまは既定値のまま使う。 */
export const NURSING_ALARM_INTERVAL_MINUTES = 5;

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
/** 何回目のお知らせまで鳴らしたか。アプリを開いている間だけの数えなので控えない。 */
let fallbackNotifiedStep = 0;

const fallbackTick = () => {
  if (!fallbackTarget) return;
  const elapsedMinutes = Math.floor(Math.max(0, Date.now() - fallbackTarget.baselineAt) / 60000);
  const step = Math.floor(elapsedMinutes / fallbackTarget.intervalMinutes);
  if (step < 1 || step <= fallbackNotifiedStep) return;
  fallbackNotifiedStep = step;
  const sequence = toVibrationSequence(buildAlarmPattern(step * fallbackTarget.intervalMinutes));
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
  // 切り替え前の側で鳴らした分をもう一度鳴らさないよう、いまの経過ぶんまで進めておく。
  fallbackNotifiedStep = Math.floor(
    Math.max(0, Date.now() - target.baselineAt) / 60000 / target.intervalMinutes,
  );
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
