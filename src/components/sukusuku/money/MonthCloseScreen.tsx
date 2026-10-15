'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import type { CardMonthChecks } from '@/lib/moneyFeedUtils';
import {
  addDays,
  buildMonthSummary,
  categoryPath,
  estimatesInMonth,
  formatBalance,
  formatShortDate,
  formatYen,
  pendingRecurringInMonth,
  recordsInMonth,
  shiftMonth,
  walletBalanceOn,
} from '@/lib/moneyUtils';
import RecordDayList, { type RecordClosing } from './RecordDayList';
import { swipeBoundary } from '../ui/useSwipeNavigation';
import { FullScreen, PrimaryButton, ProgressBar, ScreenHeader, SectionHeader, cardClass, incomeAmountClass, type } from './moneyVisual';

// 月の締め（振り返りの確定。docs/kakei.md §4.5）。mobile版の `mobile/src/components/money/MonthCloseScreen.tsx` と同じ並び・文言。
//
// 月の締めは、1か月を振り返って、変な支出や収入が無いかを調べ、家族の財布の残高とカードの利用残高を合わせるもの。
// その月の記録を、記録の画面と同じ一覧で出し（カードも財布も口座の振替も）、**各記録にチェックボックス**を付ける（2026-10-15）。
// すべてチェックがついたら「この月を締める」が押せる。
// - 見込みの記録（自動で作ったまま、額を確かめていないもの）は黄色の「見込み」で、チェックボックスの代わりに「確定」を出す。
//   今の額で確定すると、確定してチェックも付く。額が違うものは、押して記録の詳細で直す（直した記録はチェックが外れる）
// - カードの利用通知を取り込んでいるカードの記録は、通知と額が違うもの・通知が来ていないものに注意を添える（docs/kakei.md §4.7）
// - 絞り込み: すべて / 未チェック / 見込み / 出金元ごと（財布・カードごとに合わせるため）。「表示中をまとめてチェック」もできる
// - 月末の残高: 出金元ごとの月末の残高を見られる（実際の残高と見比べ、違えば口座の面で補正する）
// - 年初からの累計は出さない（その月の締めなので）。これから自動で作られる記録・未確認の明細は、一覧の上下に知らせる
// 締めた月は、チェックを変えられない（「締めを外す」で外してから）。

interface MonthCloseScreenProps {
  monthKey: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  /** 固定収入・固定費のルール（これから自動で作られる記録を出す）。 */
  recurring: MoneyRecurring[];
  /** 今日（YYYY-MM-DD）。 */
  today: string;
  /** その月の日付の、未確認の明細の件数。 */
  feedCount: number;
  /** カードの記録を明細と見比べるための一覧（利用通知を取り込んでいるときだけ。docs/kakei.md §9.6.5 の C）。 */
  cardChecks: CardMonthChecks | null;
  wallets: MoneyWallet[];
  /** 確定した残高（月末の残高を出す）。 */
  balances: MoneyWalletBalance[];
  closed: boolean;
  /** 締めた日時（締めた月だけ）。 */
  closedAt: string | null;
  /** 見込みの記録を今の額で確定し、チェックも付ける。 */
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  /** チェックを付ける・外す。 */
  onSetChecked: (records: MoneyRecord[], checked: boolean) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  onOpenFeed: () => void;
  onCloseMonth: () => void;
  onReopenMonth: () => void;
  onClose: () => void;
}

/** 絞り込み。'all' すべて・'unchecked' 未チェック・'estimate' 見込み・それ以外は出金元の id。 */
type Filter = string;

/** 固定のルールの見出し。品名、無ければお店、無ければカテゴリ。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const name = rule.name.trim() || rule.store.trim();
  return name !== '' ? name : categoryPath(categories, rule.categoryId) || (rule.kind === 'income' ? '収入' : '支出');
}

const closedDateLabel = (closedAt: string) => {
  const date = new Date(closedAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

/** 見込みの記録は確定するまで「未チェック」。 */
const isDone = (record: MoneyRecord) => !record.isEstimate && record.checkedAt !== null;

