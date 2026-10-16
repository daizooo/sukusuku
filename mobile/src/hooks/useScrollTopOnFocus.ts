import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * タブを開くたびに（ほかのタブから戻ったときも）、スクロールをいちばん上へ戻す（2026-10-16）。
 * タブは一度開くと残るので、何もしないと前に見ていた位置が残る。「その画面のいちばん上から始まる」ようにそろえるためのフック。
 * ref はそのタブの主なスクロール（ScrollView）に付ける。
 */
export function useScrollTopOnFocus(ref: { current: { scrollTo: (options: { y: number; animated: boolean }) => void } | null }) {
  useFocusEffect(
    useCallback(() => {
      ref.current?.scrollTo({ y: 0, animated: false });
    }, [ref]),
  );
}
