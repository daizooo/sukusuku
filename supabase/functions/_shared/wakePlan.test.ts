// 実行: npm run test:wake-plan
import assert from 'node:assert/strict';

import { decideWakeSync, planWake, WAKE_LEAD_MINUTES } from './wakePlan.ts';

const jst = (hhmm: string, day = '2026-10-05') => new Date(`${day}T${hhmm}:00+09:00`).getTime();
const NIGHT = { quietStart: 22 * 60, quietEnd: 6 * 60 };
const base = { enabled: true, nursing: false, ...NIGHT };

// 目安 3:30（おやすみ中）→ 3:15 に鳴らす
{
  const plan = planWake({ ...base, dueAt: jst('03:30'), now: jst('00:40') });
  assert.deepEqual(plan, { triggerAt: jst('03:15'), dueAt: jst('03:30') });
  assert.equal(plan.dueAt - plan.triggerAt, WAKE_LEAD_MINUTES * 60_000);
}

// 目安が昼（おやすみの外）→ なし
assert.equal(planWake({ ...base, dueAt: jst('13:00'), now: jst('10:10') }), null);
// 目安 6:00 ちょうどは外、5:59 は中（鳴らす時刻 5:44 は中でも外でもよい）
assert.equal(planWake({ ...base, dueAt: jst('06:00'), now: jst('03:10') }), null);
assert.deepEqual(planWake({ ...base, dueAt: jst('05:59'), now: jst('03:10') })?.triggerAt, jst('05:44'));
// 目安 22:10（中）で、鳴らす時刻 21:55 は外にはみ出ても鳴らす
assert.equal(planWake({ ...base, dueAt: jst('22:10'), now: jst('19:20') })?.triggerAt, jst('21:55'));
// 鳴らす時刻を過ぎている／ちょうど → いきなり鳴らさない
assert.equal(planWake({ ...base, dueAt: jst('03:30'), now: jst('03:20') }), null);
assert.equal(planWake({ ...base, dueAt: jst('03:30'), now: jst('03:15') }), null);
// オフ・授乳中・記録なし → なし
assert.equal(planWake({ ...base, enabled: false, dueAt: jst('03:30'), now: jst('00:40') }), null);
assert.equal(planWake({ ...base, nursing: true, dueAt: jst('03:30'), now: jst('00:40') }), null);
assert.equal(planWake({ ...base, dueAt: null, now: jst('00:40') }), null);
// おやすみ時間が未設定（null）なら、目安がどこでも鳴らさない
assert.equal(
  planWake({ ...base, quietStart: null, quietEnd: null, dueAt: jst('03:30'), now: jst('00:40') }),
  null,
);

// --- decideWakeSync ---
const now = jst('00:40');
const plan = { triggerAt: jst('03:15'), dueAt: jst('03:30') };
assert.equal(decideWakeSync(plan, null, now), 'schedule', 'まだ伝えていない');
assert.equal(decideWakeSync(plan, plan.triggerAt, now), 'none', '伝えた内容と同じ');
assert.equal(decideWakeSync(plan, jst('01:00'), now), 'schedule', '記録が変わり、時刻が違う');
assert.equal(decideWakeSync(null, null, now), 'none', '予約なしのまま');
assert.equal(decideWakeSync(null, jst('03:15'), now), 'cancel', '先にある予約が要らなくなった');
// 鳴らす時刻を過ぎたあとは、端末へ送らず控えだけ消す（5分後の再鳴動を取り消さない）
assert.equal(decideWakeSync(null, jst('03:15'), jst('03:16')), 'clear');
assert.equal(decideWakeSync(null, jst('03:15'), jst('03:15')), 'clear', 'ちょうどの時刻も過去扱い');

console.log('wakePlan: ok');
