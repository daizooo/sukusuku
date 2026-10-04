// 夜間の起床アラームの「いつ鳴らすか」の判断を確かめる。
// 日またぎ・過ぎた時刻・授乳中・記録待ちの境目で取りこぼさないことを見る。
// 実行: npm run test:wake-alarm
import assert from 'node:assert/strict';

import {
  DEFAULT_QUIET_HOURS,
  WAKE_LEAD_MINUTES,
  formatMinutesOfDay,
  isWithinQuietHours,
  minutesOfDayJst,
  planWakeAlarm,
  type QuietHours,
} from './wakeAlarmPlan.ts';
import { resolveLastFeeding, type LastFeeding } from './feedingSchedule.ts';

const at = (iso: string) => new Date(iso).getTime();
const jst = (hhmm: string, day = '2026-10-05') => at(`${day}T${hhmm}:00+09:00`);

// --- 日本時間の分 ---
assert.equal(minutesOfDayJst(jst('00:00')), 0);
assert.equal(minutesOfDayJst(jst('06:30')), 6 * 60 + 30);
assert.equal(minutesOfDayJst(jst('23:59')), 23 * 60 + 59);
// UTCの日付が前日でも、日本時間で数える。
assert.equal(minutesOfDayJst(at('2026-10-04T15:00:00Z')), 0);
assert.equal(formatMinutesOfDay(22 * 60), '22:00');
assert.equal(formatMinutesOfDay(6 * 60 + 5), '06:05');

// --- おやすみ時間（日をまたぐ 22:00〜6:00）---
const night = DEFAULT_QUIET_HOURS;
assert.equal(isWithinQuietHours(jst('22:00'), night), true, '開始ちょうどは含む');
assert.equal(isWithinQuietHours(jst('23:30'), night), true);
assert.equal(isWithinQuietHours(jst('00:00'), night), true, '日をまたいだ後');
assert.equal(isWithinQuietHours(jst('05:59'), night), true);
assert.equal(isWithinQuietHours(jst('06:00'), night), false, '終了ちょうどは含まない');
assert.equal(isWithinQuietHours(jst('12:00'), night), false);
assert.equal(isWithinQuietHours(jst('21:59'), night), false);

// 日をまたがない設定（昼寝 13:00〜15:00）。
const nap: QuietHours = { startMinutes: 13 * 60, endMinutes: 15 * 60 };
assert.equal(isWithinQuietHours(jst('13:00'), nap), true);
assert.equal(isWithinQuietHours(jst('14:59'), nap), true);
assert.equal(isWithinQuietHours(jst('15:00'), nap), false);
assert.equal(isWithinQuietHours(jst('03:00'), nap), false);

// 開始と終了が同じなら、おやすみ時間なし。
assert.equal(isWithinQuietHours(jst('03:00'), { startMinutes: 60, endMinutes: 60 }), false);

// --- planWakeAlarm ---
const INTERVAL = 180;
const fed = (iso: string): LastFeeding => ({
  lastFedAt: new Date(iso),
  isNursing: false,
  isPendingRecord: false,
});
const base = { enabled: true, quiet: night, intervalMinutes: INTERVAL };

// 夜 0:30 に飲ませ始めた → 目安 3:30（おやすみ中）→ 3:15 に鳴らす。
{
  const plan = planWakeAlarm({
    ...base,
    lastFeeding: fed('2026-10-05T00:30:00+09:00'),
    now: jst('00:40'),
  });
  assert.ok(plan);
  assert.equal(plan.dueAt, jst('03:30'));
  assert.equal(plan.triggerAt, jst('03:15'));
  assert.equal(plan.dueAt - plan.triggerAt, WAKE_LEAD_MINUTES * 60_000);
}

// 目安がおやすみ時間の外（昼）なら予約しない。
assert.equal(
  planWakeAlarm({ ...base, lastFeeding: fed('2026-10-05T10:00:00+09:00'), now: jst('10:10') }),
  null,
);

// 目安が 6:00 ちょうど → 外。5:59 → 中。判定は目安の時刻（鳴らす時刻 5:44 は中でも外でもよい）。
assert.equal(
  planWakeAlarm({ ...base, lastFeeding: fed('2026-10-05T03:00:00+09:00'), now: jst('03:10') }),
  null,
  '目安 6:00 は外',
);
{
  const plan = planWakeAlarm({
    ...base,
    lastFeeding: fed('2026-10-05T02:59:00+09:00'),
    now: jst('03:10'),
  });
  assert.ok(plan, '目安 5:59 は中');
  assert.equal(plan.triggerAt, jst('05:44'));
}

// 目安が 22:10（中）で、鳴らす時刻 21:55 は時間の外にはみ出ても鳴らす。
{
  const plan = planWakeAlarm({
    ...base,
    lastFeeding: fed('2026-10-05T19:10:00+09:00'),
    now: jst('19:20'),
  });
  assert.ok(plan);
  assert.equal(plan.triggerAt, jst('21:55'));
}

// 鳴らす時刻がもう過ぎている → いきなり鳴らさない（目安の時刻の通知が拾う）。
assert.equal(
  planWakeAlarm({ ...base, lastFeeding: fed('2026-10-05T00:30:00+09:00'), now: jst('03:20') }),
  null,
  '3:15 を過ぎている',
);
// ちょうど鳴らす時刻 → 過去扱い。
assert.equal(
  planWakeAlarm({ ...base, lastFeeding: fed('2026-10-05T00:30:00+09:00'), now: jst('03:15') }),
  null,
);

// オフなら予約しない。
assert.equal(
  planWakeAlarm({
    ...base,
    enabled: false,
    lastFeeding: fed('2026-10-05T00:30:00+09:00'),
    now: jst('00:40'),
  }),
  null,
);

// 記録がまだ1件もない。
assert.equal(
  planWakeAlarm({
    ...base,
    lastFeeding: { lastFedAt: null, isNursing: false, isPendingRecord: false },
    now: jst('00:40'),
  }),
  null,
);

// 授乳中（母乳を計測中）は予約しない。
assert.equal(
  planWakeAlarm({
    ...base,
    lastFeeding: resolveLastFeeding(new Date('2026-10-04T21:00:00+09:00'), {
      startedAt: new Date('2026-10-05T00:25:00+09:00'),
      stoppedAt: null,
    }),
    now: jst('00:30'),
  }),
  null,
);

// 記録待ち（測り終えて記録がまだ）は、止めた時刻から数える。0:45 に止めた → 目安 3:45 → 3:30 に鳴らす。
{
  const plan = planWakeAlarm({
    ...base,
    lastFeeding: resolveLastFeeding(new Date('2026-10-04T21:00:00+09:00'), {
      startedAt: new Date('2026-10-05T00:30:00+09:00'),
      stoppedAt: new Date('2026-10-05T00:45:00+09:00'),
    }),
    now: jst('00:50'),
  });
  assert.ok(plan);
  assert.equal(plan.dueAt, jst('03:45'));
  assert.equal(plan.triggerAt, jst('03:30'));
}

// 間隔の設定が効く（4時間: 0:30 → 4:30 → 4:15）。
{
  const plan = planWakeAlarm({
    ...base,
    intervalMinutes: 240,
    lastFeeding: fed('2026-10-05T00:30:00+09:00'),
    now: jst('00:40'),
  });
  assert.ok(plan);
  assert.equal(plan.triggerAt, jst('04:15'));
}

console.log('wakeAlarmPlan: ok');
