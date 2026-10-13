import assert from 'node:assert/strict';
import {
  addMonths,
  advanceRenewal,
  annualAmount,
  annualTotal,
  daysBetween,
  draftError,
  defaultVisibleMemberIds,
  emptyContractDraft,
  nearestRenewal,
  parseCount,
  renewalBadge,
  sortContracts,
  visibilityLabel,
} from './contractUtils.ts';

// 契約の計算（docs/contracts.md）。実行: npm run test:contracts

// 日数
assert.equal(daysBetween('2026-10-13', '2026-11-20'), 38);
assert.equal(daysBetween('2026-10-13', '2026-10-13'), 0);
assert.equal(daysBetween('2026-10-13', '2026-10-11'), -2);
assert.equal(daysBetween('2027-02-28', '2028-02-29'), 366); // うるう年をまたぐ

// バッジ: 30日以内=橙、7日以内=赤、過ぎている=赤、遠い=灰、更新日なし=出さない
assert.equal(renewalBadge(null, '2026-10-13'), null);
assert.deepEqual(renewalBadge('2026-11-20', '2026-10-13'), { text: '更新まで 38日（11/20）', tone: 'plain', overdue: false });
assert.equal(renewalBadge('2026-11-12', '2026-10-13')?.tone, 'warn'); // 30日
assert.equal(renewalBadge('2026-11-13', '2026-10-13')?.tone, 'plain'); // 31日
assert.equal(renewalBadge('2026-10-20', '2026-10-13')?.tone, 'alert'); // 7日
assert.equal(renewalBadge('2026-10-21', '2026-10-13')?.tone, 'warn'); // 8日
assert.deepEqual(renewalBadge('2026-10-11', '2026-10-13'), { text: '更新日を2日過ぎています', tone: 'alert', overdue: true });
assert.equal(renewalBadge('2026-10-13', '2026-10-13')?.text, '今日が更新日です');

// 月の足し算: 月末は丸める。年またぎ。
assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
assert.equal(addMonths('2026-11-20', 24), '2028-11-20');
assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
assert.equal(addMonths('2026-03-31', -1), '2026-02-28');

// 更新した: 期間ぶん進める。放置していたら、今日より先になるまで進める。
assert.equal(advanceRenewal('2026-11-20', 24, '2026-10-13'), '2028-11-20');
assert.equal(advanceRenewal('2026-06-10', 1, '2026-10-13'), '2026-11-10'); // 4か月放置
assert.equal(advanceRenewal('2026-10-13', 12, '2026-10-13'), '2027-10-13');

// 年間の金額: 月×12、年はそのまま、1回と金額なしは0
assert.equal(annualAmount({ amount: 98000, amountCycle: 'monthly' }), 1_176_000);
assert.equal(annualAmount({ amount: 62000, amountCycle: 'yearly' }), 62000);
assert.equal(annualAmount({ amount: 50000, amountCycle: 'once' }), 0);
assert.equal(annualAmount({ amount: null, amountCycle: null }), 0);
assert.equal(
  annualTotal([
    { amount: 990, amountCycle: 'monthly' },
    { amount: 62000, amountCycle: 'yearly' },
    { amount: null, amountCycle: null },
  ]),
  990 * 12 + 62000,
);
assert.equal(annualTotal([]), 0);

// 並び: 更新日の近い順、更新日なしは末尾、同じ日は名称順
const titles = sortContracts([
  { title: 'D', renewsOn: null },
  { title: 'B', renewsOn: '2026-12-01' },
  { title: 'A', renewsOn: '2026-10-11' },
  { title: 'C', renewsOn: '2026-12-01' },
]).map((c) => c.title);
assert.deepEqual(titles, ['A', 'B', 'C', 'D']);

// 入力: 名称・見せる相手・金額と周期のセット・契約期間
const draft = emptyContractDraft('member-1', ['member-1', 'member-2']);
assert.deepEqual(draft.visibleMemberIds, ['member-1', 'member-2'], '見せる相手の初期値');
assert.equal(draft.contractorId, 'member-1', '契約者の初期値は作った本人');
// 県民共済のように更新日も契約期間も無い契約でも保存できる。お知らせは既定が 30・7・1 日前
assert.equal(draft.renewsOn, null);
assert.equal(draft.termMonths, null);
assert.deepEqual(draft.notifyDays, [30, 7, 1]);
assert.equal(draftError(draft), '名称を入力してください');
assert.equal(draftError({ ...draft, title: '賃貸' }), null);
assert.equal(draftError({ ...draft, title: '県民共済', kind: 'insurance' }), null, '更新日・期間なし');
assert.equal(draftError({ ...draft, title: '賃貸', visibleMemberIds: [] }), '見せる相手を1人以上選んでください');
assert.equal(draftError({ ...draft, title: '賃貸', amount: 100 }), '金額と周期はセットで入力してください');
assert.equal(draftError({ ...draft, title: '賃貸', termMonths: 0 }), '契約期間は1か月以上にしてください');
assert.equal(parseCount('98,000'), 98000);
assert.equal(parseCount(''), null);
assert.equal(parseCount('abc'), null);

// 見せる相手の添え書き: 全員=出さない、自分だけ、限られた人は名前
const people = [
  { id: 'h', displayName: '夫', relation: 'husband' as const },
  { id: 'w', displayName: '妻', relation: 'wife' as const },
  { id: 'c', displayName: '子', relation: 'child' as const },
];
assert.equal(visibilityLabel(['h', 'w', 'c'], people, 'h'), null);
assert.equal(visibilityLabel(['h', 'w'], people, 'h'), null, '夫婦に見せていれば印は出さない');

// 見せる相手の初期値: 夫婦と、作った本人（子のアカウントで作ったときは子も入る）
assert.deepEqual(defaultVisibleMemberIds(people, 'h'), ['h', 'w']);
assert.deepEqual(defaultVisibleMemberIds(people, 'c'), ['h', 'w', 'c']);
assert.deepEqual(defaultVisibleMemberIds([], null), []);
assert.equal(visibilityLabel(['h'], people, 'h'), '自分だけ');
assert.equal(visibilityLabel(['w'], people, 'h'), '妻');
assert.equal(visibilityLabel(['h', 'c'], people, 'h'), '夫・子');
assert.equal(visibilityLabel(['h'], [], 'h'), '自分だけ');

// その他タブの行に添える更新日: 過ぎた契約が先、90日より先は出さない、更新日なしは数えない
assert.equal(nearestRenewal([], '2026-10-13'), null);
assert.equal(nearestRenewal([{ title: 'a', renewsOn: null }], '2026-10-13'), null);
assert.equal(nearestRenewal([{ title: 'a', renewsOn: '2027-03-01' }], '2026-10-13'), null);
assert.deepEqual(
  nearestRenewal(
    [
      { title: '賃貸', renewsOn: '2026-11-20' },
      { title: '保険', renewsOn: '2026-12-31' },
    ],
    '2026-10-13',
  ),
  { text: '更新まで 38日（賃貸）', tone: 'plain' },
);
assert.deepEqual(
  nearestRenewal(
    [
      { title: '賃貸', renewsOn: '2026-11-20' },
      { title: '動画', renewsOn: '2026-10-11' },
    ],
    '2026-10-13',
  ),
  { text: '更新日を過ぎた契約があります', tone: 'alert' },
);

console.log('contractUtils: ok');
