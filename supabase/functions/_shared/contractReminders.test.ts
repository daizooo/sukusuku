// 実行: npm run test:contract-reminders
import assert from 'node:assert/strict';

import {
  addDays,
  buildMessage,
  canSee,
  collectNotices,
  daysBetween,
  type ContractRow,
  type Viewer,
} from './contractReminders.ts';

const FAMILY = 'fam1';
const me: Viewer = { userId: 'u-me', familyId: FAMILY, memberId: 'm-me' };

const contract = (title: string, renews_on: string | null, extra: Partial<ContractRow> = {}): ContractRow => ({
  id: title,
  family_id: FAMILY,
  created_by: 'u-me',
  kind: 'rent',
  title,
  renews_on,
  notify_days: [60, 30, 7],
  notify_after: null,
  visible_member_ids: ['m-me'],
  ...extra,
});

const names = (notices: ReturnType<typeof collectNotices>) => notices.map((n) => n.contract.title);

// ---- 日付 ----
assert.equal(daysBetween('2026-10-13', '2026-11-12'), 30);
assert.equal(daysBetween('2026-12-25', '2027-01-05'), 11, '年またぎ');
assert.equal(daysBetween('2028-02-27', '2028-03-01'), 3, 'うるう年');
assert.equal(daysBetween('2026-10-13', '2026-10-13'), 0);
assert.equal(addDays('2026-11-12', -30), '2026-10-13');

// ---- 見える人 ----
{
  const c = contract('a', '2026-11-12', { created_by: 'u-other', visible_member_ids: ['m-me', 'm-wife'] });
  assert.equal(canSee(c, me), true, '見せる相手に入っている');
  assert.equal(canSee(c, { ...me, memberId: 'm-child' }), false, '入っていない人には見えない');
  assert.equal(canSee(c, { ...me, memberId: null }), false, 'メンバーでない人には見えない');
  assert.equal(
    canSee(contract('b', '2026-11-12', { visible_member_ids: ['m-wife'] }), me),
    true,
    '作った本人は選ばなくても見える',
  );
  assert.equal(
    canSee(contract('c', '2026-11-12', { created_by: null, visible_member_ids: ['m-wife'] }), me),
    false,
    '作った人が消えていて、見せる相手にも入っていない',
  );
  assert.equal(canSee(contract('d', '2026-11-12', { family_id: 'fam2' }), me), false, '別の家族の契約');
}

// ---- 節目の日に当たったものだけが入る ----
// 今日 2026-10-13、前回は昨日まで知らせ済み
const today = '2026-10-13';
const since = '2026-10-12';
{
  const n = collectNotices(
    [
      contract('30日前', '2026-11-12'), // 30日前 = 今日
      contract('60日前', '2026-12-12'), // 60日前 = 今日
      contract('7日前', '2026-10-20'), // 7日前 = 今日
      contract('まだ先', '2026-11-13'), // 30日前 = 明日
      contract('もう知らせた', '2026-11-11'), // 30日前 = 昨日（前回の窓）
      contract('更新日なし', null),
      contract('過ぎた', '2026-10-12'),
      contract('お知らせなし', '2026-11-12', { notify_days: [] }),
    ],
    me,
    since,
    today,
  );
  assert.deepEqual(names(n), ['7日前', '30日前', '60日前'], '更新日が近い順');
  assert.deepEqual(n.map((x) => x.daysLeft), [7, 30, 60]);
}

// 更新日が今日でも、今日が節目なら拾う（N=0）。過ぎてはいない
assert.deepEqual(
  names(collectNotices([contract('今日', today, { notify_days: [0] })], me, since, today)),
  ['今日'],
);

// 見えない契約は拾わない（別のメンバーにだけ見える）
assert.deepEqual(
  names(
    collectNotices(
      [contract('妻だけ', '2026-11-12', { created_by: 'u-wife', visible_member_ids: ['m-wife'] })],
      me,
      since,
      today,
    ),
  ),
  [],
);

// 窓の境界: since は含まず today は含む
assert.equal(collectNotices([contract('a', '2026-11-12')], me, '2026-10-13', today).length, 0, 'since当日は済み');
assert.equal(collectNotices([contract('a', '2026-11-12')], me, '2026-10-12', today).length, 1);

