// growthRecordInput.ts の検証。
//
//   npm run test:growth
//
// 成長記録が「追加に失敗しました」としか出ずに保存できなかった原因は、
// 体重をg（例: 3200）で入力するとDBの numeric(5,2) を超えてしまうことだった。
// 単位換算と範囲チェックがここで効いているかを確かめる。
import assert from 'node:assert';
import { MAX_MONTH_AGE, round2, toWeightKg, validateGrowthRecordForm } from './growthRecordInput.ts';
import { monthsSinceBirth } from './dateUtils.ts';

const base = { recordedDate: '2026-08-26', monthAge: '', height: '', weight: '', weightUnit: 'kg' as const };

// ---- 体重の単位換算 ----
assert.strictEqual(toWeightKg('3200', 'g'), 3.2);
assert.strictEqual(toWeightKg('3.2', 'kg'), 3.2);
assert.strictEqual(toWeightKg('2755', 'g'), 2.76, '小数第2位まで丸める');
assert.strictEqual(toWeightKg('', 'kg'), null);
assert.strictEqual(toWeightKg('abc', 'kg'), null);

// ---- 不具合の再現ケース: gの値をkgのまま入れる ----
const grams = validateGrowthRecordForm({ ...base, weight: '3200' });
assert.strictEqual(grams.ok, false);
assert.match(grams.message, /単位を「g」に切り替え/, 'gで入れていることを案内する');

// ---- 単位をgにすれば通り、kgへ換算される ----
const fixed = validateGrowthRecordForm({ ...base, weight: '3200', weightUnit: 'g', height: '50.2' });
assert.strictEqual(fixed.ok, true);
assert.deepStrictEqual(fixed.draft, { recordedDate: '2026-08-26', monthAge: null, height: 50.2, weight: 3.2 });

// ---- kgでそのまま入れても通る ----
const kg = validateGrowthRecordForm({ ...base, weight: '3.2', monthAge: '0' });
assert.strictEqual(kg.ok, true);
assert.deepStrictEqual(kg.draft, { recordedDate: '2026-08-26', monthAge: 0, height: null, weight: 3.2 });

// ---- 身長の範囲 ----
assert.strictEqual(validateGrowthRecordForm({ ...base, height: '502' }).ok, false, '桁の取り違えを止める');
assert.strictEqual(validateGrowthRecordForm({ ...base, height: '0' }).ok, false);
assert.strictEqual(validateGrowthRecordForm({ ...base, height: '-1' }).ok, false);
assert.strictEqual(validateGrowthRecordForm({ ...base, height: '50.25' }).ok, true);

// ---- 生後ヶ月 ----
assert.strictEqual(validateGrowthRecordForm({ ...base, height: '50', monthAge: '1.5' }).ok, false);
assert.strictEqual(
  validateGrowthRecordForm({ ...base, height: '50', monthAge: String(MAX_MONTH_AGE + 1) }).ok,
  false,
);

// ---- 必須項目 ----
assert.strictEqual(validateGrowthRecordForm({ ...base, recordedDate: '' }).ok, false, '記録日は必須');
const empty = validateGrowthRecordForm(base);
assert.strictEqual(empty.ok, false);
assert.match(empty.message, /身長か体重/, '身長・体重が両方空なら保存しない');

// ---- 生後ヶ月の自動計算（誕生日 + 記録日）----
assert.strictEqual(monthsSinceBirth('2026-04-10', '2026-05-09'), 0, '応当日前は0ヶ月');
assert.strictEqual(monthsSinceBirth('2026-04-10', '2026-05-10'), 1);
assert.strictEqual(monthsSinceBirth('2026-04-10', '2027-04-10'), 12);
assert.strictEqual(monthsSinceBirth('2026-04-10', '2026-04-09'), null, '誕生日より前は計算しない');
assert.strictEqual(monthsSinceBirth('', '2026-05-10'), null, '誕生日が未設定なら自動計算しない');


// ---- 単位の切り替えで数値が換算されること（モーダルのchangeWeightUnitと同じ計算）----
assert.strictEqual(round2(3.2 * 1000), 3200, 'kg→g');
assert.strictEqual(round2(3200 / 1000), 3.2, 'g→kg');
// 換算せずに単位だけ変えると 3.2g（=0.0032kg）として通ってしまう
assert.strictEqual(validateGrowthRecordForm({ ...base, weight: '3.2', weightUnit: 'g' }).ok, true);
assert.strictEqual(toWeightKg('3.2', 'g'), 0, '換算漏れは事実上0kgになる');

console.log('growthRecordInput: すべてのテストに合格しました');
