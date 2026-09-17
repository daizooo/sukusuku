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
