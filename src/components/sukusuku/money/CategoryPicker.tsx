'use client';

import { useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import type { MoneyCategory } from '@/types/app';
import {
  childCategories,
  iconKeyOf,
  topCategories,
} from '@/lib/moneyUtils';
import { CategoryIcon, ScreenHeader, StackedScreen } from './moneyVisual';

// カテゴリの選択（docs/kakei.md §3.1・§3.2）。mobile版の `mobile/src/components/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 大分類を1行ずつ: 左に大分類（アイコン・名前。予算の残りは出さない）、
// 右に小分類のボタン（入りきらなければ折り返す）。押すと大分類も決まる。
// スクロールしなくても1画面に収まるように詰める（2026-10-20。以前は大分類ごとの枠と見出しの帯で、縦に長かった）。小分類を主役に、大分類は小さく。
// 大分類の行は与えられた高さを行数で割って縦に伸ばす（下に余白を残さない）。ただし1行は ROW_MAX_STRETCH までで、
// 行数の少ない収入（3行ほど）が画面いっぱいに引き伸ばされないようにする（2026-10-20）。入りきらないときだけスクロールする。
// 一覧の高さは container query（cqh）で測る。

/** 大分類の1行を、余った高さで伸ばしてよい上限（px）。 */
const ROW_MAX_STRETCH = 80;

export interface CategoryChoice {
  categoryId: string;
}

interface CategoryPickerProps {
  kind: 'expense' | 'income';
  categories: MoneyCategory[];
  onPick: (choice: CategoryChoice) => void;
  onClose: () => void;
  /** カテゴリ・予算の編集へ。無ければ歯車を出さない（家計の設定の中から開いたとき）。 */
  onEditCategories?: () => void;
}

const chipClass = 'rounded-lg bg-gray-100 px-2.5 py-[7px] text-[15px] font-semibold leading-tight text-gray-900 hover:bg-blue-50 active:bg-blue-50';

export default function CategoryPicker({
  kind,
  categories,
  onPick,
  onClose,
  onEditCategories,
}: CategoryPickerProps) {
  const categoryKind = kind === 'income' ? 'income' : 'living';
  const tops = useMemo(() => topCategories(categories, categoryKind), [categories, categoryKind]);
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
      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto pb-2 [container-type:size]">
        {tops.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">カテゴリがまだありません。右上の歯車からカテゴリを作れます</p>
        )}
        {tops.map((top) => {
          const children = childCategories(categories, top.id);
          return (
            <div
              key={top.id}
              className="flex shrink-0 items-center border-b border-slate-100 px-2.5 py-2.5"
              style={{ minHeight: `min(${ROW_MAX_STRETCH}px, calc(100cqh / ${tops.length}))` }}
            >
              <div className="flex w-[104px] shrink-0 items-center gap-1.5">
                <CategoryIcon iconKey={iconKeyOf(top)} size={24} />
                <p className="min-w-0 flex-1 truncate text-[13px] font-bold leading-tight text-gray-700">{top.name}</p>
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
