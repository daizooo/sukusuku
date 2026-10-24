'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCardFeed,
  MoneyCategory,
  MoneyFeedItem,
  MoneyMonth,
  MoneyRatioTargets,
  MoneyRecord,
  MoneyRecurring,
  MoneyBudgetLine,
  MoneyWallet,
  MoneyWalletBalance,
} from '@/types/app';
import { cardMonthChecks } from '@/lib/moneyFeedUtils';
import {
  buildMonthSummary,
  buildCategoryAnalysis,
  buildReviewSections,
  buildSubcategoryAnalysis,
  buildYearLanding,
  dateKeyOfDate,
  estimatesInMonth,
  formatBalance,
  formatYear,
  formatYen,
  iconKeyOf,
  isMonthClosed,
  monthKeyOfDate,
  recordTotal,
  spendRatio,
  unclosedMonths,
  yearActiveMonthKeys,
  yearMonthKeys,
  UNCATEGORIZED,
  type BudgetTile,
  type ReviewSubRow,
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
import ReviewDetailScreen from './ReviewDetailScreen';
import MonthCloseScreen from './MonthCloseScreen';
import YearTrendChart from './YearTrendChart';
import { yearTrendPoints } from '@/lib/yearTrend';

// 家計タブの「振り返り」（docs/kakei.md §4・§0.9）。mobile版の `mobile/src/components/money/MoneyReviewView.tsx` と同じ並び・文言。
//
// 振り返りは予算に対して見る（2026-10-24）。月と年は同じ面で、上の送りの右「月 / 年」で期間を切り替える。年は暦年（1月〜12月）。
// - 月の結論: 収支＝収入 − 支出（実績）。見込みの額（自動で作り、まだ確かめていない額）は実績に入れて、件数と額を添える
// - 年の結論: 収支見込み（buildYearLanding。締めた月は実績、締めていない今月までは支出を予算と実績の大きいほう、翌月からは予算。
//   収入は締めるまで予算）。2026年は10〜12月の3か月だけ（集計を始めた年の特例。MONEY_COUNT_START）
// - 年の「推移」（§4.8）: 月ごとの収支（棒）と年初からの累計（折れ線）。締めた月は実線、ほかは点線
// - その下は、変動費 → 予備費 → 固定費（中に確定・見込み）→ カテゴリなし の見出しごと（buildReviewSections）。見出しを押すと折りたたむ。
//   はじめは変動費・予備費を開き、固定費は閉じておく。年の見出しの右に、実績の割合（その種類の支出の実績 ÷ 年の収入）と目安の割合
//   （家計の設定の「目安の割合」）を「11%（目安35%）」の形で出す（目安を超えたら赤。月には出さない）
//   - 変動費: 大分類ごとに、予算 − 実績・使った割合の帯・「実績 / 予算・%」
//   - 予備費: 記録のあった小分類。年は年の予算と比べる（変動費と同じ行）、月は額だけ
//   - 固定費: 記録のあった小分類の額。見込みは「予算より ¥x」を添える
//   - 行を押すと、変動費は大分類の詳細（月ごとの実績・小分類・記録）、予備費・固定費・カテゴリなしはその記録の一覧（ReviewDetailScreen）
// 月の締め（§4.5）: 過ぎた月と今月の結論の下に「この月を締める」（締めた月は「締めた月」）。押すと締めの画面（MonthCloseScreen）。
// 締めていない過ぎた月があれば、いちばん上に「◯月が締まっていません」と出す（集計を始める前の月は出さない）。

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
  /** 年の「推移」の吹き出しを押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  /** 詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
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
  /** 予算の明細（収入・予備費・固定費。年の収支見込みと、予備費・固定費の予算。docs/kakei.md §0.7）。 */
  budgetLines: MoneyBudgetLine[];
  /** 目安の割合（docs/kakei.md §0.9）。年の見出しに出す。 */
  ratioTargets: MoneyRatioTargets;
  /** 未確認の明細を開く。締めの画面からは、その月（日付未定の見込みもその月の分を出す）。 */
  onOpenFeed: (monthKey?: string) => void;
}

