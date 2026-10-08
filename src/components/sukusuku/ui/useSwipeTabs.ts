'use client';

import { useRef, type TouchEvent } from 'react';

// 切り替え（タブ・SegmentedTabs など）を左右のスワイプでも切り替えるためのフック。
// mobile版の `mobile/src/hooks/useSwipeTabs.ts` と同じ決まり:
// - 左スワイプで右隣、右スワイプで左隣の項目へ移る（端では止まり、一周はしない）
// - 横の動きがはっきり大きいときだけ反応し、縦のスクロールやタップは素通しする
// - 受け持つ場所が入れ子になったら、指を置いた場所にいちばん近い（内側の）ものだけが反応する
//
// 返り値を、切り替えが受け持つ面（帯と中身を包む要素）に `{...swipeHandlers}` として足す。
// モーダルの枠や横スクロールの帯には swipeBoundary を足し、下の面の切り替えへ届かないようにする。

const REGION_ATTRIBUTE = 'data-swipe-region';

/** これ未満の横移動は指の震え・タップの誤差とみなして無視する（mobile と同じ値）。 */
const HORIZONTAL_THRESHOLD = 50;

/** スワイプを受け持たない区切り。モーダルの枠・横スクロールの帯に足す。 */
export const swipeBoundary = { [REGION_ATTRIBUTE]: '' };

export function useSwipeTabs<T>(ids: readonly T[], value: T, onChange: (id: T) => void, enabled = true) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    [REGION_ATTRIBUTE]: '',
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      start.current = null;
      if (!enabled || ids.length < 2 || event.touches.length !== 1) return;
      const target = event.target as Element;
      // 内側に別の受け持ち（またはモーダルの枠）があれば、そちらに任せる。
      if (target.closest(`[${REGION_ATTRIBUTE}]`) !== event.currentTarget) return;
      // 入力欄の中で指を横に動かすのは、文字の選択・カーソル移動。
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const dx = event.changedTouches[0].clientX - from.x;
      const dy = event.changedTouches[0].clientY - from.y;
      if (Math.abs(dx) < HORIZONTAL_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
      const index = ids.indexOf(value);
      if (index < 0) return;
      const next = dx < 0 ? index + 1 : index - 1;
      if (next >= 0 && next < ids.length) onChange(ids[next]);
    },
    onTouchCancel: () => {
      start.current = null;
    },
  };
}
