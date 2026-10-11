'use client';

import { useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord } from '@/types/app';
import {
  budgetFor,
  childCategories,
  formatYen,
  frequentCategoryIds,
  iconKeyOf,
  livingSpendByTop,
  topCategories,
} from '@/lib/moneyUtils';
import { CategoryIcon, ScreenHeader, StackedScreen } from './moneyVisual';

// 種類の選択（docs/kakei.md §3.1・§3.2）。mobile版の `mobile/src/components/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 上によく使う小分類。その下に大分類ごとの枠（見出しに今月の残り、中に小分類のチップ）。押すと大分類も決まる。
// 大分類ごとに枠で囲み、見出しに色を付けて、どこからどこまでが同じ大分類かを分かるようにする。
// 特別費も大分類のひとつ（大分類「特別費」。小分類が項目。2026-10-11。docs/kakei.md §0.2）。

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

const chipClass = 'rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50';

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
  const frequent = useMemo(
    () => frequentCategoryIds(records, categories, categoryKind),
    [records, categories, categoryKind],
  );
  const spend = useMemo(() => livingSpendByTop(records, categories, monthKey), [records, categories, monthKey]);
  const pickCategory = (categoryId: string) => onPick({ categoryId });
  const nameOf = (id: string) => categories.find((category) => category.id === id)?.name ?? '';

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader
        title="種類を選ぶ"
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
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {tops.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">種類がまだありません。右上の歯車から種類を作れます</p>
        )}
        {frequent.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-bold text-gray-500">よく使う</p>
            <div className="flex flex-wrap gap-2">
              {frequent.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => pickCategory(id)}
                  className="rounded-full bg-blue-100 px-3 py-1.5 text-[13px] font-semibold text-blue-800 hover:bg-blue-200"
                >
                  {nameOf(id)}
                </button>
              ))}
            </div>
          </section>
        )}

        {tops.map((top) => {
          const children = childCategories(categories, top.id);
          const budget = categoryKind === 'living' ? budgetFor(budgets, top.id, monthKey) : null;
          const remaining = budget === null ? null : budget - (spend.get(top.id) ?? 0);
          return (
            <section key={top.id} className="overflow-hidden rounded-[14px] border border-gray-200">
              <div className="flex items-center gap-2 bg-gray-100 px-3 py-2">
                <CategoryIcon iconKey={iconKeyOf(top)} size={24} />
                <p className="flex-1 text-[15px] font-bold text-gray-900">{top.name}</p>
                {remaining !== null && (
                  <p className={`text-xs font-semibold tabular-nums ${remaining < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                    今月 {remaining < 0 ? `${formatYen(remaining)} 超過` : `残り ${formatYen(remaining)}`}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 p-3">
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
            </section>
          );
        })}

      </div>
    </StackedScreen>
  );
}
