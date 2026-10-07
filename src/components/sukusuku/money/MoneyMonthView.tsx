'use client';

import { useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet, SpecialActual, SpecialItem } from '@/types/app';
import {
  buildBudgetTiles,
  buildMonthSummary,
  fiscalYearOfMonth,
  formatSignedYen,
  formatYen,
  type BudgetTile,
} from '@/lib/moneyUtils';
import { buildYearRows } from '@/lib/specialUtils';
import { MonthBar, UsageRing } from './moneyVisual';

// 家計タブの「月」（docs/kakei.md §4.1）。mobile版の `mobile/src/components/money/MoneyMonthView.tsx` と同じ並び・文言。
//
// 上に結論（月の収支＝収入 − 生活費 − 貯金。特別費は別枠）、その下に生活費の大分類のタイル（使った割合の輪）を
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
  const special = useMemo(() => {
    const month = Number(monthKey.slice(5, 7));
    const rows = buildYearRows(specialItems, specialActuals, fiscalYearOfMonth(monthKey), 'expense').filter(
      (row) => row.month === month,
    );
    return {
      planned: rows.reduce((sum, row) => sum + row.budget, 0),
      pending: rows.filter((row) => row.planId !== null && row.actual === null).length,
    };
  }, [specialItems, specialActuals, monthKey]);
  const livingDiff = summary.livingBudget - summary.living;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-6">
        <div className="space-y-1.5 rounded-2xl border border-gray-200 bg-white p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex-1 text-xs text-gray-500">月の収支（収入 − 生活費 − 貯金）</span>
            <span className={`text-[26px] font-bold tabular-nums ${summary.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {formatSignedYen(summary.balance)}
            </span>
          </div>
          <div className="flex justify-between gap-2 text-xs text-gray-500 tabular-nums">
            <span>予算どおりなら {formatSignedYen(summary.plannedBalance)}</span>
            <span className={livingDiff < 0 ? 'text-red-600' : ''}>
              生活費 {formatSignedYen(livingDiff)}（{livingDiff < 0 ? '予算超え' : '予算内'}）
            </span>
          </div>
          {(summary.saving > 0 || summary.savingTarget > 0) && (
            <div className="flex justify-between gap-2 text-xs text-gray-500 tabular-nums">
              <span>貯金</span>
              <span>
                {formatYen(summary.saving)}
                {summary.savingTarget > 0 ? ` / 目標 ${formatYen(summary.savingTarget)}` : ''}
              </span>
            </div>
          )}
          <div className="mt-1 flex justify-between gap-2 border-t border-gray-200 pt-2 text-xs text-gray-500 tabular-nums">
            <span>特別費（別枠）</span>
            <span>
              済 <b className="text-gray-900">{formatYen(summary.special)}</b> / 予定 {formatYen(special.planned)}
              {special.pending > 0 && <span className="text-red-600">　まだ{special.pending}件</span>}
            </span>
          </div>
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
