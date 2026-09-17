// 授乳のお知らせの「鳴り方」の規則。
//
// 音（と振動）の回数だけで経過時間が分かるようにするため、30分を長音1回、
// その端数を5分ごとの短音1回で表す。
// 例）5分=短1, 15分=短3, 30分=長1, 40分=長1+短2
// いまの授乳のお知らせは区切り（5分）ごとに1回なので、実際に鳴るのは短音1回だけ。
// 規則そのものはPWA版と同じ形で残してある。
//
// PWA版の `src/lib/alarm.ts` から規則だけを持ってきたもの。鳴らすのは前面サービス（Kotlin）で、
// 同じ規則が modules/nursing-alarm/android/.../AlarmPattern.kt にもある。
// こちらは前面サービスが無い環境（Expo Go）での振動だけのフォールバックに使う。

/** 長音1回で表す分数。 */
export const LONG_UNIT_MINUTES = 30;

/** 短音1回で表す分数。 */
export const SHORT_UNIT_MINUTES = 5;

export interface AlarmPattern {
  long: number;
  short: number;
}

/** 経過分数を、長音（30分）と短音（5分）の回数に分解する。 */
export const buildAlarmPattern = (elapsedMinutes: number): AlarmPattern => {
  const long = Math.floor(elapsedMinutes / LONG_UNIT_MINUTES);
  const remainder = elapsedMinutes - long * LONG_UNIT_MINUTES;
  return { long, short: Math.round(remainder / SHORT_UNIT_MINUTES) };
};

/**
 * React Native の Vibration.vibrate に渡す並びへ変換する。
 * Androidでは [鳴らすまでの待ち時間, 振動, 停止, 振動, ...] の順に読まれるので、先頭に0を置く。
 */
export const toVibrationSequence = ({ long, short }: AlarmPattern): number[] => {
  const sequence: number[] = [];
  for (let i = 0; i < long; i += 1) sequence.push(700, 250);
  // 長い振動と短い振動の境目は長めに空けて、感じ分けやすくする。
  if (long > 0 && short > 0) sequence[sequence.length - 1] = 600;
  for (let i = 0; i < short; i += 1) sequence.push(250, 200);
  sequence.pop(); // 末尾の停止時間は不要
  return sequence.length === 0 ? [] : [0, ...sequence];
};
