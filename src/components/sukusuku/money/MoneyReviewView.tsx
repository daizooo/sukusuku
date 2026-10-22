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
  MoneyBudgetLine,
  MoneyWallet,
  MoneyWalletBalance,
} from '@/types/app';
import { cardMonthChecks } from '@/lib/moneyFeedUtils';
import {
  buildCategoryAnalysis,
  categoryPath,
  categorySpentIn,
  categoryYearLanding,
  buildYearLanding,
  dateKeyOfDate,
  estimatesInMonth,
  fixedBudgetRows,
  fixedSpendInMonth,
  formatYear,
  formatYen,
  isMonthClosed,
  monthKeyOfDate,
  periodSummary,
  recordTotal,
  reserveYearRows,
  topCategoryIdOf,
  unclosedMonths,
  undatedPendingInMonth,
  variableTiles,
  yearActiveMonthKeys,
  yearMonthKeys,
} from '@/lib/moneyUtils';
import { EstimateBadge, PeriodBar, SectionHeader, cardClass, type, type ReviewPeriod } from './moneyVisual';
import { AmountRow, BalanceCard, SECTION_DOTS, SectionCard, remainingText, signedYen, type ChipTone } from './reviewParts';
import ReviewDetailScreen, { type ReviewDetail } from './ReviewDetailScreen';
import MonthCloseScreen from './MonthCloseScreen';
import YearTrendChart from './YearTrendChart';
import { yearTrendPoints } from '@/lib/yearTrend';

