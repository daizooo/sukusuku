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
  recordTotal,
  shiftMonth,
  walletBalanceOn,
} from '@/lib/moneyUtils';
import RecordDayList, { type RecordClosing } from './RecordDayList';
import { EstimateBadge, FullScreen, Hero, PrimaryButton, ScreenHeader, SectionHeader, StatRow, cardClass, incomeAmountClass, type } from './moneyVisual';

// 月の締め（振り返りの確定。docs/kakei.md §4.5）。mobile版の `mobile/src/components/money/MonthCloseScreen.tsx` と同じ並び・文言。
//
// 月の締めは、1か月を振り返って、変な支出や収入が無いかを調べ、家族の財布の残高とカードの利用残高を合わせるもの。
// 上に収支を大きく（見込みの額も含む）、その下に**その月の記録を、記録の画面と同じ一覧**で並べる（2026-10-16。チェックボックスは付けない）。
// 「見込み」は、固定収入・固定費の見込みの額で自動で作ったまま、まだ確定していない記録だけ（財布・デビット・Gmail から取り込んだカードの記録に見込みは無い）。
// 見込みの記録には「見込み」の印と「確定」（今の額のまま確定）を付ける。額が違うものは、押して記録の詳細で直す。
// カードの利用通知と額が違う記録には、その旨を添える（通知が来ていない記録は、継続払いなど通知されないものもあるので出さない）。
// 記録の一覧は、**口座（出金元）ごとに絞り込める**（財布・カードごとに見て、月末の残高と合わせるため。2026-10-16）。
// 一覧のあとに、これから自動で作られる記録・未確認の明細・月末の残高（実際の残高と見比べる）を出す。
// 片づいていないものが残っていても「この月を締める」で締められる。年初からの累計は出さない（その月の締めなので）。
// その月に、固定収入・固定費でこれから自動で作られる記録がある（自動の記録より前に締める）ときは、一覧で知らせ、
// 締めるときにも確かめる（締めたあとに作られた記録は、締めた収支に入っていないため）。

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
  /** カードの記録を利用通知と見比べるための一覧（利用通知を取り込んでいるときだけ。docs/kakei.md §9.6.5 の C）。 */
  cardChecks: CardMonthChecks | null;
  wallets: MoneyWallet[];
  /** 確定した残高（月末の残高を出す）。 */
  balances: MoneyWalletBalance[];
  closed: boolean;
  /** 締めた日時（締めた月だけ）。 */
  closedAt: string | null;
  /** 見込みの記録を今の額で確定する。 */
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  onOpenFeed: () => void;
  onCloseMonth: () => void;
  onReopenMonth: () => void;
  onClose: () => void;
}

