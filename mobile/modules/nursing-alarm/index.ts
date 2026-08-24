// 授乳中だけ動く前面サービス（Kotlin）への受け口。
//
// 経過時間を数えるのも音・振動を鳴らすのもサービス側で、ここは「いまどちらを何時から
// 測っているか」を渡すだけ。左右の切り替えも新しい baselineAt での start として渡す。
//
// 前面サービスは開発ビルド（`npm run prebuild && npm run android`）にしか入らないため、
// Expo Go では常に null になる。呼ぶ側は isNursingAlarmAvailable() で分岐する。

import { requireOptionalNativeModule } from 'expo';

export interface NursingAlarmTarget {
  side: 'left' | 'right';
  /** その側の合計時間が0だった時刻(epoch ms)。経過分数 = now - baselineAt。 */
  baselineAt: number;
  /** 何分ごとに知らせるか。鳴り方（長短）はこの値に関係なく同じ数え方で組み立てる。 */
  intervalMinutes: number;
}

interface NursingAlarmNativeModule {
  start(side: string, baselineAt: number, intervalMinutes: number): Promise<void>;
  stop(): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<NursingAlarmNativeModule>('NursingAlarm');

/** 前面サービスを呼べる状態か（開発ビルドで動いているか）。 */
export const isNursingAlarmAvailable = (): boolean => nativeModule !== null;

export async function startNursingAlarm(target: NursingAlarmTarget): Promise<void> {
  await nativeModule?.start(target.side, target.baselineAt, target.intervalMinutes);
}

export async function stopNursingAlarm(): Promise<void> {
  await nativeModule?.stop();
}
