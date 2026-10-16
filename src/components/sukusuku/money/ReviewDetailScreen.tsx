'use client';

import { ChevronRight } from 'lucide-react';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import {
  formatBalance,
  formatYen,
  iconKeyOf,
  type CategoryAnalysis,
} from '@/lib/moneyUtils';
import RecordDayList from './RecordDayList';
import {
  CategoryIcon,
  FullScreen,
  Hero,
  ProgressBar,
  ScreenHeader,
  SectionHeader,
  StatRow,
  cardClass,
  type,
} from './moneyVisual';

// 振り返りの内訳をタップしたときの画面（docs/kakei.md §4.4）。mobile版の `mobile/src/components/money/ReviewDetailScreen.tsx` と同じ並び・文言。
// 上に**振り返りの画面と同じ作りの収支**（予算 − 支出を大きく、予算と支出を下に。年は年末の着地見込みを一番下に）、次に小分類の割合、下にその行に絞った記録の一覧
// （2026-10-16。「分析」の欄・注釈は無くした。年の詳細には記録の一覧を出さない）。
// 年のときは、小分類のあとに**締めた月の実績**（月の予算と並べる）を出す。月の行を押すと、その月のカテゴリの詳細が開く。
// 記録を押すと、この画面を閉じて記録の詳細を開く。

export type ReviewDetail = { type: 'category'; category: MoneyCategory };

interface ReviewDetailScreenProps {
  detail: ReviewDetail;
  /** 「9月」「2026年」。 */
  periodLabel: string;
  /** 大分類の分析（期間の予算・実績・小分類ごと・記録）。 */
  analysis: CategoryAnalysis | null;
  /** 年のとき、締めた月ごとの実績と月の予算（新しい月から）。月のときは null。 */
  closedMonths: { monthKey: string; amount: number; budget: number | null }[] | null;
  /** 年のとき、年末の着地見込み（締めた月は実績、ほかの月は月の予算）。月のときは null。 */
  landing: number | null;
  /** 締めた月の行を押したとき、その月のカテゴリの詳細を開く。 */
  onOpenMonth: (monthKey: string) => void;
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  onClose: () => void;
  onOpenRecord: (record: MoneyRecord) => void;
}

const percentOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

export default function ReviewDetailScreen({
  detail,
  periodLabel,
  analysis,
  closedMonths,
  landing,
  onOpenMonth,
  categories,
  wallets,
  onClose,
  onOpenRecord,
}: ReviewDetailScreenProps) {
  const title = detail.category.name;
  const records = analysis?.records ?? [];

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader
        title={`${title}（${periodLabel}）`}
        icon="back"
        onClose={onClose}
        right={<CategoryIcon iconKey={iconKeyOf(detail.category)} size={28} />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {analysis !== null && <SummaryHero analysis={analysis} landing={landing} />}
        {analysis !== null && <ChildrenSection analysis={analysis} />}
        {closedMonths !== null && <ClosedMonths rows={closedMonths} onOpenMonth={onOpenMonth} />}

        {/* 年の詳細には記録の一覧は出さない（締めた月の行からその月へ飛んで見る。2026-10-16） */}
        {closedMonths === null && (
          <>
          <SectionHeader title="記録" hint={`${records.length}件`} />
          {records.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-gray-400">この期間の記録はありません</p>
          ) : (
            <RecordDayList
              records={records}
              categories={categories}
              wallets={wallets}
              onOpen={onOpenRecord}
            />
          )}
          </>
        )}
      </div>
    </FullScreen>
  );
}

/** 小分類ごとの割合（多い順の帯）。 */
function ChildrenSection({ analysis }: { analysis: CategoryAnalysis }) {
  const childTotal = analysis.children.reduce((sum, child) => sum + child.amount, 0);
  if (analysis.children.length === 0) return null;
  return (
    <>
      <SectionHeader title="小分類" />
      <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
        {analysis.children.map((child) => (
          <div key={child.id} className="space-y-1.5 px-3.5 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className={`min-w-0 flex-1 truncate ${type.row}`}>{child.name}</span>
              <span className={type.faint}>{percentOf(child.amount, childTotal)}%</span>
              <span className={type.amount}>{formatYen(child.amount)}</span>
            </div>
            <ProgressBar ratio={childTotal > 0 ? child.amount / childTotal : 0} />
          </div>
        ))}
      </div>
    </>
  );
}

/** 上の収支。振り返りの画面と同じ作りで、収支＝予算 − 支出（予算が無ければ支出だけ）。 */
function SummaryHero({ analysis, landing }: { analysis: CategoryAnalysis; landing: number | null }) {
  const hasBudget = analysis.budget !== null;
  const over = hasBudget && analysis.diff < 0;
  return (
    <Hero
      compact
      label="収支"
      value={formatBalance(analysis.diff)}
      plus={hasBudget && analysis.diff > 0}
    >
      <StatRow compact label="予算" value={hasBudget ? formatYen(analysis.budget ?? 0) : '−'} />
      <StatRow compact label="支出" value={`−${formatYen(analysis.actual)}`} />
      {landing !== null && <StatRow compact label="年末の着地見込み" value={formatYen(landing)} />}
      {hasBudget && (
        <div className="pt-2">
          <ProgressBar ratio={(analysis.budget ?? 0) > 0 ? analysis.actual / (analysis.budget ?? 1) : 0} over={over} />
        </div>
      )}
    </Hero>
  );
}

/** 年のとき、締めた月ごとの実績。押すとその月のカテゴリの詳細。 */
function ClosedMonths({
  rows,
  onOpenMonth,
}: {
  rows: { monthKey: string; amount: number; budget: number | null }[];
  onOpenMonth: (monthKey: string) => void;
}) {
  return (
    <>
      <SectionHeader title="締めた月" />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-gray-400">締めた月はまだありません</p>
      ) : (
        <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
          {rows.map((row) => {
            const over = row.budget !== null && row.amount > row.budget;
            return (
              <button
                key={row.monthKey}
                type="button"
                aria-label={`${Number(row.monthKey.slice(5, 7))}月の内訳を見る`}
                onClick={() => onOpenMonth(row.monthKey)}
                className="block w-full space-y-1.5 px-3.5 py-2.5 text-left hover:bg-gray-50"
              >
                <div className="flex items-baseline gap-2">
                  <span className={`min-w-0 flex-1 ${type.row}`}>{Number(row.monthKey.slice(5, 7))}月</span>
                  <span className={type.faint}>{row.budget !== null ? `予算 ${formatYen(row.budget)}` : '予算なし'}</span>
                  <span className={type.amount}>{formatYen(row.amount)}</span>
                  <ChevronRight size={16} className="self-center text-gray-400" />
                </div>
                <ProgressBar ratio={row.budget ? row.amount / row.budget : 0} over={over} />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
