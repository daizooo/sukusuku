'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet, SpecialActual, SpecialItem } from '@/types/app';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildCategoryAnalysis,
  buildSpecialAnalysis,
  buildYearSummary,
  estimatesInMonth,
  formatSignedYen,
  formatYen,
  iconKeyOf,
  monthKeyOfDate,
  recordTotal,
  shiftMonth,
  yearMonthKeys,
  yearOfMonth,
  type BudgetTile,
  type SpecialAnalysis,
} from '@/lib/moneyUtils';
import { buildYearRows, formatYear } from '@/lib/specialUtils';
import {
  CategoryIcon,
  EstimateBadge,
  Hero,
  PeriodBar,
  ProgressBar,
  SectionHeader,
  StatRow,
  cardClass,
  minus,
  type,
  type ReviewPeriod,
} from './moneyVisual';
import ReviewDetailScreen, { type ReviewDetail } from './ReviewDetailScreen';

// 家計タブの「振り返り」（docs/kakei.md §4）。mobile版の `mobile/src/components/money/MoneyReviewView.tsx` と同じ並び・文言。
//
// 月と年は同じ面。上の送りの右「月 / 年」で期間を切り替える（2026-10-08に、別々の面から1つにした）。
// 年は暦年（1月〜12月。2026-10-09に年度から変えた。生活費の予算の月額だけは今までどおり年度ごと）。
// 結論は生活費の収支（特別費は入れない）＝収入 − 生活費（特別費以外の支出。種類の名前が「その他」でも生活費）。
// 貯金は記録なので式にも表示にも入れない。
// その下の「内訳」は、月なら生活費の大分類の一覧（種類の並び順）の最後に特別費の1行、年なら特別費の1行。
// 特別費の行はその期間に払った額と年の予算の残り（月ならその月までの累計）だけ（2026-10-08に、生活費と同じ大きさの
// 結論から内訳の1行にした）。特別費の予定は「家計の設定」で編集する（2026-10-09）。
// 内訳の行（生活費の大分類・特別費）を押すと、簡単な分析と、その行に絞った記録の一覧が開く（ReviewDetailScreen。§4.4）。
// 年は内訳の下に月ごとの収支（押すとその月へ）。
// 見込みの額（毎月の記録で自動で作り、まだ確かめていない額）は実績に入れて数え、件数と額を添えて出す（§3.3・§4.1）。

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
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  /** 年の「月ごと」の行を押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  onEditCategories: () => void;
  /** 内訳の詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
  onOpenRecord: (record: MoneyRecord) => void;
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
  specialItems,
  specialActuals,
  onSelectMonth,
  onEditCategories,
  onOpenRecord,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const viewYear = isMonth ? yearOfMonth(monthKey) : year;
  const [detail, setDetail] = useState<ReviewDetail | null>(null);

  const month = useMemo(
    () => buildMonthSummary(records, categories, budgets, monthKey),
    [records, categories, budgets, monthKey],
  );
  const yearSummary = useMemo(
    () => buildYearSummary(records, categories, budgets, year, today),
    [records, categories, budgets, year, today],
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
  const specialRows = useMemo(
    () => buildYearRows(specialItems, specialActuals, viewYear, 'expense'),
    [specialItems, specialActuals, viewYear],
  );
  const special = useMemo(
    () => buildSpecialAnalysis(records, specialRows, viewYear, isMonth ? monthKey : null),
    [records, specialRows, viewYear, isMonth, monthKey],
  );

  const income = isMonth ? month.income : yearSummary.total.income;
  const living = isMonth ? month.living : yearSummary.total.living;
  const balance = isMonth ? month.balance : yearSummary.total.balance;
  const livingDiff = isMonth ? month.livingBudget - month.living : yearSummary.total.livingDiff;
  const planned = isMonth ? month.plannedBalance : null;
  const estimates = useMemo(() => {
    const keys = isMonth ? [monthKey] : yearMonthKeys(year).filter((key) => key <= today);
    const list = keys.flatMap((key) => estimatesInMonth(records, key));
    return { count: list.length, amount: list.reduce((sum, record) => sum + recordTotal(record), 0) };
  }, [isMonth, monthKey, year, today, records]);
  const months = yearSummary.months.filter((row) => row.monthKey <= today && (row.recorded || row.special > 0)).reverse();

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
        <Hero
          label={isMonth ? '生活費の収支' : '生活費の収支（年）'}
          value={formatSignedYen(balance)}
          isMinus={balance < 0}
          note={
            planned !== null
              ? `収入 − 特別費以外の支出・予算どおりなら ${formatSignedYen(planned)}`
              : `収入 − 特別費以外の支出・記録のある${yearSummary.recordedMonths}か月ぶん`
          }
        >
          <StatRow label="収入" note="給与・臨時収入など" value={`+${formatYen(income)}`} />
          <StatRow
            label="生活費"
            note={
              isMonth
                ? `予算 ${formatYen(month.livingBudget)}（${livingDiff < 0 ? `${formatYen(livingDiff)} 超過` : `残り ${formatYen(livingDiff)}`}）`
                : livingDiff < 0
                  ? `予算より ${formatYen(livingDiff)} 多い`
                  : `予算より ${formatYen(livingDiff)} 少ない`
            }
            noteMinus={livingDiff < 0}
            value={`−${formatYen(living)}`}
          />
          {estimates.count > 0 && (
            <div className="flex items-center gap-2 pt-2">
              <EstimateBadge />
              <span className={`flex-1 ${type.faint}`}>
                見込みの額 {estimates.count}件（{formatYen(estimates.amount)}）を含みます。額を確かめて直すと確定します
              </span>
            </div>
          )}
        </Hero>


        {isMonth ? (
          <>
            <SectionHeader
              title="内訳"
              hint="押すと分析と記録"
              right={
                <button type="button" onClick={onEditCategories} className={type.link}>
                  カテゴリと予算
                </button>
              }
            />
            {tiles.length === 0 && (
              <p className="py-6 text-center text-[13px] text-gray-400">「カテゴリと予算」で種類と月の予算を決めると、ここに予算との差が出ます</p>
            )}
            <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
              {tiles.map((tile) => (
                <CategoryRow
                  key={tile.category.id}
                  tile={tile}
                  onClick={() => setDetail({ type: 'category', category: tile.category })}
                />
              ))}
              <SpecialRow special={special} isMonth onClick={() => setDetail({ type: 'special' })} />
            </div>
          </>
        ) : (
          <>
            <SectionHeader
              title="内訳"
              hint="押すと分析と記録"
              right={
                <button type="button" onClick={onEditCategories} className={type.link}>
                  カテゴリと予算
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
              <SpecialRow special={special} isMonth={false} onClick={() => setDetail({ type: 'special' })} />
            </div>
            <SectionHeader title="月ごと" hint="押すとその月へ" />
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
                      className={`flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-gray-50 ${
                        index > 0 ? 'border-t border-gray-200' : ''
                      }`}
                    >
                      <span className="w-10 text-[15px] font-bold text-gray-900 tabular-nums">{number}月</span>
                      <span className="min-w-0 flex-1">
                        {row.recorded ? (
                          <>
                            <span className={`block ${type.faint}`}>収入 {formatYen(row.income)}</span>
                            <span className={`block ${minus(type.faint, row.livingDiff < 0)}`}>
                              生活費 {formatYen(row.living)}
                              {row.livingDiff < 0 ? '（予算超え）' : ''}
                            </span>
                          </>
                        ) : (
                          <span className={`block ${type.faint}`}>生活費の記録なし</span>
                        )}
                        {row.special > 0 && <span className={`block ${type.faint}`}>特別費 {formatYen(row.special)}</span>}
                      </span>
                      {estimatesInMonth(records, row.monthKey).length > 0 && <EstimateBadge />}
                      {row.recorded && <span className={minus(type.amount, row.balance < 0)}>{formatSignedYen(row.balance)}</span>}
                      <ChevronRight size={16} className="text-gray-400" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {detail !== null && (
        <ReviewDetailScreen
          detail={detail}
          periodLabel={periodLabel}
          isMonth={isMonth}
          analysis={analysis}
          special={special}
          year={viewYear}
          categories={categories}
          wallets={wallets}
          specialItems={specialItems}
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

/** 内訳の特別費の1行。その期間に払った額と、年の予算の残り。押すと分析と記録。 */
function SpecialRow({ special, isMonth, onClick }: { special: SpecialAnalysis; isMonth: boolean; onClick: () => void }) {
  const over = special.remaining < 0;
  return (
    <button
      type="button"
      aria-label="特別費の分析と記録を見る"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50"
    >
      <CategoryIcon iconKey="star" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">特別費</span>
          <span className={`text-sm font-bold tabular-nums ${special.spent === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
            {isMonth ? 'この月' : '年'} {formatYen(special.spent)}
          </span>
        </div>
        {special.yearBudget > 0 && <ProgressBar ratio={special.spentToDate / special.yearBudget} over={over} />}
        <p className={minus(type.faint, over)}>
          {special.yearBudget > 0
            ? `年 ${formatYen(special.spentToDate)} / ${formatYen(special.yearBudget)}・${over ? `${formatYen(special.remaining)} 超過` : `残り ${formatYen(special.remaining)}`}`
            : '「家計の設定」の「特別費の予定」で予定を決めると、予算の残りが出ます'}
        </p>
      </div>
      <ChevronRight size={16} className="text-gray-400" />
    </button>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・超えた額／残り額、使った割合の帯、実績 / 予算。 */
function CategoryRow({ tile, onClick }: { tile: BudgetTile; onClick: () => void }) {
  const over = tile.budget !== null && tile.diff < 0;
  const quiet = tile.budget === null || tile.diff === 0;
  const headline =
    tile.budget === null
      ? '予算なし'
      : tile.diff < 0
        ? `${formatYen(tile.diff)} 超過`
        : tile.diff === 0
          ? '予算どおり'
          : `残り ${formatYen(tile.diff)}`;
  return (
    <button
      type="button"
      aria-label={`${tile.category.name}の分析と記録を見る`}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50"
    >
      <CategoryIcon iconKey={iconKeyOf(tile.category)} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{tile.category.name}</span>
          <span className={`text-sm font-bold tabular-nums ${over ? 'text-red-600' : quiet ? 'text-gray-400' : 'text-gray-900'}`}>
            {headline}
          </span>
        </div>
        <ProgressBar ratio={tile.budget ? tile.actual / tile.budget : 0} over={over} />
        <p className={type.faint}>
          {formatYen(tile.actual)}
          {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
          {tile.percent !== null ? `・${tile.percent}%` : ''}
        </p>
      </div>
      <ChevronRight size={16} className="text-gray-400" />
    </button>
  );
}
