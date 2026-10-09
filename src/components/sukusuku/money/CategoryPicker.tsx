'use client';

import { useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, SpecialActual, SpecialItem, SpecialKind } from '@/types/app';
import {
  budgetFor,
  childCategories,
  yearOfMonth,
  formatYen,
  frequentCategoryIds,
  iconKeyOf,
  livingSpendByTop,
  topCategories,
} from '@/lib/moneyUtils';
import { appliesInYear, buildYearRows, formatYear } from '@/lib/specialUtils';
import { CategoryIcon, ScreenHeader, StackedScreen } from './moneyVisual';

// 種類の選択（docs/kakei.md §3.1・§3.2）。mobile版の `mobile/src/components/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 上によく使う小分類。その下に大分類ごとの枠（見出しに今月の残り、中に小分類のチップ）。押すと大分類も決まる。
// 大分類ごとに枠で囲み、見出しに色を付けて、どこからどこまでが同じ大分類かを分かるようにする。
// 支出なら最後に特別費: その年の予定（まだ済でないものを上に。選ぶと予算の額が入る）と、予定外の項目。
// 収入なら収入の種類と、特別収入。

export interface CategoryChoice {
  categoryId: string | null;
  specialItemId: string | null;
  specialPlanId: string | null;
  /** 特別費の予定を選んだときの予算の額。 */
  amount: number | null;
}

interface CategoryPickerProps {
  kind: SpecialKind;
  monthKey: string;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  records: MoneyRecord[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onPick: (choice: CategoryChoice) => void;
  onClose: () => void;
  /** カテゴリと予算の編集へ。無ければ歯車を出さない（家計の設定の中から開いたとき）。 */
  onEditCategories?: () => void;
}

const chipClass = 'rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50';

export default function CategoryPicker({
  kind,
  monthKey,
  categories,
  budgets,
  records,
  specialItems,
  specialActuals,
  onPick,
  onClose,
  onEditCategories,
}: CategoryPickerProps) {
  const categoryKind = kind === 'income' ? 'income' : 'living';
  const year = yearOfMonth(monthKey);
  const tops = useMemo(() => topCategories(categories, categoryKind), [categories, categoryKind]);
  const frequent = useMemo(
    () => frequentCategoryIds(records, categories, categoryKind),
    [records, categories, categoryKind],
  );
  const spend = useMemo(() => livingSpendByTop(records, categories, monthKey), [records, categories, monthKey]);
  const specialRows = useMemo(() => {
    const rows = buildYearRows(specialItems, specialActuals, year, kind).filter((row) => row.planId !== null);
    return [...rows.filter((row) => row.actual === null), ...rows.filter((row) => row.actual !== null)];
  }, [specialItems, specialActuals, year, kind]);
  const unplannedItems = useMemo(
    () => specialItems.filter((item) => item.kind === kind && appliesInYear(item, year)),
    [specialItems, kind, year],
  );

  const pickCategory = (categoryId: string) =>
    onPick({ categoryId, specialItemId: null, specialPlanId: null, amount: null });
  const nameOf = (id: string) => categories.find((category) => category.id === id)?.name ?? '';

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader
        title="種類を選ぶ"
        icon="back"
        onClose={onClose}
        right={
          onEditCategories && (
            <button type="button" aria-label="カテゴリと予算を編集" onClick={onEditCategories} className="text-gray-500">
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

        {(specialRows.length > 0 || unplannedItems.length > 0) && (
          <section className="space-y-2">
            <p className="text-[15px] font-bold text-gray-900">
              {kind === 'income' ? '特別収入' : '特別費'}（{formatYear(year)}の予定）
            </p>
            {specialRows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() =>
                  onPick({ categoryId: null, specialItemId: row.item.id, specialPlanId: row.planId, amount: row.budget })
                }
                className="flex w-full items-center gap-2 border-b border-gray-200 py-2.5 text-left hover:bg-gray-50"
              >
                <span className="flex-1">
                  <span className="block text-sm font-bold text-gray-900">{row.item.name}</span>
                  <span className="block text-xs text-gray-400">
                    {row.month === null ? '月未定' : `${row.month}月`}
                    {row.actual !== null ? '・済' : ''}
                  </span>
                </span>
                <span className="text-[13px] font-semibold text-gray-500 tabular-nums">予算 {formatYen(row.budget)}</span>
              </button>
            ))}
            {unplannedItems.length > 0 && (
              <>
                <p className="pt-1 text-xs font-bold text-gray-500">予定外として記録</p>
                <div className="flex flex-wrap gap-2">
                  {unplannedItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onPick({ categoryId: null, specialItemId: item.id, specialPlanId: null, amount: null })}
                      className={chipClass}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        <p className="text-xs text-gray-400">{kind === 'income' ? '特別収入' : '特別費'}の項目は「年」から足せます</p>
      </div>
    </StackedScreen>
  );
}
