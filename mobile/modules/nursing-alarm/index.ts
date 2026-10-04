// 授乳中だけ動く前面サービス（Kotlin）への受け口。
//
// 経過時間を数えるのも音・振動を鳴らすのもサービス側で、ここは「いまどの区切りを何時から
// 測っているか」を渡すだけ。区切りの切り替えも新しい baselineAt での start として渡す。
//
// 前面サービスは開発ビルド（CIの `.apk` か `npm run prebuild && npm run android`）にしか
// 入らないため、Expo Go では常に null になる。呼ぶ側は isNursingAlarmAvailable() で分岐する。

import { requireOptionalNativeModule } from 'expo';

// アプリ側の NursingPhase と同じ並び。前面サービスはアプリの型に依らず単体で成り立たせたいので、
// ここでは持ち込まずに同じ形を書いておく（`@/types/app` の NursingPhase と合わせること）。
export type NursingAlarmPhase = 'left' | 'right' | 'burp';

export interface NursingAlarmTarget {
  /** いま測っている区切り。左・右・ゲップのいずれか。 */
  phase: NursingAlarmPhase;
  /** その区切りの合計時間が0だった時刻(epoch ms)。経過分数 = now - baselineAt。 */
  baselineAt: number;
  /** 1区切りの長さ（分）。ここに達したらお知らせが1回鳴る。 */
  phaseMinutes: number;
}

interface NursingAlarmNativeModule {
  start(phase: string, baselineAt: number, phaseMinutes: number): Promise<void>;
  stop(): Promise<void>;
  scheduleWakeAlarm(triggerAt: number, dueAt: number): Promise<void>;
  cancelWakeAlarm(): Promise<void>;
  dismissWakeRing(): Promise<void>;
  getScheduledWakeAlarm(): Promise<number>;
}

const nativeModule = requireOptionalNativeModule<NursingAlarmNativeModule>('NursingAlarm');

/** 前面サービスを呼べる状態か（開発ビルドで動いているか）。 */
export const isNursingAlarmAvailable = (): boolean => nativeModule !== null;

export async function startNursingAlarm(target: NursingAlarmTarget): Promise<void> {
  await nativeModule?.start(target.phase, target.baselineAt, target.phaseMinutes);
}

export async function stopNursingAlarm(): Promise<void> {
  await nativeModule?.stop();
}

// --- 夜間の起床アラーム（docs/night-wake-alarm.md） ---
//
// 次の授乳の目安の少し前に、端末の目覚まし（AlarmManager）で起床用の音を鳴らす。
// 予約は端末に預けるだけで、いつ・どんなときに予約するかはアプリ側（mobile/src/lib/wakeAlarm.ts）が決める。
// Expo Go などネイティブが無い環境では、どれも何もしない。

/** 起床アラームを予約する（既にあれば置き換える）。時刻はどちらも epoch ms。 */
export async function scheduleWakeAlarm(triggerAt: number, dueAt: number): Promise<void> {
  await nativeModule?.scheduleWakeAlarm(triggerAt, dueAt);
}

/** 起床アラームの予約を取り消す。 */
export async function cancelWakeAlarm(): Promise<void> {
  await nativeModule?.cancelWakeAlarm();
}

/** 鳴っている起床アラームを止める。止められなかった自動停止のあとに残る通知も消える。 */
export async function dismissWakeRing(): Promise<void> {
  await nativeModule?.dismissWakeRing();
}

/** いま予約している鳴らす時刻(epoch ms)。予約が無い・ネイティブが無いときは null。 */
export async function getScheduledWakeAlarm(): Promise<number | null> {
  const triggerAt = (await nativeModule?.getScheduledWakeAlarm()) ?? 0;
  return triggerAt > 0 ? triggerAt : null;
}