// 前回の実行が飛んだ日があっても、次の実行で拾える
assert.equal(
  collectNotices([contract('飛んだ日', '2026-11-10')], me, '2026-10-08', today).length, // 30日前 = 10/11
  1,
);

// 節目が複数同じ窓に入っても、1契約につき1件
{
  const n = collectNotices([contract('長く飛んだ', '2026-11-12')], me, '2026-08-01', today);
  assert.equal(n.length, 1);
}

// 月またぎ・年またぎ・うるう年
assert.equal(collectNotices([contract('年またぎ', '2027-01-12')], me, '2026-12-12', '2026-12-13').length, 1, '30日前 = 12/13');
assert.equal(collectNotices([contract('うるう', '2028-03-01')], me, '2028-01-30', '2028-01-31').length, 1, '30日前 = 1/31');
assert.equal(collectNotices([contract('うるう2', '2028-03-01')], me, '2028-02-22', '2028-02-23').length, 1, '7日前 = 2/23（うるう年は2/29がある）');
assert.equal(collectNotices([contract('平年', '2027-03-01')], me, '2027-02-21', '2027-02-22').length, 1, '7日前 = 2/22（平年は2/28まで）');

// 契約を直しても、翌日以降に同じ節目で再び知らせない
assert.equal(collectNotices([contract('済み', '2026-11-12')], me, today, '2026-10-14').length, 0);

// 不正なお知らせ日数（負・小数）は無視する
assert.equal(
  collectNotices([contract('不正', '2026-11-12', { notify_days: [-30, 30.5] })], me, since, today).length,
  0,
);

// 更新した（更新日を足した・直した）日以前の節目は知らせない
{
  // 1か月進めたサブスク: 更新日 11/12、今日 10/13 に更新。30日前 = 今日 は更新と同じ日なので出さない。7日前 = 11/5 は出す
  const renewed = contract('更新直後', '2026-11-12', { notify_after: today });
  assert.equal(collectNotices([renewed], me, since, today).length, 0, '更新した日の節目は出さない');
  assert.equal(collectNotices([renewed], me, today, '2026-11-05').length, 1, '更新した日より後の節目は出す');
  // 窓が更新日より前に及んでも（実行が飛んだ後でも）、更新前の節目は拾わない
  assert.equal(collectNotices([renewed], me, '2026-10-01', today).length, 0);
  // 更新したのが昨日なら、今日の節目は出す
  assert.equal(collectNotices([contract('昨日更新', '2026-11-12', { notify_after: since })], me, since, today).length, 1);
}

// 既定の {30,7,1}: 前日にも知らせる
assert.equal(
  collectNotices([contract('前日', '2026-10-14', { notify_days: [30, 7, 1] })], me, since, today).length,
  1,
  '更新日の前日',
);

// ---- 文面 ----
{
  const one = buildMessage(collectNotices([contract('◯◯マンション', '2026-11-12')], me, since, today));
  assert.equal(one.title, '◯◯マンションの更新まで30日');
  assert.equal(one.body, '賃貸 ◯◯マンション（11/12・あと30日）');
}
{
  const many = buildMessage(
    collectNotices(
      [
        contract('◯◯マンション', '2026-11-12'),
        contract('自動車保険', '2026-10-20', { kind: 'insurance' }),
        contract('動画配信', '2026-12-12', { kind: 'subscription' }),
        contract('ジム', '2026-10-13', { kind: 'other', notify_days: [0] }),
        contract('クラウド', '2026-10-20', { kind: 'subscription', notify_days: [7] }),
      ],
      me,
      since,
      today,
    ),
  );
  assert.equal(many.title, 'ジムの更新日は今日です ほか4件', 'いちばん急ぐものが見出し');
  assert.equal(
    many.body,
    ['その他 ジム（10/13・今日が更新日）', 'サブスク クラウド（10/20・あと7日）', '保険 自動車保険（10/20・あと7日）', 'ほか2件'].join('\n'),
    '本文は3件まで',
  );
}

console.log('contractReminders: all passed');
