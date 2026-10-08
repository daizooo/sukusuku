'use client';

import { useCallback, useRef, type TouchEvent } from 'react';

// 左右の矢印で日付・ページを送る画面や切り替えを、横スワイプでも同じ操作ができるようにする。
// mobile版の `mobile/src/hooks/useSwipeNavigation.ts` と同じ決まり:
// - 横の動きがはっきり大きいときだけ反応し、縦のスクロールやタップは素通しする
// - 受け持つ場所が入れ子になったら、指を置いた場所にいちばん近い（内側の）ものだけが反応する
//
// 返り値の handlers を受け持つ面（画面いちばん外側の要素など）に足し、attachContent を
// 指に合わせて動かす中身の要素に付ける。中身は指について横に動き、しきい値を超えて離すと
// 画面の外へ流れ、切り替えたあと反対側から流れ込む（超えなければ元へ戻る）。進めない向き
// （端・今日より先など）はコールバックを渡さず、指に半分ほどしかついてこないようにする。
// 返り値は `const { handlers: swipeHandlers, attachContent } = ...` と分けて受け取る（`swipe.handlers` と
// 読むと、react-hooks の lint が描画中の ref の読み出しと見なす）。
// モーダルの枠や横スクロールの帯には swipeBoundary を足し、下の画面へ届かないようにする。

const REGION_ATTRIBUTE = 'data-swipe-region';

/** これ未満の横移動は指の震え・タップの誤差とみなして無視する（mobile と同じ値）。 */
const HORIZONTAL_THRESHOLD = 50;
/** 縦のスクロールを奪わないよう、横方向がこれを超えて動くまでは判定を始めない（mobile と同じ値）。 */
const DIRECTION_LOCK_SLOP = 10;
/** 進めない向きへ引いたときに、指の動きのどれだけ中身を動かすか（mobile と同じ値）。 */
const EDGE_RESISTANCE = 0.3;
/** 画面の外へ流れる時間と、反対側から流れ込む時間（ミリ秒。mobile と同じ値）。 */
const SLIDE_OUT_MS = 140;
const SLIDE_IN_MS = 200;

/** スワイプを受け持たない区切り。モーダルの枠・横スクロールの帯に足す。 */
export const swipeBoundary = { [REGION_ATTRIBUTE]: '' };

export interface UseSwipeNavigationOptions {
  /** 左スワイプ（指を左へ）＝次へ進む向き。矢印の「次へ」ボタンと同じ処理を渡す。進めないときは undefined。 */
  onSwipeLeft?: () => void;
  /** 右スワイプ（指を右へ）＝前へ戻る向き。矢印の「前へ」ボタンと同じ処理を渡す。戻れないときは undefined。 */
  onSwipeRight?: () => void;
  /** false の間はスワイプを無視する（受け持たず、外側にも渡さない）。 */
  enabled?: boolean;
}

/** 中身の要素の位置を変える。transition を空にすると、その場で動く（指についていくとき）。 */
const moveTo = (element: HTMLElement, x: number, transition = '') => {
  element.style.transition = transition;
  element.style.transform = x === 0 ? '' : `translateX(${x}px)`;
};

export function useSwipeNavigation({ onSwipeLeft, onSwipeRight, enabled = true }: UseSwipeNavigationOptions) {
  const start = useRef<{ x: number; y: number } | null>(null);
  /** 指の動きが横（スワイプ）か縦（スクロール）か。決まるまでは null。 */
  const direction = useRef<'horizontal' | 'vertical' | null>(null);
  const content = useRef<HTMLElement | null>(null);
  // 中身の要素に付ける ref。ref の入れ物ごと返すと描画中に読むものと見なされるため、関数で受け取る。
  const attachContent = useCallback((element: HTMLElement | null) => {
    content.current = element;
  }, []);

  const settle = () => {
    if (content.current) moveTo(content.current, 0, `transform ${SLIDE_IN_MS}ms ease-out`);
  };

  return {
    attachContent,
    handlers: {
      [REGION_ATTRIBUTE]: '',
      onTouchStart: (event: TouchEvent<HTMLElement>) => {
        start.current = null;
        direction.current = null;
        if (!enabled || event.touches.length !== 1) return;
        const target = event.target as Element;
        // 内側に別の受け持ち（またはモーダルの枠）があれば、そちらに任せる。
        if (target.closest(`[${REGION_ATTRIBUTE}]`) !== event.currentTarget) return;
        // 入力欄の中で指を横に動かすのは、文字の選択・カーソル移動。
        if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
        start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      },
      onTouchMove: (event: TouchEvent<HTMLElement>) => {
        const from = start.current;
        if (!from || event.touches.length !== 1) return;
        const dx = event.touches[0].clientX - from.x;
        const dy = event.touches[0].clientY - from.y;
        if (direction.current === null) {
          if (Math.abs(dx) > DIRECTION_LOCK_SLOP && Math.abs(dx) > Math.abs(dy)) direction.current = 'horizontal';
          else if (Math.abs(dy) > DIRECTION_LOCK_SLOP) direction.current = 'vertical';
        }
        if (direction.current !== 'horizontal' || !content.current) return;
        const action = dx < 0 ? onSwipeLeft : onSwipeRight;
        moveTo(content.current, action ? dx : dx * EDGE_RESISTANCE);
      },
      onTouchEnd: (event: TouchEvent<HTMLElement>) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const dx = event.changedTouches[0].clientX - from.x;
        const dy = event.changedTouches[0].clientY - from.y;
        const action = dx < 0 ? onSwipeLeft : onSwipeRight;
        if (
          direction.current === 'vertical' ||
          !action ||
          Math.abs(dx) < HORIZONTAL_THRESHOLD ||
          Math.abs(dx) <= Math.abs(dy)
        ) {
          settle();
          return;
        }
        const element = content.current;
        if (!element) {
          action();
          return;
        }
        // 指の向きへ画面の外まで流し、切り替えてから反対側から流れ込ませる。
        const sign = dx < 0 ? -1 : 1;
        const width = element.getBoundingClientRect().width;
        moveTo(element, sign * width, `transform ${SLIDE_OUT_MS}ms ease-out`);
        window.setTimeout(() => {
          action();
          moveTo(element, -sign * width);
          // 切り替えた中身が描かれてから流し込む。
          requestAnimationFrame(() =>
            requestAnimationFrame(() => moveTo(element, 0, `transform ${SLIDE_IN_MS}ms ease-out`)),
          );
        }, SLIDE_OUT_MS);
      },
      onTouchCancel: () => {
        start.current = null;
        settle();
      },
    },
  };
}
