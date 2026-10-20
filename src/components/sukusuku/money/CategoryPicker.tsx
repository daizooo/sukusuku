'use client';

import { useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord } from '@/types/app';
import {
  budgetFor,
  childCategories,
  formatYen,
  iconKeyOf,
  livingSpendByTop,
  topCategories,
} from '@/lib/moneyUtils';
import { CategoryIcon, ScreenHeader, StackedScreen } from './moneyVisual';

// カテゴリの選択（docs/kakei.md §3.1・§3.2）。mobile版の `mobile/src/components/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 大分類を1行ずつ: 左に大分類（アイコン・名前・小さく今月の残り）、
// 右に小分類のボタン（入りきらなければ折り返す）。押すと大分類も決まる。
// スクロールしなくても1画面に収まるように詰める（2026-10-20。以前は大分類ごとの枠と見出しの帯で、縦に長かった）。小分類を主役に、大分類は小さく。
// 大分類の行は与えられた高さいっぱいに縦に伸ばす（下に余白を残さない。grow で中身の高さから伸ばすので、入りきらないときだけスクロールする）。

export interface CategoryChoice {
  categoryId: string;
}

interface CategoryPickerProps {
  kind: 'expense' | 'income';
  monthKey: string;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  records: MoneyRecord[];
  onPick: (choice: CategoryChoice) => void;
  onClose: () => void;
  /** カテゴリ・予算の編集へ。無ければ歯車を出さない（家計の設定の中から開いたとき）。 */
  onEditCategories?: () => void;
}

const chipClass = 'rounded-lg bg-gray-100 px-2.5 py-[7px] text-[15px] font-semibold leading-tight text-gray-900 hover:bg-blue-50 active:bg-blue-50';

export default function CategoryPicker({
  kind,
  monthKey,
  categories,
  budgets,
  records,
  onPick,
  onClose,
  onEditCategories,
}: CategoryPickerProps) {
  const categoryKind = kind === 'income' ? 'income' : 'living';
  const tops = useMemo(() => topCategories(categories, categoryKind), [categories, categoryKind]);
  const spend = useMemo(() => livingSpendByTop(records, categories, monthKey), [records, categories, monthKey]);
  const pickCategory = (categoryId: string) => onPick({ categoryId });

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader
        title="カテゴリを選ぶ"
        icon="back"
        onClose={onClose}
        right={
          onEditCategories && (
            <button type="button" aria-label="カテゴリ・予算を編集" onClick={onEditCategories} className="text-gray-500">
              <Settings2 size={20} />
            </button>
          )
        }
      />
      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto pb-2">
        {tops.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">カテゴリがまだありません。右上の歯車からカテゴリを作れます</p>
        )}
        {tops.map((top) => {
          const children = childCategories(categories, top.id);
          const budget = categoryKind === 'living' ? budgetFor(budgets, top.id, monthKey) : null;
          const remaining = budget === null ? null : budget - (spend.get(top.id) ?? 0);
          return (
            <div key={top.id} className="flex shrink-0 grow items-center border-b border-slate-100 px-2.5 py-2.5">
              <div className="flex w-[104px] shrink-0 items-center gap-1.5">
                <CategoryIcon iconKey={iconKeyOf(top)} size={24} />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[13px] font-bold text-gray-700">{top.name}</p>
                  {remaining !== null && (
                    <p className={`truncate text-[10px] tabular-nums ${remaining < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {remaining < 0 ? `${formatYen(remaining)} 超過` : `残り ${formatYen(remaining)}`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-1 flex-wrap gap-[5px]">
                {(children.length > 0 ? children : [top]).map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    aria-label={`${top.name} ${category.name}`}
                    onClick={() => pickCategory(category.id)}
                    className={chipClass}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </StackedScreen>
  );
}
