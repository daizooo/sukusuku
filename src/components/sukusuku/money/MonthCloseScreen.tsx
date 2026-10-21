'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import type { CardMonthChecks } from '@/lib/moneyFeedUtils';
import {
  buildMonthSummary,
  categoryPath,
  estimatesInMonth,
  formatBalance,
  formatShortDate,
  formatYen,
  pendingRecurringInMonth,
  recordsInMonth,
  recordTotal,
  walletDelta,
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
// 記録の一覧は、**口座（出金元）ごとに絞り込める**（財布・カードごとに見て、実際の明細と合わせるため。2026-10-16）。
// 絞ると、その口座のその月の合計（入金・出金・差し引き。振替も入れる）を一覧の上に添える（2026-10-21。月末の残高は出さない）。
// 未確認の明細はいちばん上に出す（締める前に片づけるもの。2026-10-21）。記録は月の初め（1日）から並べる（月の初めからさかのぼって見るため。2026-10-21）。
// 一覧のあとに、これから自動で作られる記録を出す。
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
  /** 確定した残高（今は使わない。月末の残高は出さない。2026-10-21）。 */
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
  // 絞り込んだ口座の、その月の合計（入金・出金は件数も。振替も入れる）。
  const filterTotal = useMemo(() => {
    if (filter === 'all') return null;
    const total = { inAmount: 0, inCount: 0, outAmount: 0, outCount: 0 };
    for (const record of shown) {
      const delta = walletDelta(record, filter);
      if (delta > 0) {
        total.inAmount += delta;
        total.inCount += 1;
      } else if (delta < 0) {
        total.outAmount -= delta;
        total.outCount += 1;
      }
    }
    return total;
  }, [shown, filter]);

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
        {/* 未確認の明細は、締める前に片づけるものなので一番上に出す（2026-10-21）。 */}
        {feedCount > 0 && (
          <button
            type="button"
            onClick={onOpenFeed}
            className="mb-2 flex w-full items-center gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-left hover:bg-amber-200"
          >
            <span className="flex-1 text-[13px] font-semibold text-amber-800">未確認の明細 {feedCount}件</span>
            <ChevronRight size={16} className="text-gray-500" />
          </button>
        )}
        <Hero compact label={`収支（${label}）`} value={formatBalance(month.balance)} plus={month.balance > 0}>
          <StatRow compact label="収入" value={formatYen(month.income)} plus={month.income > 0} />
          <StatRow compact label="支出" value={formatBalance(-month.living)} />
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
        {filterWallet !== null && filterTotal !== null && shown.length > 0 && (
          <div className={`${cardClass} mb-1.5 px-3.5 py-2.5`}>
            <p className="truncate pb-0.5 text-sm font-bold text-gray-900">
              {filterWallet.name} の{label}の合計
            </p>
            {filterTotal.inCount > 0 && (
              <div className="flex items-center gap-2 py-0.5">
                <span className="flex-1 text-[13px] font-semibold text-gray-500">入金 {filterTotal.inCount}件</span>
                <span className={`text-[15px] font-extrabold tabular-nums ${incomeAmountClass}`}>{formatYen(filterTotal.inAmount)}</span>
              </div>
            )}
            {filterTotal.outCount > 0 && (
              <div className="flex items-center gap-2 py-0.5">
                <span className="flex-1 text-[13px] font-semibold text-gray-500">出金 {filterTotal.outCount}件</span>
                <span className="text-[15px] font-extrabold tabular-nums text-gray-900">{formatYen(filterTotal.outAmount)}</span>
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 border-t border-gray-200 pt-1.5">
              <span className="flex-1 text-[13px] font-semibold text-gray-500">
                {filterTotal.inCount > 0 && filterTotal.outCount > 0 ? '差し引き' : '合計'}
              </span>
              <span
                className={`text-xl font-extrabold tabular-nums ${filterTotal.inAmount > filterTotal.outAmount ? incomeAmountClass : 'text-gray-900'}`}
              >
                {formatBalance(filterTotal.inAmount - filterTotal.outAmount)}
              </span>
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-gray-400">
            {inMonth.length === 0 ? 'この月の記録はありません' : 'この口座の記録はありません'}
          </p>
        ) : (
          <RecordDayList records={shown} categories={categories} wallets={wallets} onOpen={onOpenRecord} closing={closing} oldestFirst />
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
