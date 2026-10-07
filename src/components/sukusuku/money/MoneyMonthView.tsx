'use client';

import { useMemo } from 'react';
import { Settings2 } from 'lucide-react';
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
import { buildYearRows, formatFiscalYear } from '@/lib/specialUtils';
import { MonthBar, UsageRing } from './moneyVisual';

// 家計タブの「月」（docs/kakei.md §4.1）。mobile版の `mobile/src/components/money/MoneyMonthView.tsx` と同じ並び・文言。
//
// 上に結論（月の収支＝収入 − 生活費 − 貯金）。特別費は月の収支に入れず、その下に別枠で
// 「この月に特別費の年度の予算がどれだけ減ったか・残り」を出す。その下に生活費の大分類のタイル（使った割合の輪）を
// 予算を超えた順に。タイルを押すと開く「要因」・月のメモ・カードの締めは docs/kakei.md §7 の3 で足す。

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
}: MoneyMonthViewProps) {
  const summary = useMemo(
    () => buildMonthSummary(records, categories, budgets, wallets, monthKey),
    [records, categories, budgets, wallets, monthKey],
  );
  const tiles = useMemo(() => buildBudgetTiles(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  // その月の特別費の予定（済・まだ）。
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
        <div className="space-y-1.5 rounded-2xl border border-gray-200 bg-white p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex-1 text-xs text-gray-500">月の収支（収入 − 生活費 − 貯金）</span>
            <span className={`text-[26px] font-bold tabular-nums ${summary.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {formatSignedYen(summary.balance)}
            </span>
          </div>
          <div className="flex justify-between gap-2 text-[13px] tabular-nums">
            <span className="text-gray-700">収入</span>
            <span className="font-semibold text-gray-900">{formatYen(summary.income)}</span>
          </div>
          <div className="flex justify-between gap-2 text-[13px] tabular-nums">
            <span className="text-gray-700">
              生活費
              <span className={`text-[11px] ${livingDiff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                　予算 {formatYen(summary.livingBudget)}・差 {formatSignedYen(livingDiff)}
              </span>
            </span>
            <span className="font-semibold text-gray-900">−{formatYen(summary.living)}</span>
          </div>
          <div className="flex justify-between gap-2 text-[13px] tabular-nums">
            <span className="text-gray-700">
              貯金
              {summary.savingTarget > 0 && <span className="text-[11px] text-gray-400">　目標 {formatYen(summary.savingTarget)}</span>}
            </span>
            <span className="font-semibold text-gray-900">−{formatYen(summary.saving)}</span>
          </div>
          <p className="text-[11px] text-gray-400 tabular-nums">予算どおりなら {formatSignedYen(summary.plannedBalance)}</p>
        </div>

        <div className="mt-2.5 space-y-1.5 rounded-2xl border border-gray-200 bg-white p-3.5 tabular-nums">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-bold text-gray-900">特別費（月の収支とは別）</span>
            <span className="text-[13px] font-semibold text-gray-900">今月 −{formatYen(special.spentThisMonth)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-1.5 rounded-full ${special.remaining < 0 ? 'bg-red-300' : 'bg-blue-600'}`}
              style={{ width: `${special.yearBudget > 0 ? Math.min(100, (special.spentToDate / special.yearBudget) * 100) : 0}%` }}
            />
          </div>
          <div className="flex justify-between gap-2 text-[11px] text-gray-400">
            <span>
              {formatFiscalYear(fiscalYearOfMonth(monthKey))}の予算 {formatYen(special.yearBudget)}
            </span>
            <span className={special.remaining < 0 ? 'text-red-600' : ''}>
              {special.remaining < 0 ? `${formatYen(special.remaining)} 超過` : `残り ${formatYen(special.remaining)}`}
            </span>
          </div>
          {special.pendingThisMonth > 0 && (
            <p className="text-[11px] text-red-600">この月の予定でまだ払っていないもの {special.pendingThisMonth}件</p>
          )}
        </div>

        <div className="mt-4 mb-2 flex items-baseline gap-1.5">
          <h3 className="text-[17px] font-bold text-gray-900">生活費</h3>
          <span className="text-xs text-gray-400">超えた順</span>
          <span className="flex-1" />
          <button type="button" onClick={onEditCategories} className="flex items-center gap-1 text-xs font-bold text-blue-600">
            <Settings2 size={14} />
            種類と予算
          </button>
        </div>
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
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border bg-white p-2.5 ${over ? 'border-red-200' : 'border-gray-200'}`}>
      <UsageRing percent={tile.percent} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{tile.category.name}</p>
        <p
          className={`truncate text-base font-bold tabular-nums ${
            over ? 'text-red-600' : tile.budget === null || tile.diff === 0 ? 'text-gray-400' : 'text-gray-900'
          }`}
        >
          {headline}
          {over && <span className="text-[11px] font-medium text-gray-400"> 超過</span>}
        </p>
        <p className="truncate text-[11px] text-gray-400 tabular-nums">
          {formatYen(tile.actual)}
          {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
        </p>
      </div>
    </div>
  );
}
