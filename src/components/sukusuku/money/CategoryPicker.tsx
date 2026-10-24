'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import type { MoneyCategory } from '@/types/app';
import {
  childCategories,
  iconKeyOf,
  topCategories,
} from '@/lib/moneyUtils';
import { CategoryIcon, ScreenHeader, StackedScreen } from './moneyVisual';

// カテゴリの選択（docs/kakei.md §3.1・§3.2）。mobile版の `mobile/src/components/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 大分類を1行ずつ並べ、押した1つだけ開いて小分類のボタンを出す（アコーディオン。2026-10-24）。
// 以前は大分類の右に小分類を全部並べていて、固定費（確定）23件・予備費14件のように件数が多いと見にくかった。
// 別の大分類を押すと、開いていたものは閉じる。開いた行は画面の上に寄せる（下の方の大分類でも小分類が見える）。
// 小分類を持たない大分類は、開かずにそのまま選ぶ。

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

const chipClass = 'rounded-lg bg-white px-3 py-[9px] text-[15px] font-semibold leading-tight text-gray-900 hover:bg-blue-50 active:bg-blue-50';

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
  // 開いている大分類（1つだけ）。大分類が1つしか出ないときは最初から開いておく。
  const [openId, setOpenId] = useState<string | null>(() => (tops.length === 1 ? tops[0].id : null));
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // 人が開いたときだけ上に寄せる（最初から開いている1つだけのときは寄せない）。
  const scrollOnOpen = useRef(false);

  // 開いた行を一覧の上に寄せる。scrollIntoView は枠（overflow-hidden）ごと動かしてしまうので、一覧のスクロールだけを送る。
  useEffect(() => {
    if (!scrollOnOpen.current) return;
    scrollOnOpen.current = false;
    const row = openId ? rowRefs.current.get(openId) : null;
    if (row) listRef.current?.scrollTo({ top: row.offsetTop, behavior: 'smooth' });
  }, [openId]);

  const toggle = (top: MoneyCategory) => {
    scrollOnOpen.current = openId !== top.id;
    setOpenId(openId === top.id ? null : top.id);
  };

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
      <div ref={listRef} className="relative flex flex-1 min-h-0 flex-col overflow-y-auto pb-2">
        {tops.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">カテゴリがまだありません。右上の歯車からカテゴリを作れます</p>
        )}
        {tops.map((top) => {
          const children = childCategories(categories, top.id);
          const open = openId === top.id;
          const hasChildren = children.length > 0;
          return (
            <div
              key={top.id}
              ref={(el) => {
                if (el) rowRefs.current.set(top.id, el);
                else rowRefs.current.delete(top.id);
              }}
              className="shrink-0"
            >
              <button
                type="button"
                aria-label={top.name}
                aria-expanded={hasChildren ? open : undefined}
                onClick={() => (hasChildren ? toggle(top) : pickCategory(top.id))}
                className={`flex w-full items-center gap-2.5 border-b border-slate-100 px-3.5 py-[11px] text-left active:bg-slate-100 ${open ? 'bg-gray-100' : ''}`}
              >
                <CategoryIcon iconKey={iconKeyOf(top)} size={30} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-gray-900">{top.name}</span>
                {hasChildren && (
                  <>
                    <span className="text-xs font-medium tabular-nums text-gray-400">{children.length}件</span>
                    {open ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </>
                )}
              </button>
              {open && hasChildren && (
                <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-gray-100 px-3.5 pb-3.5 pt-2">
                  {children.map((category) => (
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
              )}
            </div>
          );
        })}
      </div>
    </StackedScreen>
  );
}
