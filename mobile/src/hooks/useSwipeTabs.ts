import { useSwipeNavigation, type SwipeHandlers } from './useSwipeNavigation';

/**
 * 切り替え（タブ・SegmentedTabs など）を左右のスワイプでも切り替えるためのフック。
 * 左スワイプで右隣、右スワイプで左隣の項目へ移る（端では止まり、一周はしない）。
 * 返り値を、切り替えが受け持つ面（帯と中身を包む View）に `{...swipeHandlers}` として足す。
 * PWA版の `src/components/sukusuku/ui/useSwipeTabs.ts` と同じ決まり。
 */
export function useSwipeTabs<T>(
  ids: readonly T[],
  value: T,
  onChange: (id: T) => void,
  enabled = true,
): SwipeHandlers {
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
