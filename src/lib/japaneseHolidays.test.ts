// 祝日の数え方（ハッピーマンデー・春分秋分・振替休日・国民の休日）が、
// 内閣府が公表している暦と食い違わないことを確かめる。
// 実行: npm run test:holiday
import assert from 'node:assert/strict';

import { getHolidayName, isHoliday } from './japaneseHolidays.ts';

const name = (year: number, month: number, day: number) =>
  getHolidayName(new Date(year, month - 1, day));

// 日にちが決まっている祝日。
assert.equal(name(2026, 1, 1), '元日');
assert.equal(name(2026, 5, 5), 'こどもの日');
assert.equal(name(2026, 11, 23), '勤労感謝の日');

// ハッピーマンデー。その月の第n月曜日に動く。
assert.equal(name(2026, 1, 12), '成人の日');
assert.equal(name(2025, 1, 13), '成人の日');
assert.equal(name(2026, 7, 20), '海の日');
assert.equal(name(2026, 10, 12), 'スポーツの日');

// 春分・秋分は年ごとに1日ずれる。
assert.equal(name(2026, 3, 20), '春分の日');
assert.equal(name(2025, 3, 20), '春分の日');
assert.equal(name(2027, 3, 21), '春分の日');
assert.equal(name(2026, 9, 23), '秋分の日');

// 日曜と重なった祝日は次の平日へ振り替わる（2026年の憲法記念日は日曜）。
assert.equal(name(2026, 5, 3), '憲法記念日');
assert.equal(name(2026, 5, 6), '振替休日');
// みどりの日・こどもの日が続くので、振替は5/4や5/5ではなく5/6になる。
assert.equal(name(2026, 5, 4), 'みどりの日');

// 敬老の日と秋分の日に挟まれた平日は国民の休日。
assert.equal(name(2026, 9, 21), '敬老の日');
assert.equal(name(2026, 9, 22), '国民の休日');

// 何でもない日は祝日にしない。
assert.equal(name(2026, 6, 1), null);
assert.equal(isHoliday(new Date(2026, 5, 1)), false);
assert.equal(isHoliday(new Date(2026, 8, 22)), true);

console.log('japaneseHolidays: OK');