/** 固定のルールの見出し。品名、無ければお店、無ければカテゴリ。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const name = rule.name.trim() || rule.store.trim();
  return name !== '' ? name : categoryPath(categories, rule.categoryId) || (rule.kind === 'income' ? '収入' : '支出');
}

const closedDateLabel = (closedAt: string) => {
  const date = new Date(closedAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

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
  onOpenRecord,
  onOpenFeed,
  onCloseMonth,
  onReopenMonth,
  onClose,
}: MonthCloseScreenProps) {
  const month = useMemo(() => buildMonthSummary(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  const inMonth = useMemo(() => recordsInMonth(records, monthKey), [records, monthKey]);
  const estimates = useMemo(() => estimatesInMonth(records, monthKey), [records, monthKey]);
  const estimateAmount = estimates.reduce((sum, record) => sum + recordTotal(record), 0);
  const pending = useMemo(
    () => pendingRecurringInMonth(recurring, records, monthKey, today),
    [recurring, records, monthKey, today],
  );
  // 一覧の絞り込み。'all' はすべて、それ以外は出金元の id。
  const [filter, setFilter] = useState<string>('all');
  const [showBalances, setShowBalances] = useState(false);
  // 確定を押した記録（読み直しが届くまで、二度押せないように）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const label = `${Number(monthKey.slice(5, 7))}月`;

  // 利用通知と額が違う記録（記録の id → 注意の文言）。
  const notes = useMemo(() => {
    const map = new Map<string, string>();
    for (const { record, feedAmount } of cardChecks?.mismatched ?? []) {
      map.set(record.id, `カードの利用通知は ${formatYen(feedAmount)}。額が違います`);
    }
    return map;
  }, [cardChecks]);

  // 月末（その月の最終日）の出金元ごとの残高。証券は記録から出せないので入れない。
  const lastDay = addDays(`${shiftMonth(monthKey, 1)}-01`, -1);
  const balanceRows = useMemo(() => {
    const used = new Set<string>();
    for (const record of inMonth) {
      if (record.walletId) used.add(record.walletId);
      if (record.toWalletId) used.add(record.toWalletId);
    }
    return wallets
      .filter((wallet) => !wallet.archived && wallet.type !== 'securities')
      .map((wallet) => ({ wallet, amount: walletBalanceOn(wallet.id, lastDay, records, balances).amount }))
      .filter((row) => row.amount !== 0 || used.has(row.wallet.id));
  }, [wallets, records, balances, lastDay, inMonth]);

  // 絞り込みに使う出金元（その月に使われているもの）と、絞り込んだ記録。
  const usedWallets = useMemo(() => {
    const ids = new Set<string>();
    for (const record of inMonth) {
      if (record.walletId) ids.add(record.walletId);
      if (record.toWalletId) ids.add(record.toWalletId);
    }
    return wallets.filter((wallet) => ids.has(wallet.id));
  }, [inMonth, wallets]);
  const shown = useMemo(
    () => (filter === 'all' ? inMonth : inMonth.filter((record) => record.walletId === filter || record.toWalletId === filter)),
    [inMonth, filter],
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
    locked: closed,
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

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title={`${label}の締め`} icon="back" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <Hero compact label={`収支（${label}）`} value={formatBalance(month.balance)} plus={month.balance > 0}>
          <StatRow compact label="収入" value={formatYen(month.income)} plus={month.income > 0} />
          <StatRow compact label="支出" value={`−${formatYen(month.living)}`} />
          {estimates.length > 0 && (
            <div className="flex items-center gap-2 pt-2">
              <EstimateBadge />
              <p className={`min-w-0 flex-1 ${type.faint}`}>
                見込み {estimates.length}件（{formatYen(estimateAmount)}）
              </p>
            </div>
          )}
        </Hero>

        <SectionHeader
          compact
          title="記録"
          hint={`${shown.length}件`}
          right={
            usedWallets.length > 1 ? (
              <select
                aria-label="口座で絞り込む"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="max-w-[10rem] rounded-full bg-gray-100 px-3 py-1.5 text-[13px] font-semibold text-gray-700"
              >
                <option value="all">すべての口座</option>
                {usedWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />
        {filterWallet !== null && filterBalance !== undefined && (
          <p className={`${type.faint} pb-1.5`}>
            {filterWallet.name} の月末の{filterWallet.type === 'card' ? '利用残高' : '残高'} {formatBalance(filterBalance.amount)}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-gray-400">
            {inMonth.length === 0 ? 'この月の記録はありません' : 'この口座の記録はありません'}
          </p>
        ) : (
          <RecordDayList records={shown} categories={categories} wallets={wallets} onOpen={onOpenRecord} closing={closing} />
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
          </>
        )}

        {feedCount > 0 && (
          <button
            type="button"
            onClick={onOpenFeed}
            className="mt-2 flex w-full items-center gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-left hover:bg-amber-200"
          >
            <span className="flex-1 text-[13px] font-semibold text-amber-800">未確認の明細 {feedCount}件</span>
            <ChevronRight size={16} className="text-gray-500" />
          </button>
        )}

        <button type="button" onClick={() => setShowBalances((open) => !open)} className="mt-2 flex w-full items-center gap-1.5 py-2 text-left">
          <span className={`flex-1 ${type.title}`}>月末の残高</span>
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
          </div>
        )}
        {filterWallet !== null && filterBalance !== undefined && (
          <p className={`${type.faint} pb-1.5`}>
            {filterWallet.name} の月末の{filterWallet.type === 'card' ? '利用残高' : '残高'} {formatBalance(filterBalance.amount)}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-gray-400">
            {inMonth.length === 0 ? 'この月の記録はありません' : 'この口座の記録はありません'}
          </p>
        ) : (
          <RecordDayList records={shown} categories={categories} wallets={wallets} onOpen={onOpenRecord} closing={closing} />
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
          </>
        )}

        {feedCount > 0 && (
          <button
            type="button"
            onClick={onOpenFeed}
            className="mt-2 flex w-full items-center gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-left hover:bg-amber-200"
          >
            <span className="flex-1 text-[13px] font-semibold text-amber-800">未確認の明細 {feedCount}件</span>
            <ChevronRight size={16} className="text-gray-500" />
          </button>
        )}

        <button type="button" onClick={() => setShowBalances((open) => !open)} className="mt-2 flex w-full items-center gap-1.5 py-2 text-left">
          <span className={`flex-1 ${type.title}`}>月末の残高</span>
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
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-gray-200 px-4 pb-4 pt-2.5">
        {closed ? (
          <>
            <p className="text-center text-[13px] font-semibold text-gray-500">
              {closedAt ? `${closedDateLabel(closedAt)}に締めました` : '締めた月です'}
            </p>
            <button type="button" onClick={onReopenMonth} className="w-full py-2.5 text-[13px] font-bold text-red-500">
              締めを外す
            </button>
          </>
        ) : (
          <>
            <PrimaryButton label="この月を締める" onClick={closeMonth} />
          </>
        )}
      </div>
    </FullScreen>
  );
}
