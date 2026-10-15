// 実行: npm run test:money-feed
import assert from 'node:assert/strict';

import type { MoneyFeedItem, MoneyRecord } from '../types/app.ts';
import { feedDuplicates, feedLinkCandidates, sortFeedInbox, storeCategoryGuess } from './moneyFeedUtils.ts';

const record = (id: string, patch: Partial<MoneyRecord>, amount: number): MoneyRecord =>
  ({
    id,
    kind: 'expense',
    occurredOn: '2026-10-12',
    walletId: 'higo',
    toWalletId: null,
    store: '',
    createdBy: null,
    isEstimate: false,
    recurringId: null,
    month: null,
    items: [{ id: `${id}-i`, amount, categoryId: null }],
    ...patch,
  }) as unknown as MoneyRecord;

const records = [
  record('feed-transfer', { kind: 'transfer', walletId: 'raku', toWalletId: 'higo' }, 20000),
  record('feed-expense', { occurredOn: '2026-10-08' }, 3000),
  record('manual', {}, 20000),
];
const linked = new Set(['feed-transfer', 'feed-expense']);
const draft = (patch: object) => ({
  id: null,
  occurredOn: '2026-10-13',
  walletId: 'higo',
  toWalletId: null,
  items: [{ amount: 20000 }],
  ...patch,
}) as Parameters<typeof feedDuplicates>[0];

// 明細から来た振替と、同じ口座（入金先）・同じ額・3日以内 → 重複
assert.deepEqual(feedDuplicates(draft({}), records, linked, 3).map((r) => r.id), ['feed-transfer']);
// 振替で入れても、どちらかの口座が同じなら重複
assert.deepEqual(
  feedDuplicates(draft({ walletId: 'raku', toWalletId: 'higo' }), records, linked, 3).map((r) => r.id),
  ['feed-transfer'],
);
// 額が違う・日が離れている・口座が違う・直すとき（id あり）は重複にしない
assert.deepEqual(feedDuplicates(draft({ items: [{ amount: 19999 }] }), records, linked, 3), []);
assert.deepEqual(feedDuplicates(draft({ occurredOn: '2026-10-20' }), records, linked, 3), []);
assert.deepEqual(feedDuplicates(draft({ walletId: 'cash' }), records, linked, 3), []);
assert.deepEqual(feedDuplicates(draft({ id: 'x' }), records, linked, 3), []);
// 4日離れていても、幅を広げれば重複
assert.deepEqual(feedDuplicates(draft({ occurredOn: '2026-10-12', items: [{ amount: 3000 }] }), records, linked, 3), []);
assert.deepEqual(
  feedDuplicates(draft({ occurredOn: '2026-10-12', items: [{ amount: 3000 }] }), records, linked, 4).map((r) => r.id),
  ['feed-expense'],
);

const item = (patch: Partial<MoneyFeedItem>): MoneyFeedItem => ({
  id: 'f',
  receivedAt: '2026-10-12T00:00:00Z',
  toEmail: null,
  subject: '',
  direction: 'out',
  occurredOn: '2026-10-12',
  amount: 20000,
  accountName: '肥後銀行',
  description: '',
  walletId: 'higo',
  status: 'pending',
  pairId: null,
  recordId: null,
  candidateRecordIds: [],
  source: 'zaim_mail',
  storeHint: null,
  ...patch,
});

// 結ぶ候補は同じ口座・前後7日で、額の近い順。結んだ記録は除く
assert.deepEqual(feedLinkCandidates(item({}), records, linked).map((r) => r.id), ['manual']);
assert.deepEqual(feedLinkCandidates(item({ walletId: null }), records, linked), []);

// 一覧の並び: 確認 → 口座なし → 未確認 → 読めない
assert.deepEqual(
  sortFeedInbox([
    item({ id: 'u', status: 'unreadable', direction: null }),
    item({ id: 'p' }),
    item({ id: 'w', walletId: null }),
    item({ id: 'c', status: 'confirm' }),
  ]).map((entry) => entry.id),
  ['c', 'w', 'p', 'u'],
);

// お店でいちばん多く使った種類（カードの利用通知を記録にするときの初めの種類。§9.6）
{
  const at = (id: string, occurredOn: string, store: string, categoryIds: (string | null)[], kind: MoneyRecord['kind'] = 'expense') =>
    ({ ...record(id, { occurredOn, store, kind }, 0), items: categoryIds.map((categoryId, index) => ({ id: `${id}-${index}`, amount: 100, categoryId })) }) as unknown as MoneyRecord;
  const rs = [
    at('s1', '2026-09-01', 'よかもんね', ['food']),
    at('s2', '2026-09-10', 'よかもんね', ['food', 'daily']),
    at('s3', '2026-10-01', 'よかもんね ', ['daily']),
    at('s4', '2026-10-02', 'しまむら', ['clothes']),
    at('s5', '2026-10-03', 'よかもんね', ['refund'], 'income'),
    at('s6', '2026-10-04', 'よかもんね', [null]),
  ];
  assert.equal(storeCategoryGuess(rs, 'よかもんね', 'expense'), 'daily', '同じ数（2回ずつ）なら新しい記録の種類');
  assert.equal(storeCategoryGuess([...rs, at('s7', '2026-08-01', 'よかもんね', ['food'])], 'よかもんね', 'expense'), 'food', 'いちばん多い種類');
  assert.equal(storeCategoryGuess(rs, 'よかもんね', 'income'), 'refund', '収入は収入の記録から');
  assert.equal(storeCategoryGuess(rs, 'ゆめタウン', 'expense'), null, '記録の無いお店');
  assert.equal(storeCategoryGuess(rs, '', 'expense'), null);
}

console.log('moneyFeedUtils: ok');