// 家計タブの「振り返り」（docs/kakei.md §4）。mobile版の `mobile/src/components/money/MoneyReviewView.tsx` と同じ並び・文言。
//
// 月と年は同じ面。上の送りの右「月 / 年」で期間を切り替える（2026-10-08に、別々の面から1つにした）。
// 年は暦年（1月〜12月。2026-10-09に年度から変えた。予算の月額も年ごと）。
// 結論は収支＝収入 − 支出。貯金は記録なので式にも表示にも入れない。
// いちばん上の収支の枠（BalanceCard）は年間予算と同じ形（2026-10-22。docs/kakei.md §0.7）。収入・支出を切り替えて内訳の割合を出す
// （収入は大分類ごと、支出は変動費〔変動費＋予備費〕と固定費〔固定費＋変動固定費〕）。年は枠の下に年末の着地見込み。
// その下は 変動費 → 予備費 → 固定費 の枠（押すと折りたたむ。開いたときは固定費だけ閉じる）。
// - 変動費: 大分類ごとの実績と、予算の残り（超過は赤）。行を押すと、簡単な分析と、その大分類に絞った記録の一覧（ReviewDetailScreen。§4.4）
// - 予備費: 小分類ごとの年の予算の残り。月は今月使った額、年はその年に使った額
// - 固定費: 月はその月に記録があったもの（予算との差は出さない。押すと記録）。年は確定・見込みの実績と年の予算、
//   予算と違ったもの（締めた月までの実績と、その月までに発生する回の予算の差。docs/kakei.md §0.7）
// 支出の分け方は大分類の予算の分け方だけで決める。予算は年間予算の明細（自動記録ルールは使わない）。
// 年は枠の下に推移のグラフ。
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
  /** 内訳の詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
  onOpenRecord: (record: MoneyRecord) => void;
  /** 月の締め（docs/kakei.md §4.5）。 */
  months: MoneyMonth[];
  /** 固定収入・固定費のルール（締めの画面に、これから自動で作られる記録を出す）。 */
  recurring: MoneyRecurring[];
  /** 予算の明細（収入・予備費・固定費。年末の着地見込みと、予備費・固定費の予算。docs/kakei.md §0.7）。 */
  budgetLines: MoneyBudgetLine[];
  /** 未確認の明細（締めの画面に、その月の件数を出す）。 */
  feedItems: MoneyFeedItem[];
  /** カードの利用通知の取り込み（締めの画面で、カードの記録を明細と見比べる）。読み込み前は null。 */
  cardFeed: MoneyCardFeed | null;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onSetMonthClosed: (monthKey: string, closed: boolean) => void;
  /** 未確認の明細を開く。締めの画面からは、その月（日付未定の見込みもその月の分を出す）。 */
  onOpenFeed: (monthKey?: string) => void;
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
  onOpenRecord,
  months: closings,
  recurring,
  budgetLines,
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

  // 年の数える月（今月まで）。
  const yearKeys = useMemo(() => yearMonthKeys(year).filter((key) => key <= today), [year, today]);
  const summaryKeys = useMemo(() => (isMonth ? [monthKey] : yearKeys), [isMonth, monthKey, yearKeys]);
  const summary = useMemo(
    () => periodSummary(records, categories, summaryKeys),
    [records, categories, summaryKeys],
  );
  // 年末の着地見込みと「推移」グラフ（§4.6・§4.8）。締めた月は実額、ほかは年末まで見込み。
  const landing = useMemo(
    () => (isMonth ? null : buildYearLanding(records, categories, budgets, budgetLines, closings, year)),
    [isMonth, records, categories, budgets, budgetLines, closings, year],
  );
  const trend = useMemo(() => (landing === null ? [] : yearTrendPoints(landing.months)), [landing]);
  // 見ている期間の月。月なら1つ、年なら使い始めた月から12月まで（年の予算がかかる月。使い始める前の月の予算は数えない。2026-10-15）。
  const periodKeys = useMemo(
    () => (isMonth ? [monthKey] : yearActiveMonthKeys(records, year)),
    [isMonth, monthKey, records, year],
  );
  const tiles = useMemo(
    () => (periodKeys.length === 0 ? [] : variableTiles(records, categories, budgets, periodKeys)),
    [periodKeys, records, categories, budgets],
  );
  const reserveYear = isMonth ? Number(monthKey.slice(0, 4)) : year;
  const reserveRows = useMemo(
    () =>
      reserveYearRows(budgetLines, categories, records, reserveYear)
        .map((row) => ({ ...row, category: categories.find((category) => category.id === row.categoryId) }))
        .filter((row) => row.category !== undefined)
        .map((row) => ({ ...row, period: isMonth ? categorySpentIn(records, row.categoryId, [monthKey]) : row.spent })),
    [budgetLines, records, reserveYear, categories, isMonth, monthKey],
  );
  const fixedMonth = useMemo(
    () => (isMonth ? fixedSpendInMonth(records, categories, monthKey) : []),
    [isMonth, records, categories, monthKey],
  );
  // 年の固定費: 確定・見込みの年の予算（明細）と、予算と違ったもの（締めた月までの実績と、その月までに発生する回の予算の差）。
  const fixedYear = useMemo(() => {
    if (isMonth) return null;
    const closedKeys = yearMonthKeys(year).filter((key) => isMonthClosed(closings, key));
    const upTo = closedKeys.length === 0 ? `${year}-00` : closedKeys[closedKeys.length - 1];
    const rows = fixedBudgetRows(budgetLines, categories, records, year, upTo);
    const total = (mode: 'confirmed' | 'estimate') => rows.filter((row) => row.mode === mode).reduce((sum, row) => sum + row.budget, 0);
    return {
      confirmed: total('confirmed'),
      estimate: total('estimate'),
      upTo: closedKeys.length === 0 ? null : upTo,
      diffs: closedKeys.length === 0 ? [] : rows.filter((row) => row.budgetToDate > 0 && row.actual !== row.budgetToDate),
    };
  }, [isMonth, budgetLines, categories, records, year, closings]);
  // 締めの画面の未確認の明細に足す、日付未定の見込み（その月に記録が無いもの）。
  const undatedCount = useMemo(
    () => (closing === null ? 0 : undatedPendingInMonth(recurring, records, closing, dateKeyOfDate(new Date())).length),
    [closing, recurring, records],
  );
  const [open, setOpen] = useState({ variable: true, reserve: true, fixed: false });
  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const estimates = useMemo(() => {
    const keys = isMonth ? [monthKey] : yearMonthKeys(year).filter((key) => key <= today);
    const list = keys.flatMap((key) => estimatesInMonth(records, key));
    return { count: list.length, amount: list.reduce((sum, record) => sum + recordTotal(record), 0) };
  }, [isMonth, monthKey, year, today, records]);

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
  const lastYearMonth = yearKeys.length === 0 ? 0 : Number(yearKeys[yearKeys.length - 1].slice(5, 7));
  const balanceLabel = isMonth
    ? `収支（${Number(monthKey.slice(5, 7))}月）`
    : lastYearMonth === 0 || lastYearMonth === 12
      ? `収支（${formatYear(year)}）`
      : `収支（1〜${lastYearMonth}月）`;
  const budgeted = tiles.filter((tile) => tile.budget !== null);
  const variableBudget = budgeted.reduce((sum, tile) => sum + (tile.budget ?? 0), 0);
  const variableActual = budgeted.reduce((sum, tile) => sum + tile.actual, 0);
  const chipOf = (value: number, label: string): { text: string; tone: ChipTone } =>
    value < 0 ? { text: `超過 ${formatYen(value)}`, tone: 'over' } : { text: `${label} ${formatYen(value)}`, tone: 'good' };
  const variableChip = budgeted.length === 0 ? null : chipOf(variableBudget - variableActual, '残り');
  const reserveAmount = reserveRows.reduce((sum, row) => sum + row.amount, 0);
  const reserveSpent = reserveRows.reduce((sum, row) => sum + row.spent, 0);
  const reserveChip = isMonth
    ? { text: `今月 ${formatYen(reserveRows.reduce((sum, row) => sum + row.period, 0))}`, tone: 'neutral' as const }
    : chipOf(reserveAmount - reserveSpent, '残り');
  const fixedChip: { text: string; tone: ChipTone } =
    fixedYear === null
      ? { text: `今月 ${formatYen(fixedMonth.reduce((sum, entry) => sum + entry.amount, 0))}`, tone: 'neutral' }
      : fixedYear.confirmed + fixedYear.estimate - summary.confirmed - summary.estimate < 0
        ? { text: `超過 ${formatYen(fixedYear.confirmed + fixedYear.estimate - summary.confirmed - summary.estimate)}`, tone: 'over' }
        : { text: `これから ${formatYen(fixedYear.confirmed + fixedYear.estimate - summary.confirmed - summary.estimate)}`, tone: 'neutral' };
  // 予備費の行を押したとき: その小分類の大分類の詳細。
  const openTopOf = (categoryId: string) => {
    const topId = topCategoryIdOf(categories, categoryId);
    const top = categories.find((category) => category.id === topId);
    if (top) setDetail({ type: 'category', category: top });
  };

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
        <BalanceCard
          label={balanceLabel}
          incomeParts={summary.income.map((part) => ({ name: part.name, amount: part.amount }))}
          expenseParts={[
            { name: '変動費', amount: summary.variable + summary.reserve, note: '変動費＋予備費' },
            { name: '固定費', amount: summary.confirmed + summary.estimate, note: '固定費＋変動固定費' },
          ]}
        >
          {estimates.count > 0 && (
            <div className="flex items-center gap-2 border-t border-gray-100 px-[18px] py-3">
              <EstimateBadge />
              <span className={`flex-1 ${type.faint}`}>
                見込み {estimates.count}件（{formatYen(estimates.amount)}）
              </span>
            </div>
          )}
          {landing !== null && (
            <div className="flex items-center gap-2 border-t border-gray-100 px-[18px] py-3">
              <span className="flex-1 text-[13px] font-bold text-gray-500">年末の着地見込み</span>
              <span className={`text-lg font-extrabold tabular-nums ${landing.total < 0 ? 'text-red-700' : 'text-gray-900'}`}>{signedYen(landing.total)}</span>
            </div>
          )}
          {landing !== null && landing.unscheduled !== 0 && (
            <p className="px-[18px] pb-2.5 text-xs font-medium text-gray-400">
              締めた月は実績、ほかの月は予算。うち発生月なしの見込み {signedYen(landing.unscheduled)}
            </p>
          )}
          {isMonth && (monthClosed || monthKey <= today) && (
            <button
              type="button"
              onClick={() => setClosing(monthKey)}
              className="flex w-full items-center gap-2 border-t border-gray-100 px-[18px] py-3 text-left hover:bg-gray-50"
            >
              <span className={`flex-1 text-sm ${monthClosed ? 'font-semibold text-gray-500' : 'font-bold text-blue-600'}`}>
                {monthClosed ? '締めた月' : 'この月を締める'}
              </span>
              <ChevronRight size={16} className="text-gray-400" />
            </button>
          )}
        </BalanceCard>

        <div className="mt-3">
          <SectionCard
            title="変動費"
            dot={SECTION_DOTS.variable}
            chip={variableChip}
            progress={isMonth || variableBudget === 0 ? null : variableActual / variableBudget}
            open={open.variable}
            onToggle={() => toggle('variable')}
          >
            {tiles.length === 0 && (
              <p className="py-6 text-center text-[13px] text-gray-400">「年間予算」で変動費の予算を決めると、ここに予算との差が出ます</p>
            )}
            {tiles.map((tile) => (
              <AmountRow
                key={tile.category.id}
                name={tile.category.name}
                amount={formatYen(tile.actual)}
                right={tile.budget === null ? { text: '予算なし', muted: true } : remainingText(tile.diff)}
                progress={tile.budget ? tile.actual / tile.budget : null}
                onClick={() => setDetail({ type: 'category', category: tile.category })}
              />
            ))}
          </SectionCard>
        </div>

        {reserveRows.length > 0 && (
          <div className="mt-3">
            <SectionCard
              title="予備費"
              dot={SECTION_DOTS.reserve}
              chip={reserveChip}
              progress={isMonth || reserveAmount === 0 ? null : reserveSpent / reserveAmount}
              open={open.reserve}
              onToggle={() => toggle('reserve')}
            >
              {reserveRows.map((row) => (
                <AmountRow
                  key={row.categoryId}
                  name={row.category?.name ?? ''}
                  amount={formatYen(row.period)}
                  faint={row.period === 0}
                  right={remainingText(row.amount - row.spent)}
                  progress={row.amount > 0 ? row.spent / row.amount : row.spent > 0 ? 2 : 0}
                  onClick={() => openTopOf(row.categoryId)}
                />
              ))}
            </SectionCard>
          </div>
        )}

        <div className="mt-3">
          <SectionCard
            title="固定費"
            dot={SECTION_DOTS.fixed}
            chip={fixedChip}
            progress={
              fixedYear === null || fixedYear.confirmed + fixedYear.estimate === 0
                ? null
                : (summary.confirmed + summary.estimate) / (fixedYear.confirmed + fixedYear.estimate)
            }
            open={open.fixed}
            onToggle={() => toggle('fixed')}
          >
            {isMonth && fixedMonth.length === 0 && <p className="py-6 text-center text-[13px] text-gray-400">この月の固定費の記録はありません</p>}
            {fixedMonth.map((entry) => (
              <AmountRow
                key={`${entry.record.id}-${entry.categoryId}`}
                name={categories.find((category) => category.id === entry.categoryId)?.name ?? ''}
                sub={`${Number(entry.record.occurredOn.slice(5, 7))}/${Number(entry.record.occurredOn.slice(8, 10))}・${entry.mode === 'confirmed' ? '確定' : '見込み'}`}
                amount={formatYen(entry.amount)}
                onClick={() => onOpenRecord(entry.record)}
              />
            ))}
            {fixedYear !== null && (
              <>
                <AmountRow name="確定" amount={formatYen(summary.confirmed)} right={{ text: `/ ${formatYen(fixedYear.confirmed)}`, muted: true }} />
                <AmountRow name="見込み" amount={formatYen(summary.estimate)} right={{ text: `/ ${formatYen(fixedYear.estimate)}`, muted: true }} />
                {fixedYear.diffs.map((row) => (
                  <AmountRow
                    key={row.categoryId}
                    name={categoryPath(categories, row.categoryId)}
                    sub={fixedYear.upTo === null ? undefined : `${Number(fixedYear.upTo.slice(5, 7))}月までの予算 ${formatYen(row.budgetToDate)}`}
                    amount={formatYen(row.actual)}
                    right={{ text: `予算より ${signedYen(row.actual - row.budgetToDate)}`, over: row.actual > row.budgetToDate }}
                  />
                ))}
              </>
            )}
          </SectionCard>
        </div>

        {!isMonth && trend.length > 0 && (
          <>
            <SectionHeader compact title="推移" right={<TrendLegend />} />
            <div className={`${cardClass} px-1 py-1`}>
              <YearTrendChart points={trend} initialMonthKey={today} onSelectMonth={onSelectMonth} />
            </div>
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
          feedCount={feedItems.filter((item) => item.occurredOn !== null && item.occurredOn.startsWith(`${closing}-`)).length + undatedCount}
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
