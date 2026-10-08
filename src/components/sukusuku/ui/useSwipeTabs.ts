'use client';

import { useSwipeNavigation } from './useSwipeNavigation';

/**
 * 画面の切り替え（タブ）を左右のスワイプでも切り替えるためのフック。
 * 左スワイプで右隣、右スワイプで左隣の項目へ移る（端では止まり、一周はしない）。
 * 返り値を、切り替えが受け持つ面（帯と中身を包む要素）に `{...swipeHandlers}` として足す。
 * 面の中にある切り替え（期間・種類など）はタップだけで切り替え、スワイプは付けない。
 * mobile版の `mobile/src/hooks/useSwipeTabs.ts` と同じ決まり。
 */
export function useSwipeTabs<T>(ids: readonly T[], value: T, onChange: (id: T) => void, enabled = true) {
  const index = ids.indexOf(value);
  return useSwipeNavigation({
    onSwipeLeft: () => {
      if (index >= 0 && index < ids.length - 1) onChange(ids[index + 1]);
    },
    onSwipeRight: () => {
      if (index > 0) onChange(ids[index - 1]);
    },
    enabled: enabled && ids.length > 1,
  });
}
