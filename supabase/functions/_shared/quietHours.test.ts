// 実行: npm run test:quiet-hours
import assert from 'node:assert/strict';

import { isWithinQuietHours, minutesOfDayJst } from './quietHours.ts';

const jst = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00+09:00`).getTime();
const NIGHT: [number, number] = [22 * 60, 6 * 60];

assert.equal(minutesOfDayJst(jst('00:00')), 0);
assert.equal(minutesOfDayJst(new Date('2026-10-04T15:00:00Z').getTime()), 0, 'UTCの前日でも日本時間で数える');

// 日をまたぐ 22:00〜6:00
assert.equal(isWithinQuietHours(jst('22:00'), ...NIGHT), true, '開始ちょうどは含む');
assert.equal(isWithinQuietHours(jst('03:30'), ...NIGHT), true);
assert.equal(isWithinQuietHours(jst('05:59'), ...NIGHT), true);
assert.equal(isWithinQuietHours(jst('06:00'), ...NIGHT), false, '終了ちょうどは含まない');
assert.equal(isWithinQuietHours(jst('12:00'), ...NIGHT), false);
assert.equal(isWithinQuietHours(jst('21:59'), ...NIGHT), false);

// 日をまたがない 13:00〜15:00
assert.equal(isWithinQuietHours(jst('13:00'), 13 * 60, 15 * 60), true);
assert.equal(isWithinQuietHours(jst('15:00'), 13 * 60, 15 * 60), false);
assert.equal(isWithinQuietHours(jst('03:00'), 13 * 60, 15 * 60), false);

// 設定なし（null）・開始と終了が同じ → いつでも届く
assert.equal(isWithinQuietHours(jst('03:00'), null, null), false);
assert.equal(isWithinQuietHours(jst('03:00'), 60, null), false);
assert.equal(isWithinQuietHours(jst('03:00'), 60, 60), false);

console.log('quietHours: ok');
