'use client';

import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet, SpecialActual, SpecialItem } from '@/types/app';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildSpecialProgress,
  fiscalYearOfMonth,
  formatSignedYen,
  formatYen,
  type BudgetTile,
} from '@/lib/moneyUtils';
import { buildYearRows } from '@/lib/specialUtils';
import { Hero, MonthBar, ProgressBar, SectionHeader, StatRow, UsageRing, cardClass, minus, type } from './moneyVisual';

// 家計タブの「月」（docs/kakei.md §4.1）。mobile版の `mobile/src/components/money/MoneyMonthView.tsx` と同じ並び・文言。
//
// 結論は月の収支（収入 − 生活費 − 貯金）。内訳に収入・生活費（予算との差）・貯金。
// 特別費は月の収支に入れず、1行だけ「今月払った額・年度の予算の残り」を出す（押すと「特別費」へ）。
// その下に生活費の大分類のタイル（使った割合の輪）を予算を超えた順に。
// タイルを押すと開く「要因」・月のメモ・カードの締めは docs/kakei.md §7 の3 で足す。

interface MoneyMonthViewProps {
  monthKey: string;
  onMonth: (monthKey: string) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onEditCategories: () => void;
  onOpenSpecial: () => void;
}

export default function MoneyMonthView({
  monthKey,
  onMonth,
  records,
  categories,
  budgets,
  wallets,
  specialItems,
  specialActuals,
  onEditCategories,
  onOpenSpecial,
}: MoneyMonthViewProps) {
  const summary = useMemo(
    () => buildMonthSummary(records, categories, budgets, wallets, monthKey),
    [records, categories, budgets, wallets, monthKey],
  );
  const tiles = useMemo(() => buildBudgetTiles(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  // 特別費の年度の予算が、この月にどれだけ減ったか（月の収支には入れない）。
  const special = useMemo(
    () =>
      buildSpecialProgress(buildYearRows(specialItems, specialActuals, fiscalYearOfMonth(monthKey), 'expense'), monthKey),
    [specialItems, specialActuals, monthKey],
  );
  const livingDiff = summary.livingBudget - summary.living;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      {/* 右下の「＋」にタイルが隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        <Hero
          label="月の収支"
          value={formatSignedYen(summary.balance)}
          isMinus={summary.balance < 0}
          note={`予算どおりなら ${formatSignedYen(summary.plannedBalance)}`}
        >
          <StatRow label="収入" value={`+${formatYen(summary.income)}`} />
          <StatRow
            label="生活費"
            note={`予算 ${formatYen(summary.livingBudget)}（${livingDiff < 0 ? `${formatYen(livingDiff)} 超過` : `残り ${formatYen(livingDiff)}`}）`}
            noteMinus={livingDiff < 0}
            value={`−${formatYen(summary.living)}`}
          />
          <StatRow
            label="貯金"
            note={summary.savingTarget > 0 ? `目標 ${formatYen(summary.savingTarget)}` : undefined}
            value={`−${formatYen(summary.saving)}`}
          />
        </Hero>

        <button
          type="button"
          aria-label="特別費を見る"
          onClick={onOpenSpecial}
          className={`${cardClass} mt-3 block w-full space-y-2 px-4 py-3 text-left hover:bg-gray-50`}
        >
          <span className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-gray-900">特別費</span>
            <span className={type.faint}>月の収支とは別</span>
            <span className="flex-1" />
            <span className={type.amount}>今月 −{formatYen(special.spentThisMonth)}</span>
            <ChevronRight size={16} className="text-gray-400" />
          </span>
          <ProgressBar
            ratio={special.yearBudget > 0 ? special.spentToDate / special.yearBudget : 0}
            over={special.remaining < 0}
          />
          <span className={`block ${minus(type.faint, special.remaining < 0)}`}>
            年度の予算 {formatYen(special.yearBudget)}・
            {special.remaining < 0 ? `${formatYen(special.remaining)} 超過` : `残り ${formatYen(special.remaining)}`}
          </span>
          {special.pendingThisMonth > 0 && (
            <span className={`block ${minus(type.faint, true)}`}>この月の予定でまだ払っていないもの {special.pendingThisMonth}件</span>
          )}
        </button>

        <SectionHeader
          title="生活費"
          hint="予算を超えた順"
          right={
            <button type="button" onClick={onEditCategories} className={type.link}>
              種類と予算
            </button>
          }
        />
        {tiles.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-gray-400">「種類と予算」で種類と月の予算を決めると、ここに予算との差が出ます</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {tiles.map((tile) => (
              <Tile key={tile.category.id} tile={tile} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ tile }: { tile: BudgetTile }) {
  const over = tile.budget !== null && tile.diff < 0;
  const headline =
    tile.budget === null
      ? '予算なし'
      : tile.diff < 0
        ? formatSignedYen(tile.diff)
        : tile.diff === 0
          ? '予算どおり'
          : `残り ${formatYen(tile.diff)}`;
  const quiet = tile.budget === null || tile.diff === 0;
  // 2列。輪と名前を上に、超えた額・残り額を大きく、実績 / 予算を薄く。
  return (
    <div className={`min-w-0 space-y-1.5 rounded-2xl border p-3 ${over ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2">
        <UsageRing percent={tile.percent} size={40} />
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold text-gray-700">{tile.category.name}</p>
      </div>
      <p
        className={`truncate text-lg font-bold tabular-nums ${over ? 'text-red-600' : quiet ? 'text-gray-400' : 'text-gray-900'}`}
      >
        {headline}
      </p>
      <p className={`truncate ${type.faint}`}>
        {formatYen(tile.actual)}
        {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
      </p>
    </div>
  );
}
