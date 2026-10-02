// recurringReminders.ts（繰り返す予定の通知する回を求める）の検証。
//
//   npm run test:recurring-reminders
import assert from 'node:assert/strict';
import { dueRecurringReminders, toRule, type RecurringTaskRow } from './recurringReminders.ts';

const task = (patch: Partial<RecurringTaskRow>): RecurringTaskRow => ({
  id: 't1',
  family_id: 'f1',
  title: '体操',
  category: null,
  place: null,
  start_time: '10:00',
  start_date: '2026-10-02',
  recurrence: { freq: 'weekly', interval: 1, byWeekday: [5], end: { type: 'never' } },
  done_dates: [],
  ...patch,
});
const at = (iso: string) => Date.parse(iso);
const LOOKBACK = 120;

// 2026-10-09(金) 10:00 JST ちょうど → その回が対象。
let rows = dueRecurringReminders([task({})], at('2026-10-09T10:00:00+09:00'), LOOKBACK);
assert.equal(rows.length, 1);
assert.equal(rows[0].target_date, '2026-10-09');
assert.equal(rows[0].remind_at, '2026-10-09T01:00:00.000Z');
assert.equal(rows[0].remind_minutes_before, 0);

// 2時間さかのぼった範囲に入る（取りこぼし拾い）。範囲より前は対象外。
assert.equal(dueRecurringReminders([task({})], at('2026-10-09T11:30:00+09:00'), LOOKBACK).length, 1);
assert.equal(dueRecurringReminders([task({})], at('2026-10-09T12:01:00+09:00'), LOOKBACK).length, 0);
// 通知時刻の前（先取りしない）は対象外。
assert.equal(dueRecurringReminders([task({})], at('2026-10-09T09:59:00+09:00'), LOOKBACK).length, 0);
// 回の無い日（土曜）は対象外。
assert.equal(dueRecurringReminders([task({})], at('2026-10-10T10:00:00+09:00'), LOOKBACK).length, 0);

// 完了にした回は通知しない。ほかの回には影響しない。
const done = task({ done_dates: ['2026-10-09'] });
assert.equal(dueRecurringReminders([done], at('2026-10-09T10:00:00+09:00'), LOOKBACK).length, 0);
assert.equal(dueRecurringReminders([done], at('2026-10-16T10:00:00+09:00'), LOOKBACK).length, 1);

// 終日（時刻なし）は朝9時。
const allDay = task({ start_time: null });
assert.equal(dueRecurringReminders([allDay], at('2026-10-09T09:00:00+09:00'), LOOKBACK).length, 1);
assert.equal(dueRecurringReminders([allDay], at('2026-10-09T08:59:00+09:00'), LOOKBACK).length, 0);

// 日本時間の日付で数える: UTCでは前日の 16:00 でも、日本時間の朝9時の回を拾う。
const utcPrevDay = at('2026-10-08T15:30:00Z'); // = JST 2026-10-09 00:30
assert.equal(dueRecurringReminders([allDay], utcPrevDay, LOOKBACK).length, 0);
assert.equal(dueRecurringReminders([allDay], at('2026-10-09T00:00:00Z'), LOOKBACK).length, 1); // JST 09:00

// 終了日を過ぎた回は通知しない。
const ended = task({ recurrence: { freq: 'daily', interval: 1, end: { type: 'until', date: '2026-10-05' } } });
assert.equal(dueRecurringReminders([ended], at('2026-10-05T10:00:00+09:00'), LOOKBACK).length, 1);
assert.equal(dueRecurringReminders([ended], at('2026-10-06T10:00:00+09:00'), LOOKBACK).length, 0);

// 壊れたルール・開始日なしは読み飛ばす（ほかの予定の通知を止めない）。
const broken = [task({ id: 'b1', recurrence: { freq: 'hourly' } }), task({ id: 'b2', start_date: null }), task({ id: 'ok' })];
rows = dueRecurringReminders(broken, at('2026-10-09T10:00:00+09:00'), LOOKBACK);
assert.deepEqual(rows.map((r) => r.task_id), ['ok']);

assert.equal(toRule(null), null);
assert.equal(toRule({ freq: 'daily', interval: 0, end: { type: 'never' } }), null);
assert.equal(toRule({ freq: 'daily', interval: 1, end: { type: 'count' } }), null);

console.log('recurringReminders: OK');
