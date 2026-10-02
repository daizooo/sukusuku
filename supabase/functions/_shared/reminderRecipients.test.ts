// reminderRecipients.ts（通知の宛先の絞り込み）の検証。
//
//   npm run test:reminder-recipients
//
// 「自分だけ」の予定のタイトル・場所が、ほかの家族の端末へ通知されないことを確かめる。
import assert from 'node:assert/strict';
import { recipientsFor } from './reminderRecipients.ts';

const papa = { id: 's1', user_id: 'u-papa' };
const mama = { id: 's2', user_id: 'u-mama' };
const papaTablet = { id: 's3', user_id: 'u-papa' };
const all = [papa, mama, papaTablet];

// 共有の予定は全端末。
assert.deepEqual(recipientsFor({ is_private: false, created_by: 'u-papa' }, all), all);
// 列が無い（ビューの更新前）ときは共有として扱う（適用の順序は 0051 の冒頭）。
assert.deepEqual(recipientsFor({}, all), all);
assert.deepEqual(recipientsFor({ is_private: null }, all), all);

// 「自分だけ」は作成者の端末だけ（端末が複数あれば全部）。
assert.deepEqual(recipientsFor({ is_private: true, created_by: 'u-papa' }, all), [papa, papaTablet]);
assert.deepEqual(recipientsFor({ is_private: true, created_by: 'u-mama' }, all), [mama]);
// 作成者の端末が登録されていなければ、誰にも送らない（家族の他の端末へは送らない）。
assert.deepEqual(recipientsFor({ is_private: true, created_by: 'u-other' }, all), []);
// 作成者が分からない（ユーザー削除で null）ときも誰にも送らない。
assert.deepEqual(recipientsFor({ is_private: true, created_by: null }, all), []);
assert.deepEqual(recipientsFor({ is_private: true }, all), []);

// 渡した配列を書き換えない。
const before = [...all];
recipientsFor({ is_private: true, created_by: 'u-mama' }, all);
assert.deepEqual(all, before);

console.log('reminderRecipients: OK');
