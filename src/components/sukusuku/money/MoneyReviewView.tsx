'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCardFeed,
  MoneyCategory,
  MoneyFeedItem,
  MoneyMonth,
  MoneyRecord,
  MoneyRecurring,
  MoneyWallet,
  MoneyWalletBalance,
} from '@/types/app';
import { cardMonthChecks } from '@/lib/moneyFeedUtils';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildCategoryAnalysis,
  categoryYearLanding,
  buildYearLanding,
  buildYearSummary,
  compareWithPreviousYear,
  dateKeyOfDate,
  estimatesInMonth,
  formatBalance,
  formatSignedYen,
  formatYear,
  formatYen,
  iconKeyOf,
  isMonthClosed,
  monthKeyOfDate,
  recordTotal,
  unclosedMonths,
  yearActiveMonthKeys,
  yearMonthKeys,
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
import MonthCloseScreen from './MonthCloseScreen';
import YearTrendChart from './YearTrendChart';
import { yearTrendPoints } from '@/lib/yearTrend';

// 家計タブの「振り返り」（docs/kakei.md §4）。mobile版の `mobile/src/components/money/MoneyReviewView.tsx` と同じ並び・文言。
//
// 月と年は同じ面。上の送りの右「月 / 年」で期間を切り替える（2026-10-08に、別々の面から1つにした）。
// 年は暦年（1月〜12月。2026-10-09に年度から変えた。予算の月額も年ごと）。
// 結論は収支＝収入 − 支出（生活費）。
// 貯金は記録なので式にも表示にも入れない。
// 月には年初からの累計、年には月平均・前年の同じ月ぶんとの比べ・月ごとの収支と累計のグラフを添える（§0.4）。
// 年と累計は、記録のある月だけを数える（記録は2026年10月から）。
// その下の「内訳」は、大分類の一覧（カテゴリの並び順）。
// 内訳の行を押すと、簡単な分析と、その行に絞った記録の一覧が開く（ReviewDetailScreen。§4.4）。
// 年は内訳の下に月ごとの収支（押すとその月へ）。
// 見込みの額（毎月の記録で自動で作り、まだ確かめていない額）は実績に入れて数え、件数と額を添えて出す（§3.3・§4.1）。
// 月の締め（§4.5）: 過ぎた月と今月の結論の下に「この月を締める」（月の最終週に締めることもあるため、今月も出す）（締めた月は「締めた月」）。押すと締めの画面（MonthCloseScreen）。
// 締めていない過ぎた月があれば、いちばん上に「◯月が締まっていません」と出す（押すとその月の締めの画面）。
// 年の「推移」（§4.8）: 結論とカテゴリの間に、月ごとの収支（棒）と年初からの累計（折れ線）。締めた月は実線、ほかは年末まで点線（年末の着地見込みと同じ数え方。§4.6）。
// 月を押すと吹き出しで収支と累計、吹き出しを押すとその月の振り返りへ。

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
  /** 確定した残高（月の締めで、月末の残高を出す）。 */
  balances: MoneyWalletBalance[];
  /** 年の「月ごと」の行を押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  onEditCategories: () => void;
  /** 予算（年ごと。カテゴリとは別の設定）を開く。 */
  onEditBudgets: () => void;
  /** 内訳の詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
  onOpenRecord: (record: MoneyRecord) => void;
  /** 月の締め（docs/kakei.md §4.5）。 */
  months: MoneyMonth[];
  /** 固定収入・固定費のルール（締めの画面に、これから自動で作られる記録を出す）。 */
  recurring: MoneyRecurring[];
  /** 未確認の明細（締めの画面に、その月の件数を出す）。 */
  feedItems: MoneyFeedItem[];
  /** カードの利用通知の取り込み（締めの画面で、カードの記録を明細と見比べる）。読み込み前は null。 */
  cardFeed: MoneyCardFeed | null;
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
  balances,
  onSelectMonth,
  onEditCategories,
  onEditBudgets,
  onOpenRecord,
  months: closings,
  recurring,
  feedItems,
  cardFeed,
  onConfirmEstimate,
  onSetMonthClosed,
  onOpenFeed,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [monthDetail, setMonthDetail] = useState<{ category: MoneyCategory; monthKey: string } | null>(null);
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
  // 年の「推移」グラフ（§4.8）。締めた月は実額、ほかは年末まで見込み（年末の着地見込みと同じ数え方。§4.6）。
  const trend = useMemo(() => {
    if (isMonth) return [];
    const result = buildYearLanding(records, categories, budgets, recurring, closings, year);
    return result === null ? [] : yearTrendPoints(result.months);
  }, [isMonth, records, categories, budgets, recurring, closings, year]);
  // 年: 前の年の同じ期間との比べ。
  const comparison = useMemo(
    () => (isMonth ? null : compareWithPreviousYear(records, categories, budgets, year, today)),
    [isMonth, records, categories, budgets, year, today],
  );
  // 見ている期間の月。月なら1つ、年なら使い始めた月から12月まで（年の予算がかかる月。使い始める前の月の予算は数えない。2026-10-15）。
  const periodKeys = useMemo(
    () => (isMonth ? [monthKey] : yearActiveMonthKeys(records, year)),
    [isMonth, monthKey, records, year],
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

  // 年の「月」の一覧（1月から。記録のある月だけ。未来の月は出さない）。
  const months = yearSummary.months.filter((row) => row.monthKey <= today && row.recorded);

  // 内訳の行を押したときの分析。見ている期間の予算（年は年の予算）・実績・小分類ごと・記録。年は締めた月ごとの実績も出す（2026-10-16）。
  const analysis = useMemo(
    () => (detail === null ? null : buildCategoryAnalysis(records, categories, budgets, detail.category.id, periodKeys, null)),
    [detail, periodKeys, records, categories, budgets],
  );
  // 年の詳細の月ごとの行（1月から。締めていない月も入る。2026-10-16）。
  const monthRows = useMemo(
    () =>
      isMonth || analysis === null
        ? null
        : analysis.months.map((entry) => ({ ...entry, closed: isMonthClosed(closings, entry.monthKey) })),
    [isMonth, analysis, closings],
  );
  // 年の詳細の年末の着地見込み（締めた月は実績、ほかの月は月の予算）。
  const categoryLanding = useMemo(
    () =>
      isMonth || analysis === null
        ? null
        : categoryYearLanding(analysis.months, new Set(analysis.months.filter((entry) => isMonthClosed(closings, entry.monthKey)).map((entry) => entry.monthKey))),
    [isMonth, analysis, closings],
  );
  // 年の詳細の月の行を押したときの、その月のカテゴリの詳細。
  const monthAnalysis = useMemo(
    () =>
      monthDetail === null
        ? null
        : buildCategoryAnalysis(records, categories, budgets, monthDetail.category.id, [monthDetail.monthKey], null),
    [monthDetail, records, categories, budgets],
  );
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
          label="収支"
          value={formatBalance(balance)}
          plus={balance > 0}
        >
          <StatRow compact label="収入" value={formatYen(income)} plus={income > 0} />
          <StatRow compact label="支出" value={`−${formatYen(living)}`} />
          {estimates.count > 0 && (
            <div className="flex items-center gap-2 pt-2">
              <EstimateBadge />
              <span className={`flex-1 ${type.faint}`}>
                見込み {estimates.count}件（{formatYen(estimates.amount)}）
              </span>
            </div>
          )}
          {/* 年の月平均・前年との比べは、収支と混同しないよう、線で分ける（2026-10-16） */}
          {!isMonth && (
            <>
              <div className="my-1.5 border-t border-gray-300" />
              {yearSummary.average !== null && (
                <StatRow
                  compact
                  label="月平均"
                  value={formatBalance(yearSummary.average.balance)}
                  plus={yearSummary.average.balance > 0}
                />
              )}
              {comparison !== null && (
                <StatRow
                  compact
                  label="前年の同じ期間より"
                  value={formatSignedYen(comparison.diff)}
                  plus={comparison.diff > 0}
                />
              )}
            </>
          )}
          {isMonth && (monthClosed || monthKey <= today) && (
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
              right={<SettingLinks onEditCategories={onEditCategories} onEditBudgets={onEditBudgets} />}
            />
            {tiles.length === 0 && (
              <p className="py-6 text-center text-[13px] text-gray-400">「カテゴリ」と「予算」を決めると、ここに予算との差が出ます</p>
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
            {trend.length > 0 && (
              <>
                <SectionHeader compact title="推移" right={<TrendLegend />} />
                <div className={`${cardClass} px-1 py-1`}>
                  <YearTrendChart points={trend} initialMonthKey={today} onSelectMonth={onSelectMonth} />
                </div>
              </>
            )}
            <SectionHeader compact title="カテゴリ" />
            {tiles.length === 0 && (
              <p className="py-6 text-center text-[13px] text-gray-400">「カテゴリ」と「予算」を決めると、ここに年の予算との差が出ます</p>
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
            <SectionHeader compact title="月" />
            {months.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-gray-400">この年はまだ記録がありません</p>
            ) : (
              <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
                {months.map((row) => {
                  const number = Number(row.monthKey.slice(5, 7));
                  return (
                    <button
                      key={row.monthKey}
                      type="button"
                      aria-label={`${number}月の振り返りを見る`}
                      onClick={() => onSelectMonth(row.monthKey)}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50"
                    >
                      <span className="min-w-0 flex-1 text-[15px] font-bold text-gray-900 tabular-nums">{number}月</span>
                      <span className={`text-[17px] font-extrabold tabular-nums ${row.balance > 0 ? incomeAmountClass : 'text-gray-900'}`}>
                        {formatBalance(row.balance)}
                      </span>
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
          recurring={recurring}
          today={dateKeyOfDate(new Date())}
          feedCount={feedItems.filter((item) => item.occurredOn !== null && item.occurredOn.startsWith(`${closing}-`)).length}
          cardChecks={cardFeed && cardFeed.walletIds.length > 0 ? cardMonthChecks(records, cardFeed, closing) : null}
          wallets={wallets}
          balances={balances}
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
          analysis={analysis}
          monthRows={monthRows}
          landing={categoryLanding}
          onOpenMonth={(key) => setMonthDetail({ category: detail.category, monthKey: key })}
          categories={categories}
          wallets={wallets}
          onClose={() => setDetail(null)}
          onOpenRecord={(record) => {
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}

      {monthDetail !== null && (
        <ReviewDetailScreen
          detail={{ type: 'category', category: monthDetail.category }}
          periodLabel={`${Number(monthDetail.monthKey.slice(5, 7))}月`}
          analysis={monthAnalysis}
          monthRows={null}
          landing={null}
          onOpenMonth={() => undefined}
          categories={categories}
          wallets={wallets}
          onClose={() => setMonthDetail(null)}
          onOpenRecord={(record) => {
            setMonthDetail(null);
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}
    </div>
  );
}

/** 「推移」の見出しの右の凡例（棒＝収支、折れ線＝年の累計）。 */
function TrendLegend() {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex items-center gap-1 ${type.faint}`}>
        <span className="h-2.5 w-2.5 rounded-sm bg-blue-300" />
        収支
      </span>
      <span className={`flex items-center gap-1 ${type.faint}`}>
        <span className="h-0.5 w-4 bg-blue-600" />
        年の累計
      </span>
    </div>
  );
}

/** 内訳の見出しの右の、設定への入口（カテゴリと予算は別の設定。2026-10-15）。 */
function SettingLinks({ onEditCategories, onEditBudgets }: { onEditCategories: () => void; onEditBudgets: () => void }) {
  return (
    <span className="flex gap-3.5">
      <button type="button" onClick={onEditCategories} className={type.link}>
        カテゴリ
      </button>
      <button type="button" onClick={onEditBudgets} className={type.link}>
        予算
      </button>
    </span>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・**予算との差**（予算 − 実績。黒字は緑・赤字は「−」の黒）、使った割合の帯、実績・予算（2026-10-16）。 */
function CategoryRow({ tile, onClick }: { tile: BudgetTile; onClick: () => void }) {
  const over = tile.budget !== null && tile.diff < 0;
  return (
    <button
      type="button"
      aria-label={`${tile.category.name}の内訳を見る`}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left hover:bg-gray-50"
    >
      <CategoryIcon iconKey={iconKeyOf(tile.category)} size={28} />
      <div className="min-w-0 flex-1 space-y-[3px]">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{tile.category.name}</span>
          {tile.budget === null ? (
            <span className="text-[15px] font-extrabold text-gray-400">予算なし</span>
          ) : (
            <span className={`text-[15px] font-extrabold tabular-nums ${tile.diff > 0 ? incomeAmountClass : 'text-gray-900'}`}>
              {formatBalance(tile.diff)}
            </span>
          )}
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
