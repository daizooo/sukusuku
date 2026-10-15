'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyFeedItem, MoneyMonth, MoneyRecord, MoneyWallet } from '@/types/app';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildCategoryAnalysis,
  buildYearSummary,
  compareWithPreviousYear,
  estimatesInMonth,
  formatBalance,
  formatSignedYen,
  formatYear,
  formatYen,
  iconKeyOf,
  isMonthClosed,
  monthKeyOfDate,
  recordTotal,
  shiftMonth,
  unclosedMonths,
  yearMonthKeys,
  yearToDateBalance,
  type BudgetTile,
} from '@/lib/moneyUtils';
import {
  CategoryIcon,
  EstimateBadge,
  Hero,
  PeriodBar,
  ProgressBar,
  SectionHeader,
  StatRow,
  cardClass,
  incomeAmountClass,
  type,
  type ReviewPeriod,
} from './moneyVisual';
import ReviewDetailScreen, { type ReviewDetail } from './ReviewDetailScreen';
import YearFlowChart from './YearFlowChart';
import MonthCloseScreen from './MonthCloseScreen';

// 家計タブの「振り返り」（docs/kakei.md §4）。mobile版の `mobile/src/components/money/MoneyReviewView.tsx` と同じ並び・文言。
//
// 月と年は同じ面。上の送りの右「月 / 年」で期間を切り替える（2026-10-08に、別々の面から1つにした）。
// 年は暦年（1月〜12月。2026-10-09に年度から変えた。予算の月額も年ごと）。
// 結論は収支＝収入 − 支出（生活費）。
// 貯金は記録なので式にも表示にも入れない。
// 月には年初からの累計、年には月平均・前年の同じ月ぶんとの比べ・月ごとの収支と累計のグラフを添える（§0.4）。
// 年と累計は、記録のある月だけを数える（記録は2026年10月から）。
// その下の「内訳」は、大分類の一覧（種類の並び順）。
// 内訳の行を押すと、簡単な分析と、その行に絞った記録の一覧が開く（ReviewDetailScreen。§4.4）。
// 年は内訳の下に月ごとの収支（押すとその月へ）。
// 見込みの額（毎月の記録で自動で作り、まだ確かめていない額）は実績に入れて数え、件数と額を添えて出す（§3.3・§4.1）。
// 月の締め（§4.5）: 過ぎた月の結論の下に「この月を締める」（締めた月は「締めた月」）。押すと締めの画面（MonthCloseScreen）。
// 締めていない過ぎた月があれば、いちばん上に「◯月が締まっていません」と出す（押すとその月の締めの画面）。

interface MoneyReviewViewProps {
  period: ReviewPeriod;
  onPeriod: (period: ReviewPeriod) => void;
  monthKey: string;
  onMonth: (monthKey: string) => void;
  year: number;
  onYear: (year: number) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  /** 年の「月ごと」の行を押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  onEditCategories: () => void;
  /** 内訳の詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
  onOpenRecord: (record: MoneyRecord) => void;
  /** 月の締め（docs/kakei.md §4.5）。 */
  months: MoneyMonth[];
  /** 未確認の明細（締めの画面に、その月の件数を出す）。 */
  feedItems: MoneyFeedItem[];
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onSetMonthClosed: (monthKey: string, closed: boolean) => void;
  onOpenFeed: () => void;
}

