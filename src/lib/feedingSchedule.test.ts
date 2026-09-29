// 「授乳したのにホームの目安が変わらない」の再発を防ぐためのテスト。
//
// 母乳はストップウォッチを止めたあと入力画面で保存して初めて記録になる。
// その隙間（計測中・記録待ち）を前回の授乳として数えているかを確かめる。
// 実行: npm run test:feeding
import assert from 'node:assert/strict';

import {
  activePendingNursing,
  nextFeedingSchedule,
  resolveLastFeeding,
  type PendingNursing,
} from './feedingSchedule.ts';

const at = (iso: string) => new Date(iso);
const now = at('2026-09-21T12:22:00+09:00').getTime();

// --- activePendingNursing: どの印を数えるか ---

const nursing: PendingNursing = { startedAt: at('2026-09-21T12:10:00+09:00'), stoppedAt: null };
const pending: PendingNursing = {
  startedAt: at('2026-09-21T11:36:00+09:00'),
  stoppedAt: at('2026-09-21T11:41:00+09:00'),
};

assert.equal(activePendingNursing([], now), null);
assert.equal(activePendingNursing([pending], now), pending);

// 計測中が1つでもあれば、そちらが「いまの授乳」。並び順に左右されない。
assert.equal(activePendingNursing([pending, nursing], now), nursing);
assert.equal(activePendingNursing([nursing, pending], now), nursing);

// 同じ種類なら新しいほう。
const olderPending: PendingNursing = {
  startedAt: at('2026-09-21T10:00:00+09:00'),
  stoppedAt: at('2026-09-21T10:05:00+09:00'),
};
assert.equal(activePendingNursing([pending, olderPending], now), pending);

// 置き去りの印は数えない。記録待ちは60分、計測中は90分まで（サーバー側の片付けと同じ）。
const stalePending: PendingNursing = {
  startedAt: at('2026-09-21T11:00:00+09:00'),
  stoppedAt: at('2026-09-21T11:21:00+09:00'), // 61分前
};
assert.equal(activePendingNursing([stalePending], now), null);
const staleNursing: PendingNursing = {
  startedAt: at('2026-09-21T10:51:00+09:00'), // 91分前
  stoppedAt: null,
};
assert.equal(activePendingNursing([staleNursing], now), null);
// 上限ちょうどは残す。
assert.equal(
  activePendingNursing([{ startedAt: at('2026-09-21T10:52:00+09:00'), stoppedAt: null }], now) !==
    null,
  true,
);

// --- resolveLastFeeding: 前回の授乳をどう決めるか ---

const lastLogged = at('2026-09-21T08:55:00+09:00');

// 印が無ければ今までどおり記録だけを見る。
assert.deepEqual(resolveLastFeeding(lastLogged, null), {
  lastFedAt: lastLogged,
  isNursing: false,
  isPendingRecord: false,
});

// 飲ませている最中は、終わる時刻が分からないので起点にしない。
assert.deepEqual(resolveLastFeeding(lastLogged, nursing), {
  lastFedAt: null,
  isNursing: true,
  isPendingRecord: false,
});

// 記録待ちは、止めた時刻を前回の授乳として扱う（今回の不具合そのもの）。
assert.deepEqual(resolveLastFeeding(lastLogged, pending), {
  lastFedAt: pending.stoppedAt,
  isNursing: false,
  isPendingRecord: true,
});

// 保存が済んだあと、印の消え方が遅れても二重に数えない
// （その授乳が始まったあとに記録が入っていれば、それが保存されたぶん）。
const savedAfterNursing = at('2026-09-21T11:42:00+09:00');
assert.deepEqual(resolveLastFeeding(savedAfterNursing, pending), {
  lastFedAt: savedAfterNursing,
  isNursing: false,
  isPendingRecord: false,
});

// まだ授乳の記録が1件も無くても、計測中なら「授乳中」として扱う。
assert.deepEqual(resolveLastFeeding(null, nursing), {
  lastFedAt: null,
  isNursing: true,
  isPendingRecord: false,
});

// --- 目安の時刻 ---

// 直っていなければ 8:55 + 3時間 = 11:55 で「27分すぎ」と出ていた場面。
const withoutFix = nextFeedingSchedule(lastLogged, 180, now);
assert.equal(withoutFix?.isOverdue, true);
assert.equal(withoutFix?.overdueMinutes, 27);

// 記録待ちを数えると 11:41 + 3時間 = 14:41。まだ先。
const fixed = nextFeedingSchedule(resolveLastFeeding(lastLogged, pending).lastFedAt, 180, now);
assert.equal(fixed?.isOverdue, false);
assert.equal(fixed?.dueAt.toISOString(), at('2026-09-21T14:41:00+09:00').toISOString());

// 計測中は目安そのものを出さない。
assert.equal(nextFeedingSchedule(resolveLastFeeding(lastLogged, nursing).lastFedAt, 180, now), null);

console.log('feedingSchedule: OK');
