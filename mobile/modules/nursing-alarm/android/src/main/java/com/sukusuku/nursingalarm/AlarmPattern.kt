package com.sukusuku.nursingalarm

import kotlin.math.roundToInt

/**
 * 鳴らし方のパターン。音（と振動）の回数だけで経過時間が分かるようにするため、
 * 30分を長音1回、その端数を5分ごとの短音1回で表す。
 * 例）5分=短1, 15分=短3, 30分=長1, 40分=長1+短2
 *
 * PWA版の `src/lib/alarm.ts` の規則をそのまま持ってきたもの。
 * 鳴り方の意味は体で覚えている部分なので、実装が変わっても変えない
 * （docs/native-app-rewrite.md §4）。
 *
 * いまの授乳のお知らせは区切り（5分）ごとに1回なので、実際に鳴るのは短音1回だけ。
 * 規則そのものはPWA版と同じ形で残してある。
 */
data class AlarmPattern(val long: Int, val short: Int) {
  val isEmpty: Boolean get() = long == 0 && short == 0
}

/** 長音1回で表す分数。 */
const val LONG_UNIT_MINUTES = 30

/** 短音1回で表す分数。 */
const val SHORT_UNIT_MINUTES = 5

/** 経過分数を、長音（30分）と短音（5分）の回数に分解する。 */
fun buildAlarmPattern(elapsedMinutes: Int): AlarmPattern {
  val long = elapsedMinutes / LONG_UNIT_MINUTES
  val remainder = elapsedMinutes - long * LONG_UNIT_MINUTES
  return AlarmPattern(long, (remainder.toDouble() / SHORT_UNIT_MINUTES).roundToInt())
}

/**
 * [振動, 停止, 振動, 停止, ...] のミリ秒の並びに変換する（長い振動=30分、短い振動=5分）。
 * 末尾の停止時間は付けない。
 */
fun AlarmPattern.toVibrationSequence(): LongArray {
  val sequence = mutableListOf<Long>()
  repeat(long) {
    sequence.add(700)
    sequence.add(250)
  }
  // 長い振動と短い振動の境目は長めに空けて、感じ分けやすくする。
  if (long > 0 && short > 0) sequence[sequence.size - 1] = 600
  repeat(short) {
    sequence.add(250)
    sequence.add(200)
  }
  if (sequence.isNotEmpty()) sequence.removeAt(sequence.size - 1)
  return sequence.toLongArray()
}
