// 端末ごとの「おやすみ時間」に、通知の時刻が入っているか（docs/night-wake-alarm.md §6）。
//
// アプリ側の判断（mobile/src/lib/wakeAlarmPlan.ts の isWithinQuietHours）と同じ規則。
// 向こうは起床アラームを鳴らすか、こちらは通知を止めるかの違いだけで、
// 同じ時間帯を見るので、2か所の規則を揃えること（テスト: npm run test:quiet-hours）。

const JST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MINUTES = 24 * 60;

/** その時刻の、日本時間の0:00からの分(0〜1439)。 */
export function minutesOfDayJst(at: number): number {
  const minutes = Math.floor((at + JST_OFFSET_MS) / 60_000);
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

/**
 * 開始〜終了のなか（開始を含み終了を含まない）か。開始 > 終了なら日をまたぐ。
 * 開始と終了が同じ、またはどちらかが null なら「おやすみ時間なし」で、いつでも false。
 */
export function isWithinQuietHours(
  at: number,
  start: number | null,
  end: number | null,
): boolean {
  if (start === null || end === null || start === end) return false;
  const minutes = minutesOfDayJst(at);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
