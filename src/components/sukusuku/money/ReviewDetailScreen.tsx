'use client';

import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import {
  formatSignedYen,
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
// 上に結論（実績と予算）、簡単な分析（前の期間との比べ・小分類ごとの割合・月ごと）、下にその行に絞った記録の一覧。
// 記録を押すと、この画面を閉じて記録の詳細を開く。
// 年の分析（analysis.yearly があるとき）は、月の分析の流用ではなく年の基準で出す（2026-10-15）: 年の予算（使い始めた月から12月まで）に対する実績と残り・
// 今月までの予算との差・年末の着地見込み・月平均（月の予算と並べる）・前年の同じ期間との比べ、月ごとの実績と月の予算。

export type ReviewDetail = { type: 'category'; category: MoneyCategory };

interface ReviewDetailScreenProps {
  detail: ReviewDetail;
  /** 「9月」「2026年」。 */
  periodLabel: string;
  /** 大分類の分析。 */
  analysis: CategoryAnalysis | null;
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
        {analysis !== null &&
          (analysis.yearly ? (
            <YearBody analysis={analysis} periodLabel={periodLabel} />
          ) : (
            <MonthBody analysis={analysis} periodLabel={periodLabel} />
          ))}

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
      <SectionHeader title="小分類ごと" />
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

/** 年の分析。 */
function YearBody({ analysis, periodLabel }: { analysis: CategoryAnalysis; periodLabel: string }) {
  const yearly = analysis.yearly;
  if (!yearly) return null;
  const over = analysis.budget !== null && analysis.diff < 0;
  const count = analysis.records.length;
  const peak = analysis.months.reduce<{ monthKey: string; amount: number } | null>(
    (best, entry) => (entry.amount > 0 && (best === null || entry.amount > best.amount) ? entry : best),
    null,
  );
  const paceDiff = yearly.elapsedBudget === null ? null : yearly.elapsedActual - yearly.elapsedBudget;
  const landingDiff = analysis.budget === null ? null : yearly.forecast - analysis.budget;
  const compared = analysis.previous === null ? null : yearly.comparedActual - analysis.previous;

  return (
    <>
      <Hero
        label={`${periodLabel}に使った額`}
        value={formatYen(analysis.actual)}
        isMinus={over}
        note={
          analysis.budget === null
            ? '年の予算なし'
            : over
              ? `年の予算 ${formatYen(analysis.budget)}（${yearly.activeMonths}か月ぶん）・${formatYen(analysis.diff)} 超過`
              : `年の予算 ${formatYen(analysis.budget)}（${yearly.activeMonths}か月ぶん）・残り ${formatYen(analysis.diff)}`
        }
      >
        {analysis.budget !== null && (
          <div className="pt-2">
            <ProgressBar ratio={analysis.budget > 0 ? analysis.actual / analysis.budget : 0} over={over} />
          </div>
        )}
      </Hero>

      <SectionHeader title="分析" />
      <div className={`${cardClass} px-3.5 py-1`}>
        {paceDiff !== null && yearly.elapsedMonths > 0 && (
          <StatRow
            label="今月までの予算より"
            note={`今月までの予算 ${formatYen(yearly.elapsedBudget ?? 0)}（${yearly.elapsedMonths}か月ぶん）`}
            value={formatSignedYen(paceDiff)}
            isMinus={paceDiff > 0}
          />
        )}
        <StatRow
          label="年末の着地見込み"
          note={
            landingDiff === null
              ? '先の月は月平均で見込み'
              : landingDiff > 0
                ? `年の予算を ${formatYen(landingDiff)} 超える見込み`
                : `年の予算まで ${formatYen(-landingDiff)} の余裕`
          }
          value={formatYen(yearly.forecast)}
          isMinus={landingDiff !== null && landingDiff > 0}
        />
        {yearly.average !== null && (
          <StatRow
            label="月平均"
            note={`実績のある${yearly.averageMonths}か月${yearly.monthlyBudget !== null ? `・月の予算 ${formatYen(yearly.monthlyBudget)}` : ''}`}
            value={formatYen(yearly.average)}
          />
        )}
        {compared !== null && analysis.previous !== null && (
          <StatRow
            label="前年の同じ期間より"
            note={`前年 ${formatYen(analysis.previous)}（${yearly.comparedMonths}か月ぶん）`}
            value={formatSignedYen(compared)}
            isMinus={compared > 0}
          />
        )}
        <StatRow
          label="記録"
          note={count > 0 ? `1件あたり ${formatYen(Math.round(analysis.actual / count))}` : undefined}
          value={`${count}件`}
        />
        {peak !== null && <StatRow label="いちばん多い月" value={`${Number(peak.monthKey.slice(5, 7))}月 ${formatYen(peak.amount)}`} />}
      </div>

      <SectionHeader title="月ごと" hint="実績 / 月の予算" />
      <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
        {analysis.months.map((entry) => {
          const monthBudget = entry.budget ?? null;
          const monthOver = monthBudget !== null && entry.amount > monthBudget;
          return (
            <div key={entry.monthKey} className="space-y-1.5 px-3.5 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className={`min-w-0 flex-1 ${type.row}`}>{Number(entry.monthKey.slice(5, 7))}月</span>
                <span className={type.faint}>{monthBudget !== null ? `予算 ${formatYen(monthBudget)}` : '予算なし'}</span>
                <span className={type.amount}>{formatYen(entry.amount)}</span>
              </div>
              <ProgressBar ratio={monthBudget ? entry.amount / monthBudget : 0} over={monthOver} />
            </div>
          );
        })}
      </div>

      <ChildrenSection analysis={analysis} />
    </>
  );
}

/** 月の分析（先月と比べる）。 */
function MonthBody({ analysis, periodLabel }: { analysis: CategoryAnalysis; periodLabel: string }) {
  const over = analysis.budget !== null && analysis.diff < 0;
  const change = analysis.previous === null ? null : analysis.actual - analysis.previous;
  const count = analysis.records.length;
  const label = '先月';

  return (
    <>
      <Hero
        label={`${periodLabel}に使った額`}
        value={formatYen(analysis.actual)}
        isMinus={over}
        note={
          analysis.budget === null
            ? '予算なし'
            : over
              ? `予算 ${formatYen(analysis.budget)}・${formatYen(analysis.diff)} 超過`
              : `予算 ${formatYen(analysis.budget)}・残り ${formatYen(analysis.diff)}`
        }
      >
        {analysis.budget !== null && (
          <div className="pt-2">
            <ProgressBar ratio={analysis.budget > 0 ? analysis.actual / analysis.budget : 0} over={over} />
          </div>
        )}
      </Hero>

      <SectionHeader title="分析" />
      <div className={`${cardClass} px-3.5 py-1`}>
        {change !== null && (
          <StatRow
            label={`${label}より`}
            note={`${label} ${formatYen(analysis.previous ?? 0)}`}
            value={formatSignedYen(change)}
            isMinus={change > 0}
          />
        )}
        <StatRow
          label="記録"
          note={count > 0 ? `1件あたり ${formatYen(Math.round(analysis.actual / count))}` : undefined}
          value={`${count}件`}
        />
      </div>

      <ChildrenSection analysis={analysis} />
    </>
  );
}
