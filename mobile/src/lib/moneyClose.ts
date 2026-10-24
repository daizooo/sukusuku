// 月の締めの数え方（docs/kakei.md §4.5。2026-10-24）。PWA版の `src/lib/moneyClose.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 締めは、口座ごとに、その月の入出金を振り返りながら、残高が合っているかを夫婦で確かめる作業。
// - 照合する額: 銀行・財布などは締めた日（今日）の残高。カードはその月の利用（支出 − 返品。引き落としの振替は入れない）
// - OK は押したときの額を持つ。今の額と違えば（記録を足す・直す・補正した）、その OK は外れた扱い
// - 締められるのは、締めに加わる人（夫婦）全員が、すべての口座で OK したときだけ

import type { FamilyMember, MoneyMonthRequest, MoneyMonthWalletCheck, MoneyRecord, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import { recordsInMonth, walletBalanceOn, walletDelta } from './moneyUtils.ts';

/** 締めの合図が有効な長さ（サーバーの request_money_month_close と同じ）。 */
export const CLOSE_REQUEST_MS = 5 * 60 * 1000;

/** 締めで照合する口座（使っているもの。証券口座は除く）。並びは口座の並び。 */
export const closeWallets = (wallets: readonly MoneyWallet[]): MoneyWallet[] =>
  wallets.filter((wallet) => !wallet.archived && wallet.type !== 'securities').sort((a, b) => a.position - b.position);

/** 照合する額。カードはその月の利用（マイナス）、ほかは今日の残高。 */
export function closeFigure(
  wallet: MoneyWallet,
  records: readonly MoneyRecord[],
  balances: readonly MoneyWalletBalance[],
  monthKey: string,
  today: string,
): number {
  if (wallet.type !== 'card') return walletBalanceOn(wallet.id, today, records, balances).amount;
  let sum = 0;
  for (const record of recordsInMonth(records, monthKey)) {
    if (record.kind === 'transfer' || record.walletId !== wallet.id) continue;
    sum += walletDelta(record, wallet.id);
  }
  return sum;
}

/** 照合する額の見出し。 */
export const closeFigureLabel = (wallet: MoneyWallet, monthKey: string, today: string): string =>
  wallet.type === 'card' ? `${Number(monthKey.slice(5, 7))}月の利用残高` : `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))} の残高`;

/** 口座の、その月の記録。カードは引き落としなどの振替を出さない。 */
export const closeRecords = (wallet: MoneyWallet, records: readonly MoneyRecord[], monthKey: string): MoneyRecord[] =>
  recordsInMonth(records, monthKey).filter((record) =>
    wallet.type === 'card'
      ? record.kind !== 'transfer' && record.walletId === wallet.id
      : record.walletId === wallet.id || record.toWalletId === wallet.id,
  );

/** その口座で、今の額のまま OK している人。 */
export function okUsers(checks: readonly MoneyMonthWalletCheck[], monthKey: string, walletId: string, figure: number): Set<string> {
  const users = new Set<string>();
  for (const check of checks) {
    if (check.month === monthKey && check.walletId === walletId && check.amount !== null && check.amount === figure) users.add(check.userId);
  }
  return users;
}

/** 締めに加わる人全員が OK しているか。 */
export const allOk = (ok: ReadonlySet<string>, guardians: readonly FamilyMember[]): boolean =>
  guardians.length > 0 && guardians.every((member) => ok.has(member.id));

/** まだ有効な締めの合図（人 → 切れる時刻〔ミリ秒〕）。nowMs はサーバーの時刻に合わせた今。 */
export function activeRequests(requests: readonly MoneyMonthRequest[], monthKey: string, nowMs: number): Map<string, number> {
  const active = new Map<string, number>();
  for (const request of requests) {
    if (request.month !== monthKey || request.requestedAt === null) continue;
    const expires = Date.parse(request.requestedAt) + CLOSE_REQUEST_MS;
    if (expires > nowMs) active.set(request.userId, expires);
  }
  return active;
}

/** 残り時間の表示（4:32）。 */
export const formatRemaining = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
