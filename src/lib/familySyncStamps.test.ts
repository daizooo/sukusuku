// 変更台帳の時刻の比べ方のテスト。
// 実行: npm run test:family-sync
import assert from 'node:assert/strict';

import { hasChanged, pickStamps, toStamps } from './familySyncStamps.ts';

// --- toStamps: 台帳の changed を安全に読む ---
assert.deepEqual(toStamps({ care_logs: '2026-10-09T10:00:00.000001Z' }), {
  care_logs: '2026-10-09T10:00:00.000001Z',
});
assert.deepEqual(toStamps(null), {});
assert.deepEqual(toStamps(undefined), {});
assert.deepEqual(toStamps('x'), {});
assert.deepEqual(toStamps(['a']), {});
// 時刻でないものは落とす（壊れた値で画面が止まらないように）。
assert.deepEqual(toStamps({ care_logs: 1, tasks: '2026-10-09T10:00:00Z' }), {
  tasks: '2026-10-09T10:00:00Z',
});

// --- pickStamps: 自分の表だけ ---
const all = { care_logs: 'a', tasks: 'b', money_records: 'c' };
assert.deepEqual(pickStamps(['care_logs', 'tasks'], all), { care_logs: 'a', tasks: 'b' });
assert.deepEqual(pickStamps(['lists'], all), {});

// --- hasChanged: 自分の表の時刻が変わったときだけ true ---
// 他の表が変わっても、自分の表が変わっていなければ読み直さない（家計は家計の表が変わったときだけ）。
assert.equal(hasChanged(['money_records'], all, { ...all, care_logs: 'a2' }), false);
assert.equal(hasChanged(['money_records'], all, { ...all, money_records: 'c2' }), true);
// 複数の表のどれか1つでよい。
assert.equal(hasChanged(['care_logs', 'tasks'], all, { ...all, tasks: 'b2' }), true);
// 一度も変わっていない表（時刻なし）どうしは同じ。初めて変わったときは違う。
assert.equal(hasChanged(['lists'], {}, {}), false);
assert.equal(hasChanged(['lists'], {}, { lists: 'x' }), true);
// 同じ時刻が再び届いても変化ではない（再接続での取り直しで読み直さない）。
assert.equal(hasChanged(['care_logs'], all, { ...all }), false);

console.log('familySyncStamps: ok');
