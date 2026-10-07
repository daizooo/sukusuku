'use client';

import { useMemo } from 'react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import {
  buildBudgetTiles,
  buildMonthSummary,
  formatSignedYen,
  formatYen,
  iconKeyOf,
  type BudgetTile,
} from '@/lib/moneyUtils';
import { CategoryIcon, Hero, MonthBar, ProgressBar, SectionHeader, StatRow, cardClass, type } from './moneyVisual';

// 家計タブの「月」（docs/kakei.md §4.1）。mobile版の `mobile/src/components/money/MoneyMonthView.tsx` と同じ並び・文言。
//
// 結論は月の収支（収入 − 生活費 − 貯金）。内訳に収入・生活費（予算との差）・貯金。
// 特別費はここに出さない（「特別費」の面だけで見る。2026-10-07に決定）。
// その下に生活費の大分類を小さな一覧で（アイコン・超えた額／残り額・使った割合の帯）、予算を超えた順に。
// 行を押すと開く「要因」・月のメモ・カードの締めは docs/kakei.md §7 の3 で足す。

interface MoneyMonthViewProps {
  monthKey: string;
  onMonth: (monthKey: string) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  onEditCategories: () => void;
}

export default function MoneyMonthView({
  monthKey,
  onMonth,
  records,
  categories,
  budgets,
  wallets,
  onEditCategories,
}: MoneyMonthViewProps) {
  const summary = useMemo(
    () => buildMonthSummary(records, categories, budgets, wallets, monthKey),
    [records, categories, budgets, wallets, monthKey],
  );
  const tiles = useMemo(() => buildBudgetTiles(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  const livingDiff = summary.livingBudget - summary.living;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      {/* 右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
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
          <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
            {tiles.map((tile) => (
              <CategoryRow key={tile.category.id} tile={tile} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・超えた額／残り額、使った割合の帯、実績 / 予算。 */
function CategoryRow({ tile }: { tile: BudgetTile }) {
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
    <div className="flex items-center gap-3 px-3.5 py-2.5">
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
    </div>
  );
}