/** 見出しの種類（折りたたむ単位）。 */
type SectionKey = 'variable' | 'reserve' | 'fixed' | 'none';

/** 詳細を開いている行。sub は予備費・固定費・カテゴリなし（記録の一覧）。budget はその行と同じ比べる予算。 */
type OpenDetail = { category: MoneyCategory; sub: false } | { category: MoneyCategory; sub: true; budget: number | null };

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
  onOpenRecord,
  months: closings,
  recurring,
  budgetLines,
  ratioTargets,
  feedItems,
  cardFeed,
  onConfirmEstimate,
  onSetMonthClosed,
  onOpenFeed,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const [detail, setDetail] = useState<OpenDetail | null>(null);
  const [monthDetail, setMonthDetail] = useState<{ category: MoneyCategory; monthKey: string } | null>(null);
  // 締めの画面を開いている月。
  const [closing, setClosing] = useState<string | null>(null);
  // 折りたたんでいる見出し。はじめは固定費だけ閉じておく（2026-10-24）。
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(() => new Set<SectionKey>(['fixed']));
  const toggle = (key: SectionKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
  // 年の収支見込み（§0.9・§4.6）と「推移」（§4.8）。
  const landing = useMemo(
    () => (isMonth ? null : buildYearLanding(records, categories, budgets, budgetLines, closings, year, today)),
    [isMonth, records, categories, budgets, budgetLines, closings, year, today],
  );
  const trend = useMemo(() => (landing === null ? [] : yearTrendPoints(landing.months)), [landing]);
  // 見ている期間の月。月なら1つ、年なら数える月（2026年は10〜12月。2027年からは1〜12月）。
  const periodKeys = useMemo(
    () => (isMonth ? [monthKey] : yearActiveMonthKeys(records, year)),
    [isMonth, monthKey, records, year],
  );
  const sections = useMemo(
    () => (periodKeys.length === 0 ? null : buildReviewSections(records, categories, budgets, budgetLines, periodKeys, !isMonth)),
    [periodKeys, records, categories, budgets, budgetLines, isMonth],
  );

  const income = isMonth ? month.income : (landing?.income ?? 0);
  const living = isMonth ? month.living : (landing?.expense ?? 0);
  const balance = isMonth ? month.balance : (landing?.total ?? 0);
  const estimates = useMemo(() => {
    const keys = isMonth ? [monthKey] : yearMonthKeys(year).filter((key) => key <= today);
    const list = keys.flatMap((key) => estimatesInMonth(records, key));
    return { count: list.length, amount: list.reduce((sum, record) => sum + recordTotal(record), 0) };
  }, [isMonth, monthKey, year, today, records]);

  // 年の見出しの右の割合（実績の割合〔目安〕。目安を決めていない種類は出さない）。
  const ratioOf = (spend: number, target: number | null): ReactNode => {
    if (isMonth || target === null) return null;
    const ratio = spendRatio(spend, income);
    if (ratio === null) return null;
    return (
      <span className="text-xs font-semibold tabular-nums text-gray-400">
        <span className={`text-[13px] font-extrabold ${ratio > target ? 'text-red-600' : 'text-gray-900'}`}>{`${ratio}%`}</span>
        {`（目安${target}%）`}
      </span>
    );
  };

  // 行を押したときの分析。変動費は大分類（月ごと・小分類・記録）、予備費・固定費・カテゴリなしはその記録。
  const analysis = useMemo(() => {
    if (detail === null) return null;
    return detail.sub
      ? buildSubcategoryAnalysis(records, categories, detail.category.id, periodKeys, detail.budget)
      : buildCategoryAnalysis(records, categories, budgets, detail.category.id, periodKeys, null);
  }, [detail, periodKeys, records, categories, budgets]);
  // 年の大分類の詳細の、月ごとの行（数える月。締めていない月も入る。2026-10-16）。予備費・固定費は記録の一覧を出す。
  const monthRows = useMemo(
    () =>
      isMonth || analysis === null || detail === null || detail.sub
        ? null
        : analysis.months.map((entry) => ({ ...entry, closed: isMonthClosed(closings, entry.monthKey) })),
    [isMonth, analysis, detail, closings],
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

  const openSub = (row: ReviewSubRow) => setDetail({ category: row.category, sub: true, budget: row.budget });
  // 予備費・固定費の行。予算と比べるもの（年の予備費）は変動費と同じ行、ほかは額だけ（見込みは予算との差を添える）。
  const subRow = (row: ReviewSubRow, compare: boolean) =>
    compare && row.budget !== null ? (
      <CategoryRow key={row.category.id} tile={tileOf(row)} onClick={() => openSub(row)} />
    ) : (
      <AmountRow
        key={row.category.id}
        category={row.category}
        amount={row.actual}
        diff={!compare && row.budget !== null ? row.budget - row.actual : null}
        onClick={() => openSub(row)}
      />
    );

  const fixedCount = sections === null ? 0 : sections.confirmed.length + sections.estimate.length;
  // 年は目安を決めていれば記録が無くても見出しを出す（割合を見るため）。
  const showSection = (count: number, target: number | null) => count > 0 || (!isMonth && target !== null);

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
      <div className="flex-1 min-h-0 overflow-y-auto pb-36">
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
          label={isMonth ? '収支' : '収支見込み'}
          value={formatBalance(balance)}
          plus={balance > 0}
        >
          <StatRow compact label="収入" value={formatYen(income)} plus={income > 0} />
          <StatRow compact label="支出" value={formatBalance(-living)} />
          {estimates.count > 0 && (
            <div className="flex items-center gap-2 pt-2">
              <EstimateBadge />
              <span className={`flex-1 ${type.faint}`}>
                見込み {estimates.count}件（{formatYen(estimates.amount)}）
              </span>
            </div>
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

        {!isMonth && trend.length > 0 && (
          <>
            <SectionHeader compact title="推移" right={<TrendLegend />} />
            <div className={`${cardClass} px-1 py-1`}>
              <YearTrendChart points={trend} initialMonthKey={today} onSelectMonth={onSelectMonth} />
            </div>
          </>
        )}

        {sections === null || (sections.variable.length === 0 && sections.reserve.length === 0 && fixedCount === 0 && sections.uncategorized.count === 0) ? (
          <p className="py-6 text-center text-[13px] text-gray-400">「年間予算」を決めて記録をつけると、ここに予算との差が出ます</p>
        ) : (
          <>
            {showSection(sections.variable.length, ratioTargets.variable) && (
              <Section title="変動費" count={sections.variable.length} open={!collapsed.has('variable')} onToggle={() => toggle('variable')} right={ratioOf(sections.spend.variable, ratioTargets.variable)}>
                {sections.variable.map((tile) => (
                  <CategoryRow key={tile.category.id} tile={tile} onClick={() => setDetail({ category: tile.category, sub: false })} />
                ))}
              </Section>
            )}
            {showSection(sections.reserve.length, ratioTargets.reserve) && (
              <Section title="予備費" count={sections.reserve.length} open={!collapsed.has('reserve')} onToggle={() => toggle('reserve')} right={ratioOf(sections.spend.reserve, ratioTargets.reserve)}>
                {sections.reserve.map((row) => subRow(row, !isMonth))}
              </Section>
            )}
            {showSection(fixedCount, ratioTargets.fixed) && (
              <Section title="固定費" count={fixedCount} open={!collapsed.has('fixed')} onToggle={() => toggle('fixed')} right={ratioOf(sections.spend.fixed, ratioTargets.fixed)}>
                {sections.confirmed.length > 0 && <p className="px-3 pb-0.5 pt-1.5 text-xs font-bold text-gray-500">確定</p>}
                {sections.confirmed.map((row) => subRow(row, false))}
                {sections.estimate.length > 0 && <p className="px-3 pb-0.5 pt-1.5 text-xs font-bold text-gray-500">見込み</p>}
                {sections.estimate.map((row) => subRow(row, false))}
              </Section>
            )}
            {sections.uncategorized.count > 0 && (
              <Section title="カテゴリなし" count={1} open={!collapsed.has('none')} onToggle={() => toggle('none')}>
                <AmountRow
                  category={UNCATEGORIZED}
                  label={`${sections.uncategorized.count}品目`}
                  amount={sections.uncategorized.amount}
                  diff={null}
                  onClick={() => setDetail({ category: UNCATEGORIZED, sub: true, budget: null })}
                />
              </Section>
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
          // 記録・未確認の明細は締めの画面の上に重ねて開く（閉じる・戻るで締めの画面へ戻る。2026-10-21）
          onOpenRecord={onOpenRecord}
          onOpenFeed={() => onOpenFeed(closing)}
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
          detail={{ type: 'category', category: detail.category }}
          periodLabel={periodLabel}
          analysis={analysis}
          monthRows={monthRows}
          landing={null}
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

/** 予算と比べる小分類の行（年の予備費）を、変動費と同じ行の形にする。 */
const tileOf = (row: ReviewSubRow): BudgetTile => {
  const budget = row.budget ?? 0;
  return {
    category: row.category,
    budget: row.budget,
    actual: row.actual,
    diff: budget - row.actual,
    percent: budget > 0 ? Math.round((row.actual / budget) * 100) : null,
  };
};

/** 折りたためる見出し（押すと開く・閉じる。開閉の印は左）と、その中の一覧のカード。right は年の割合。 */
function Section({
  title,
  count,
  open,
  onToggle,
  right,
  children,
}: {
  title: string;
  /** 中の行の数（0 なら見出しだけ）。 */
  count: number;
  open: boolean;
  onToggle: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${title}を${open ? '閉じる' : '開く'}`}
        onClick={onToggle}
        className="mt-3.5 mb-1.5 flex w-full items-center gap-1.5 text-left"
      >
        <Icon size={16} className="text-gray-400" />
        <h3 className={type.title}>{title}</h3>
        <span className="flex-1" />
        {right}
      </button>
      {open && count > 0 && <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>{children}</div>}
    </>
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

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・**予算との差**（予算 − 実績。黒字は緑・赤字は「−」の黒）、使った割合の帯、実績・予算（2026-10-16）。予算が無ければ実績の額だけ。 */
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
            <span className="text-[15px] font-extrabold tabular-nums text-gray-900">{formatYen(tile.actual)}</span>
          ) : (
            <span className={`text-[15px] font-extrabold tabular-nums ${tile.diff > 0 ? incomeAmountClass : 'text-gray-900'}`}>
              {formatBalance(tile.diff)}
            </span>
          )}
        </div>
        {tile.budget !== null && (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <ProgressBar ratio={tile.budget ? tile.actual / tile.budget : 0} over={over} />
            </div>
            <span className={`shrink-0 ${type.faint}`}>
              {`${formatYen(tile.actual)} / ${formatYen(tile.budget)}`}
              {tile.percent !== null ? `・${tile.percent}%` : ''}
            </span>
          </div>
        )}
      </div>
      <ChevronRight size={16} className="text-gray-400" />
    </button>
  );
}

/** 予備費・固定費・カテゴリなしの1行（額だけ。帯は付けない）。diff は固定費（見込み）の予算との差（予算 − 実績）。 */
function AmountRow({
  category,
  label,
  amount,
  diff,
  onClick,
}: {
  category: MoneyCategory;
  label?: string;
  amount: number;
  diff: number | null;
  onClick: () => void;
}) {
  const name = label ?? category.name;
  return (
    <button
      type="button"
      aria-label={`${name}の記録を見る`}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left hover:bg-gray-50"
    >
      <CategoryIcon iconKey={iconKeyOf(category)} size={28} />
      <div className="min-w-0 flex-1 space-y-[3px]">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{name}</span>
          <span className="text-[15px] font-extrabold tabular-nums text-gray-900">{formatYen(amount)}</span>
        </div>
        {diff !== null && (
          <p className={`text-[11px] font-semibold tabular-nums ${diff < 0 ? 'text-red-600' : diff > 0 ? incomeAmountClass : 'text-gray-400'}`}>
            {`予算より ${formatBalance(diff)}`}
          </p>
        )}
      </div>
      <ChevronRight size={16} className="text-gray-400" />
    </button>
  );
}
