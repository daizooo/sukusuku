'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Settings2, X } from 'lucide-react';
import type { MoneyCategory } from '@/types/app';
import {
  childCategories,
  iconKeyOf,
  topCategories,
} from '@/lib/moneyUtils';
import { useBackLayer } from '@/lib/browserHistory';
import { useBackdropClose } from '../ui/useBackdropClose';
import { swipeBoundary } from '../ui/useSwipeNavigation';
import { CategoryIcon, ScreenHeader, StackedScreen } from './moneyVisual';

// カテゴリの選択（docs/kakei.md §3.1・§3.2）。mobile版の `mobile/src/components/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 大分類を1行ずつ並べ、押すと下からシート（ボトムシート）が出て、その大分類の小分類を2列の大きなボタンで見せる（2026-10-24）。
// 以前は大分類の右に小分類を全部並べていた（のち、行の下に開くアコーディオンにした）が、固定費（確定）23件・予備費14件のように
// 件数が多いと、ボタンの大きさや並びがそろわず、押せる場所がひと目で分からなかった。
// 小分類を持たない大分類は、シートを出さずにそのまま選ぶ。件数は出さない。

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
  /** 出す大分類を絞る（年間予算で、予算の分け方の合う大分類だけを選ばせる）。無ければすべて。 */
  onlyTops?: (top: MoneyCategory) => boolean;
}

export default function CategoryPicker({
  kind,
  categories,
  onPick,
  onClose,
  onEditCategories,
  onlyTops,
}: CategoryPickerProps) {
  const categoryKind = kind === 'income' ? 'income' : 'living';
  const tops = useMemo(
    () => topCategories(categories, categoryKind).filter((top) => !onlyTops || onlyTops(top)),
    [categories, categoryKind, onlyTops],
  );
  const pickCategory = (categoryId: string) => onPick({ categoryId });
  // シートを出している大分類（1つだけ）。大分類が1つしか出ないときは最初から出しておく。
  const [openId, setOpenId] = useState<string | null>(() => (tops.length === 1 ? tops[0].id : null));
  const openTop = tops.find((top) => top.id === openId) ?? null;

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
      <div className="relative flex flex-1 min-h-0 flex-col overflow-y-auto pb-2">
        {tops.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">カテゴリがまだありません。右上の歯車からカテゴリを作れます</p>
        )}
        {tops.map((top) => {
          const hasChildren = childCategories(categories, top.id).length > 0;
          return (
            <button
              key={top.id}
              type="button"
              aria-label={top.name}
              onClick={() => (hasChildren ? setOpenId(top.id) : pickCategory(top.id))}
              className="flex h-[60px] w-full shrink-0 items-center gap-3 border-b border-slate-100 px-4 text-left active:bg-slate-100"
            >
              <CategoryIcon iconKey={iconKeyOf(top)} size={32} />
              <span className="min-w-0 flex-1 truncate text-base font-bold text-gray-900">{top.name}</span>
              {hasChildren && <ChevronRight size={18} className="text-gray-500" />}
            </button>
          );
        })}
      </div>
      {openTop && (
        <ChildSheet
          top={openTop}
          items={childCategories(categories, openTop.id)}
          onPick={pickCategory}
          onClose={() => setOpenId(null)}
        />
      )}
    </StackedScreen>
  );
}

// 小分類のボトムシート。戻る操作（ブラウザ・スマホ）・暗い部分・「×」で閉じる。
function ChildSheet({
  top,
  items,
  onPick,
  onClose,
}: {
  top: MoneyCategory;
  items: MoneyCategory[];
  onPick: (categoryId: string) => void;
  onClose: () => void;
}) {
  useBackLayer(onClose);
  const backdropClose = useBackdropClose(onClose);
  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-center bg-black/50 p-4"
      {...backdropClose}
      {...swipeBoundary}
    >
      <div role="dialog" aria-label={`${top.name}の小分類`} className="flex max-h-[85%] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex h-16 shrink-0 items-center gap-3 px-4">
          <CategoryIcon iconKey={iconKeyOf(top)} size={36} />
          <h3 className="min-w-0 flex-1 truncate text-lg font-bold text-gray-900">{top.name}</h3>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 active:bg-gray-200"
          >
            <X size={20} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 overflow-y-auto px-4 pb-6 sm:pb-4">
          {items.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-label={`${top.name} ${category.name}`}
              onClick={() => onPick(category.id)}
              className="flex min-h-[52px] items-center rounded-xl border border-gray-300 bg-white px-3 py-2 text-left text-[15px] font-semibold leading-tight text-gray-900 hover:bg-blue-50 active:border-blue-300 active:bg-blue-50"
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
