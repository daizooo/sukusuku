'use client';

import { useRef, type TouchEvent } from 'react';

// 左右の矢印で日付・ページを送る画面や切り替えを、横スワイプでも同じ操作ができるようにする。
// mobile版の `mobile/src/hooks/useSwipeNavigation.ts` と同じ決まり:
// - 横の動きがはっきり大きいときだけ反応し、縦のスクロールやタップは素通しする
// - 受け持つ場所が入れ子になったら、指を置いた場所にいちばん近い（内側の）ものだけが反応する
//
// 返り値を、受け持つ面（画面いちばん外側の要素など）に `{...swipeHandlers}` として足す。
// モーダルの枠や横スクロールの帯には swipeBoundary を足し、下の画面へ届かないようにする。

const REGION_ATTRIBUTE = 'data-swipe-region';

/** これ未満の横移動は指の震え・タップの誤差とみなして無視する（mobile と同じ値）。 */
const HORIZONTAL_THRESHOLD = 50;

/** スワイプを受け持たない区切り。モーダルの枠・横スクロールの帯に足す。 */
export const swipeBoundary = { [REGION_ATTRIBUTE]: '' };

export interface UseSwipeNavigationOptions {
  /** 左スワイプ（指を左へ）＝次へ進む向き。矢印の「次へ」ボタンと同じ処理を渡す。 */
  onSwipeLeft?: () => void;
  /** 右スワイプ（指を右へ）＝前へ戻る向き。矢印の「前へ」ボタンと同じ処理を渡す。 */
  onSwipeRight?: () => void;
  /** false の間はスワイプを無視する（受け持たず、外側にも渡さない）。 */
  enabled?: boolean;
}

export function useSwipeNavigation({ onSwipeLeft, onSwipeRight, enabled = true }: UseSwipeNavigationOptions) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    [REGION_ATTRIBUTE]: '',
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      start.current = null;
      if (!enabled || event.touches.length !== 1) return;
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
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    },
    onTouchCancel: () => {
      start.current = null;
    },
  };
}
