// notificationCleanup.ts の検証。
//
//   npm run test:notification
//
// 「妻が記録したのに自分の端末には通知が残る」「アプリを開いても消えない」ため、
// 用が済んだ通知をこちらから閉じるようにした。その「済んだか」の判断を確かめる。
import assert from 'node:assert';
import { isSettledNotification, NOTIFICATION_TAG } from './notificationCleanup.ts';

const at = (iso: string) => new Date(iso);

const base = {
  isFeedingDue: true,
  hasNursingSession: false,
  lastTemperatureAt: null as Date | null,
  temperatureTimes: { morningTime: '06:00', eveningTime: '18:00' },
  doneTaskIds: [] as string[],
  now: at('2026-09-09T13:00:00').getTime(),
};

// ---- 次の授乳の目安 ----
// パートナーが授乳を記録していれば、次の目安は先へ動くので通知は用済み。
assert.strictEqual(
  isSettledNotification(NOTIFICATION_TAG.feeding, { ...base, isFeedingDue: false }),
  true,
  '記録済み(目安がまだ先)なら消す',
);
// まだ誰も記録していなければ、目安を過ぎたままなので残す。
assert.strictEqual(
  isSettledNotification(NOTIFICATION_TAG.feeding, base),
  false,
  '目安を過ぎたままなら残す',
);

// ---- 授乳の経過時間 ----
assert.strictEqual(isSettledNotification(NOTIFICATION_TAG.nursing, base), true, '計測が残っていなければ消す');
assert.strictEqual(
  isSettledNotification(NOTIFICATION_TAG.nursing, { ...base, hasNursingSession: true }),
  false,
  '計測中・記録前なら残す',
);

// ---- 検温 ----
// 直近の検温(朝6:00)より後に測っていれば済んでいる。
assert.strictEqual(
  isSettledNotification(NOTIFICATION_TAG.temperature, {
    ...base,
    lastTemperatureAt: at('2026-09-09T06:10:00'),
  }),
  true,
  'その回の検温を記録済みなら消す',
);
// 前の日の分しか無ければ、今朝のお知らせはまだ用が済んでいない。
assert.strictEqual(
  isSettledNotification(NOTIFICATION_TAG.temperature, {
    ...base,
    lastTemperatureAt: at('2026-09-08T18:10:00'),
  }),
  false,
  '前の回の記録では消さない',
);
// 今日の朝の時刻より前（＝直近は前の日の夕方）の場合。
assert.strictEqual(
  isSettledNotification(NOTIFICATION_TAG.temperature, {
    ...base,
    now: at('2026-09-09T05:00:00').getTime(),
    lastTemperatureAt: at('2026-09-08T18:10:00'),
  }),
  true,
  '日付をまたいでも直近の回で判断する',
);

// ---- 予定のリマインダー ----
assert.strictEqual(
  isSettledNotification('task-abc', { ...base, doneTaskIds: ['abc'] }),
  true,
  '済ませた予定の通知は消す',
);
assert.strictEqual(isSettledNotification('task-abc', base), false, 'まだの予定は残す');

// ---- 知らないタグ ----
assert.strictEqual(isSettledNotification('sukusuku', base), false, '判断できないものは触らない');

console.log('notificationCleanup: OK');