export default function MonthCloseScreen({
  monthKey,
  records,
  categories,
  budgets,
  recurring,
  today,
  feedCount,
  cardChecks,
  wallets,
  balances,
  closed,
  closedAt,
  onConfirmEstimate,
  onSetChecked,
  onOpenRecord,
  onOpenFeed,
  onCloseMonth,
  onReopenMonth,
  onClose,
}: MonthCloseScreenProps) {
  const month = useMemo(() => buildMonthSummary(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  const inMonth = useMemo(() => recordsInMonth(records, monthKey), [records, monthKey]);
  const estimates = useMemo(() => estimatesInMonth(records, monthKey), [records, monthKey]);
  const pending = useMemo(
    () => pendingRecurringInMonth(recurring, records, monthKey, today),
    [recurring, records, monthKey, today],
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [showBalances, setShowBalances] = useState(false);
  // 確定を押した記録（読み直しが届くまで、二度押せないように）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const label = `${Number(monthKey.slice(5, 7))}月`;

  const doneCount = inMonth.filter(isDone).length;
  const remaining = inMonth.length - doneCount;

  // 利用通知と見比べた結果（記録の id → 注意の文言）。
  const notes = useMemo(() => {
    const map = new Map<string, string>();
    if (cardChecks) {
      for (const { record, feedAmount } of cardChecks.mismatched) {
        map.set(record.id, `カードの利用通知は ${formatYen(feedAmount)}。額が違います`);
      }
      for (const record of cardChecks.unnotified) map.set(record.id, 'カードの利用通知が来ていません（明細で確かめる）');
    }
    return map;
  }, [cardChecks]);

  // 絞り込みに使う出金元（その月に使われているもの）。
  const usedWallets = useMemo(() => {
    const ids = new Set<string>();
    for (const record of inMonth) {
      if (record.walletId) ids.add(record.walletId);
      if (record.toWalletId) ids.add(record.toWalletId);
    }
    return wallets.filter((wallet) => ids.has(wallet.id));
  }, [inMonth, wallets]);

  const shown = useMemo(() => {
    if (filter === 'all') return inMonth;
    if (filter === 'unchecked') return inMonth.filter((record) => !isDone(record));
    if (filter === 'estimate') return inMonth.filter((record) => record.isEstimate);
    return inMonth.filter((record) => record.walletId === filter || record.toWalletId === filter);
  }, [inMonth, filter]);
  const bulkTargets = shown.filter((record) => !record.isEstimate && record.checkedAt === null);

  // 月末（その月の最終日）の出金元ごとの残高。証券は記録から出せないので入れない。
  const lastDay = addDays(`${shiftMonth(monthKey, 1)}-01`, -1);
  const balanceRows = useMemo(
    () =>
      wallets
        .filter((wallet) => !wallet.archived && wallet.type !== 'securities')
        .map((wallet) => ({ wallet, amount: walletBalanceOn(wallet.id, lastDay, records, balances).amount }))
        .filter((row) => row.amount !== 0 || usedWallets.some((wallet) => wallet.id === row.wallet.id)),
    [wallets, records, balances, lastDay, usedWallets],
  );
  const filterWallet = wallets.find((wallet) => wallet.id === filter) ?? null;
  const filterBalance = filterWallet ? balanceRows.find((row) => row.wallet.id === filterWallet.id) : undefined;

  const confirm = async (record: MoneyRecord) => {
    setConfirming(record.id);
    try {
      await onConfirmEstimate(record);
    } finally {
      setConfirming(null);
    }
  };

  const closing: RecordClosing = {
    checked: (record) => record.checkedAt !== null,
    locked: closed,
    onToggle: (record) => void onSetChecked([record], record.checkedAt === null),
    onConfirm: (record) => void confirm(record),
    busyId: confirming,
    notes,
  };

  // これから自動で作られる記録があれば、締める前に確かめる。
  const closeMonth = () => {
    if (
      pending.length > 0 &&
      !window.confirm(
        `まだ自動で記録されていないものが${pending.length}件あります。締めたあとに作られた記録は、締めた収支に入っていません。記録されてから締め直すこともできます。このまま締めますか？`,
      )
    ) {
      return;
    }
    onCloseMonth();
  };

  const closeUnchecked = () => {
    if (!window.confirm(`チェックのないものが${remaining}件あります。チェックしないまま締めます。あとから締めを外して確かめることもできます。`)) return;
    closeMonth();
  };

  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: `すべて ${inMonth.length}` },
    { id: 'unchecked', label: `未チェック ${remaining}` },
    ...(estimates.length > 0 ? [{ id: 'estimate', label: `見込み ${estimates.length}` }] : []),
    ...usedWallets.map((wallet) => ({ id: wallet.id, label: wallet.name })),
  ];

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title={`${label}の締め`} icon="back" onClose={onClose} />

      {/* 固定: 収支・チェックの進み具合・絞り込み。スクロールするのは下の一覧だけ。 */}
      <div className="shrink-0 space-y-2 border-b border-gray-200 bg-white px-4 pt-2">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className={type.sub}>収支（{label}。見込みを含む）</p>
            <p
              className={`text-[26px] font-extrabold tabular-nums ${
                month.balance > 0 ? incomeAmountClass : month.balance < 0 ? 'text-red-600' : 'text-gray-900'
              }`}
            >
              {formatBalance(month.balance)}
            </p>
          </div>
          <div className="text-right">
            <p className={type.sub}>収入 {formatYen(month.income)}</p>
            <p className={type.sub}>支出 {formatYen(month.living)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <ProgressBar ratio={inMonth.length > 0 ? doneCount / inMonth.length : 0} />
          </div>
          <span className="text-xs font-bold tabular-nums text-gray-500">
            チェック {doneCount} / {inMonth.length}件
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2.5" {...swipeBoundary}>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={filter === chip.id}
              onClick={() => setFilter(chip.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] tabular-nums ${
                filter === chip.id ? 'bg-blue-100 font-bold text-blue-800' : 'bg-gray-100 font-semibold text-gray-700'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {feedCount > 0 && (
          <button
            type="button"
            onClick={onOpenFeed}
            className="mb-1 flex w-full items-center gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-left hover:bg-amber-200"
          >
            <span className="flex-1 text-[13px] font-semibold text-amber-800">未確認の明細が{feedCount}件あります。先に片づけると確かです</span>
            <ChevronRight size={16} className="text-gray-500" />
          </button>
        )}

        <button type="button" onClick={() => setShowBalances((open) => !open)} className="flex w-full items-center gap-1.5 py-2 text-left">
          <span className={`flex-1 ${type.title}`}>月末の残高</span>
          <span className={type.faint}>{showBalances ? '閉じる' : '実際の残高と見比べる'}</span>
          {showBalances ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>
        {showBalances && (
          <div className={`${cardClass} overflow-hidden`}>
            {balanceRows.map((row, index) => (
              <div key={row.wallet.id} className={`flex items-center gap-2 px-3.5 py-2.5 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{row.wallet.name}</span>
                <span className={type.faint}>{row.wallet.type === 'card' ? '利用残高' : '残高'}</span>
                <span className="text-[15px] font-extrabold tabular-nums text-gray-900">{formatBalance(row.amount)}</span>
              </div>
            ))}
            <p className={`${type.faint} px-3.5 pb-2`}>
              {lastDay.slice(5).replace('-', '/')}の終わりの、記録から出した額です。違えば、口座の面で残高を補正します
            </p>
          </div>
        )}
        {filterWallet !== null && filterBalance !== undefined && !showBalances && (
          <p className={`${type.faint} pb-1`}>
            {filterWallet.name} の月末の{filterWallet.type === 'card' ? '利用残高' : '残高'} {formatBalance(filterBalance.amount)}
          </p>
        )}

        <SectionHeader
          compact
          title="記録"
          hint={`${shown.length}件`}
          right={
            !closed && bulkTargets.length > 0 ? (
              <button type="button" onClick={() => void onSetChecked(bulkTargets, true)} className={type.link}>
                表示中をまとめてチェック（{bulkTargets.length}件）
              </button>
            ) : undefined
          }
        />
        {shown.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-gray-400">
            {inMonth.length === 0 ? 'この月の記録はありません' : filter === 'unchecked' ? 'すべてチェックしました' : 'この絞り込みの記録はありません'}
          </p>
        ) : (
          <RecordDayList records={shown} categories={categories} wallets={wallets} onOpen={onOpenRecord} closing={closing} />
        )}
        {estimates.length > 0 && (
          <p className={`${type.faint} mt-1`}>
            黄色の「見込み」は、まだ額を確かめていない記録です。「確定」は今の額のまま確定します。額が違うものは、押して記録の詳細で直してください
          </p>
        )}

        {pending.length > 0 && (
          <>
            <SectionHeader compact title="これから自動で記録されるもの" hint={`${pending.length}件`} />
            <div className="overflow-hidden rounded-2xl border border-amber-100 bg-white">
              {pending.map((entry, index) => (
                <div key={entry.rule.id} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
                  <span className="w-11 shrink-0 text-[13px] font-semibold text-gray-500 tabular-nums">{formatShortDate(entry.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{ruleTitle(entry.rule, categories)}</span>
                  <span className={`text-[15px] font-extrabold tabular-nums ${entry.rule.kind === 'income' ? incomeAmountClass : 'text-gray-900'}`}>
                    {formatYen(entry.amount)}
                  </span>
                </div>
              ))}
            </div>
            <p className={`${type.faint} mt-1`}>
              固定収入・固定費で、この月のうちにまだ自動で記録されていないものです。上の収支には入っていません。記録されてから締めると確かです
            </p>
          </>
        )}
      </div>

      <div className="shrink-0 space-y-1 border-t border-gray-200 bg-white px-4 pb-3 pt-2.5">
        {closed ? (
          <>
            <p className="text-center text-[13px] font-semibold text-gray-500 tabular-nums">
              {closedAt ? `${closedDateLabel(closedAt)}に締めました` : '締めた月です'}
            </p>
            <button type="button" onClick={onReopenMonth} className="w-full py-2 text-[13px] font-bold text-red-500">
              締めを外す
            </button>
          </>
        ) : (
          <>
            <PrimaryButton label="この月を締める" onClick={closeMonth} disabled={remaining > 0} />
            {remaining > 0 ? (
              <>
                <p className="text-center text-xs font-semibold tabular-nums text-gray-500">あと{remaining}件チェックすると締められます</p>
                <button type="button" onClick={closeUnchecked} className="w-full py-1.5 text-xs font-semibold text-gray-400">
                  チェックしないで締める
                </button>
              </>
            ) : (
              <p className="text-center text-xs font-semibold text-gray-500">すべてチェックしました</p>
            )}
          </>
        )}
      </div>
    </FullScreen>
  );
}
