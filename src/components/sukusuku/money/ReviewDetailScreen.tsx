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

export type ReviewDetail = { type: 'category'; category: MoneyCategory };

interface ReviewDetailScreenProps {
  detail: ReviewDetail;
  /** 「9月」「2026年」。 */
  periodLabel: string;
  isMonth: boolean;
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
  isMonth,
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
        {analysis !== null && <CategoryBody analysis={analysis} isMonth={isMonth} periodLabel={periodLabel} />}

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

function CategoryBody({
  analysis,
  isMonth,
  periodLabel,
}: {
  analysis: CategoryAnalysis;
  isMonth: boolean;
  periodLabel: string;
}) {
  const over = analysis.budget !== null && analysis.diff < 0;
  const change = analysis.previous === null ? null : analysis.actual - analysis.previous;
  const count = analysis.records.length;
  const peak = analysis.months.reduce<{ monthKey: string; amount: number } | null>(
    (best, entry) => (entry.amount > 0 && (best === null || entry.amount > best.amount) ? entry : best),
    null,
  );
  const activeMonths = analysis.months.filter((entry) => entry.amount > 0).length;
  const childTotal = analysis.children.reduce((sum, child) => sum + child.amount, 0);
  const label = isMonth ? '先月' : '前年の同じ月';

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
        {!isMonth && activeMonths > 0 && (
          <StatRow label="月の平均" note={`記録のある${activeMonths}か月`} value={formatYen(Math.round(analysis.actual / activeMonths))} />
        )}
        {!isMonth && peak !== null && (
          <StatRow label="いちばん多い月" value={`${Number(peak.monthKey.slice(5, 7))}月 ${formatYen(peak.amount)}`} />
        )}
      </div>

      {analysis.children.length > 0 && (
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
      )}
    </>
  );
}