export default function MoneyReviewView({
  period,
  onPeriod,
  monthKey,
  onMonth,
  year,
  onYear,
  records,
  categories,
  budgets,
  wallets,
  onSelectMonth,
  onEditCategories,
  onOpenRecord,
  months: closings,
  feedItems,
  onConfirmEstimate,
  onSetMonthClosed,
  onOpenFeed,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  // 締めの画面を開いている月。
  const [closing, setClosing] = useState<string | null>(null);
  const unclosed = useMemo(() => unclosedMonths(records, closings, today), [records, closings, today]);
  const monthClosed = isMonthClosed(closings, monthKey);
  const openClosing = (target: string) => {
    if (isMonth) onMonth(target);
    else onSelectMonth(target);
    setClosing(target);
  };

  const month = useMemo(
    () => buildMonthSummary(records, categories, budgets, monthKey),
    [records, categories, budgets, monthKey],
  );
  const yearSummary = useMemo(
    () => buildYearSummary(records, categories, budgets, year, today),
    [records, categories, budgets, year, today],
  );
  // 月: 年初からの累計。年: 前の年の同じ月ぶんとの比べ。
  const ytd = useMemo(
    () => (isMonth ? yearToDateBalance(records, categories, budgets, monthKey) : null),
    [isMonth, records, categories, budgets, monthKey],
  );
  const comparison = useMemo(
    () => (isMonth ? null : compareWithPreviousYear(records, categories, budgets, year, today)),
    [isMonth, records, categories, budgets, year, today],
  );
  // 見ている期間の月。月なら1つ、年なら記録のある月だけ（記録の無い月の予算は数えない）。
  const periodKeys = useMemo(
    () => (isMonth ? [monthKey] : yearSummary.months.filter((row) => row.recorded).map((row) => row.monthKey)),
    [isMonth, monthKey, yearSummary],
  );
  const tiles = useMemo(
    () => (periodKeys.length === 0 ? [] : buildBudgetTiles(records, categories, budgets, periodKeys)),
    [periodKeys, records, categories, budgets],
  );
  const income = isMonth ? month.income : yearSummary.total.income;
  const living = isMonth ? month.living : yearSummary.total.living;
  const balance = isMonth ? month.balance : yearSummary.total.balance;
  const estimates = useMemo(() => {
    const keys = isMonth ? [monthKey] : yearMonthKeys(year).filter((key) => key <= today);
    const list = keys.flatMap((key) => estimatesInMonth(records, key));
    return { count: list.length, amount: list.reduce((sum, record) => sum + recordTotal(record), 0) };
  }, [isMonth, monthKey, year, today, records]);
  const months = yearSummary.months.filter((row) => row.monthKey <= today && row.recorded).reverse();

  // 内訳の行を押したときの分析。前の期間（月なら前の月、年なら前の年の同じ月ぶん）と比べる。
  const analysis = useMemo(() => {
    if (detail === null || detail.type !== 'category') return null;
    const previousKeys = isMonth ? [shiftMonth(monthKey, -1)] : periodKeys.map((key) => shiftMonth(key, -12));
    return buildCategoryAnalysis(records, categories, budgets, detail.category.id, periodKeys, previousKeys);
  }, [detail, isMonth, monthKey, periodKeys, records, categories, budgets]);
  const periodLabel = isMonth ? `${Number(monthKey.slice(5, 7))}月` : formatYear(year);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PeriodBar
        period={period}
        onPeriod={onPeriod}
        monthKey={monthKey}
        onMonth={onMonth}
        year={year}
        onYear={onYear}
      />
      {/* 右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        {unclosed.length > 0 && (
          <button
            type="button"
            onClick={() => openClosing(unclosed[0])}
            className="mb-2 flex w-full items-center gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-left hover:bg-amber-200"
          >
            <span className="flex-1 text-[13px] font-semibold text-amber-800">
              {`${Number(unclosed[0].slice(5, 7))}月が締まっていません${unclosed.length > 1 ? `（ほか${unclosed.length - 1}か月）` : ''}。収支を確かめて締めましょう`}
            </span>
            <ChevronRight size={16} className="text-amber-800" />
          </button>
        )}
        <Hero
          compact
          label={isMonth ? '収支' : '収支（年）'}
          value={formatBalance(balance)}
          plus={balance > 0}
          note="収入 − 支出"
        >
          <StatRow compact label="収入" value={formatYen(income)} plus={income > 0} />
          <StatRow compact label="支出" value={`−${formatYen(living)}`} />
          {ytd !== null && (
            <StatRow
              compact
              label="年初からの累計"
              value={formatBalance(ytd)}
              plus={ytd > 0}
            />
          )}
          {!isMonth && yearSummary.average !== null && (
            <StatRow
              compact
              label="月平均"
              note={`記録のある${yearSummary.recordedMonths}か月ぶん`}
              value={formatBalance(yearSummary.average.balance)}
              plus={yearSummary.average.balance > 0}
            />
          )}
          {comparison !== null && (
            <StatRow
              compact
              label="前年の同じ月より"
              note={`前年 ${formatBalance(comparison.previousBalance)}（${comparison.months}か月ぶん）`}
              value={formatSignedYen(comparison.diff)}
              isMinus={comparison.diff < 0}
            />
          )}
          {estimates.count > 0 && (
            <div className="flex items-center gap-2 pt-2">
              <EstimateBadge />
              <span className={`flex-1 ${type.faint}`}>
                見込みの額 {estimates.count}件（{formatYen(estimates.amount)}）を含みます。額を確かめて直すと確定します
              </span>
            </div>
          )}
          {isMonth && (monthClosed || monthKey < today) && (
            <button
              type="button"
              onClick={() => setClosing(monthKey)}
              className="mt-2 flex w-full items-center gap-2 border-t border-gray-200 pt-2 text-left"
            >
              <span className={`flex-1 text-sm ${monthClosed ? 'font-semibold text-gray-500' : 'font-bold text-blue-600'}`}>
                {monthClosed ? '締めた月' : 'この月を締める'}
              </span>
              <ChevronRight size={16} className="text-gray-400" />
            </button>
          )}
        </Hero>


        {isMonth ? (
          <>
            <SectionHeader
              compact
              title="内訳"
              hint="押すと分析と記録"
              right={
                <button type="button" onClick={onEditCategories} className={type.link}>
                  カテゴリ・予算
                </button>
              }
            />
            {tiles.length === 0 && (
              <p className="py-6 text-center text-[13px] text-gray-400">「カテゴリ・予算」で種類と月の予算を決めると、ここに予算との差が出ます</p>
            )}
            <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
              {tiles.map((tile) => (
                <CategoryRow
                  key={tile.category.id}
                  tile={tile}
                  onClick={() => setDetail({ type: 'category', category: tile.category })}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {yearSummary.recordedMonths > 0 && (
              <>
                <SectionHeader compact title="月ごとの推移" hint="棒は月の収支・線は年初からの累計" />
                <div className={`${cardClass} overflow-hidden`}>
                  <YearFlowChart months={yearSummary.months} />
                </div>
              </>
            )}
            <SectionHeader
              compact
              title="内訳"
              hint="押すと分析と記録"
              right={
                <button type="button" onClick={onEditCategories} className={type.link}>
                  カテゴリ・予算
                </button>
              }
            />
            <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
              {tiles.map((tile) => (
                <CategoryRow
                  key={tile.category.id}
                  tile={tile}
                  onClick={() => setDetail({ type: 'category', category: tile.category })}
                />
              ))}
            </div>
            <SectionHeader compact title="月ごと" hint="押すとその月へ" />
            {months.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-gray-400">この年はまだ記録がありません</p>
            ) : (
              <div className={`${cardClass} overflow-hidden`}>
                {months.map((row, index) => {
                  const number = Number(row.monthKey.slice(5, 7));
                  return (
                    <button
                      key={row.monthKey}
                      type="button"
                      aria-label={`${number}月の振り返りを見る`}
                      onClick={() => onSelectMonth(row.monthKey)}
                      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-gray-50 ${
                        index > 0 ? 'border-t border-gray-200' : ''
                      }`}
                    >
                      <span className="w-10 text-[15px] font-bold text-gray-900 tabular-nums">{number}月</span>
                      <span className="min-w-0 flex-1">
                        {row.recorded ? (
                          <span className={`block truncate ${type.faint}`}>
                            収入 {formatYen(row.income)}・支出 {formatYen(row.living)}
                          </span>
                        ) : (
                          <span className={`block ${type.faint}`}>記録なし</span>
                        )}
                      </span>
                      {estimatesInMonth(records, row.monthKey).length > 0 && <EstimateBadge />}
                      {isMonthClosed(closings, row.monthKey) && <span className="text-[11px] font-bold text-gray-400">締め</span>}
                      {row.recorded && (
                        <span
                          className={`text-[17px] font-extrabold tabular-nums ${row.balance > 0 ? incomeAmountClass : 'text-gray-900'}`}
                        >
                          {formatBalance(row.balance)}
                        </span>
                      )}
                      <ChevronRight size={16} className="text-gray-400" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {closing !== null && (
        <MonthCloseScreen
          monthKey={closing}
          records={records}
          categories={categories}
          budgets={budgets}
          feedCount={feedItems.filter((item) => item.occurredOn !== null && item.occurredOn.startsWith(`${closing}-`)).length}
          closed={isMonthClosed(closings, closing)}
          closedAt={closings.find((entry) => entry.month === closing)?.closedAt ?? null}
          onConfirmEstimate={onConfirmEstimate}
          onOpenRecord={(record) => {
            setClosing(null);
            onOpenRecord(record);
          }}
          onOpenFeed={() => {
            setClosing(null);
            onOpenFeed();
          }}
          onCloseMonth={() => {
            onSetMonthClosed(closing, true);
            setClosing(null);
          }}
          onReopenMonth={() => onSetMonthClosed(closing, false)}
          onClose={() => setClosing(null)}
        />
      )}

      {detail !== null && (
        <ReviewDetailScreen
          detail={detail}
          periodLabel={periodLabel}
          isMonth={isMonth}
          analysis={analysis}
          categories={categories}
          wallets={wallets}
          onClose={() => setDetail(null)}
          onOpenRecord={(record) => {
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}
    </div>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・残り額、使った割合の帯と実績 / 予算。 */
function CategoryRow({ tile, onClick }: { tile: BudgetTile; onClick: () => void }) {
  const over = tile.budget !== null && tile.diff < 0;
  const quiet = tile.budget === null || tile.diff === 0;
  // 残りの額が大きく、予算を超えたら「残り −¥1,234」（符号をつけた黒。超えたことは帯の赤で見せる）。
  const headline = tile.budget === null ? '予算なし' : tile.diff === 0 ? '予算どおり' : `残り ${formatBalance(tile.diff)}`;
  return (
    <button
      type="button"
      aria-label={`${tile.category.name}の分析と記録を見る`}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left hover:bg-gray-50"
    >
      <CategoryIcon iconKey={iconKeyOf(tile.category)} size={28} />
      <div className="min-w-0 flex-1 space-y-[3px]">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{tile.category.name}</span>
          <span className={`text-[15px] font-extrabold tabular-nums ${quiet ? 'text-gray-400' : 'text-gray-900'}`}>{headline}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ProgressBar ratio={tile.budget ? tile.actual / tile.budget : 0} over={over} />
          </div>
          <span className={`shrink-0 ${type.faint}`}>
            {formatYen(tile.actual)}
            {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
            {tile.percent !== null ? `・${tile.percent}%` : ''}
          </span>
        </div>
      </div>
      <ChevronRight size={16} className="text-gray-400" />
    </button>
  );
}
