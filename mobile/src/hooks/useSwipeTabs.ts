import { useSwipeNavigation, type SwipeNavigation } from './useSwipeNavigation';

/**
 * 切り替え（タブ・SegmentedTabs など）を左右のスワイプでも切り替えるためのフック。
 * 左スワイプで右隣、右スワイプで左隣の項目へ移る（端では止まり、一周はしない）。
 * 返り値の handlers を、切り替えが受け持つ面（帯と中身を包む View）に足し、
 * style を指に合わせて動かす中身（帯の下の Animated.View）に足す。
 * 面の中にある切り替え（期間・種類など）はタップだけで切り替え、スワイプは付けない。
 * PWA版の `src/components/sukusuku/ui/useSwipeTabs.ts` と同じ決まり。
 */
export function useSwipeTabs<T>(
  ids: readonly T[],
  value: T,
  onChange: (id: T) => void,
  enabled = true,
): SwipeNavigation {
  const index = ids.indexOf(value);
  return useSwipeNavigation({
    onSwipeLeft: index >= 0 && index < ids.length - 1 ? () => onChange(ids[index + 1]) : undefined,
    onSwipeRight: index > 0 ? () => onChange(ids[index - 1]) : undefined,
    enabled: enabled && ids.length > 1,
  });
}
