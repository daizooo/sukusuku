import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

/**
 * 奥の画面（編集・選ぶ画面）へ進んで戻ったとき、一覧を直前のスクロール位置から始める（2026-10-25）。
 * 奥の画面を開くと一覧の ScrollView は取り除かれ、戻ると作り直されて一番上になる。項目の多い設定では、
 * 触っていた場所を探し直すことになるので、位置だけを覚えておいて戻す。
 * 奥の画面へ進んでも残る親（state を持つコンポーネント）で呼び、返り値をそのまま ScrollView に広げる。
 * 新しく開いたときは一番上から（親ごと作り直されれば位置も捨てられる）。
 */
export function useKeepScroll() {
  const scroller = useRef<ScrollView | null>(null);
  const offset = useRef(0);
  // 作り直された直後から、位置を戻し終えるまで。この間の onScroll（0）で覚えた位置を上書きしない。
  const restoring = useRef(false);

  const ref = useCallback((node: ScrollView | null) => {
    scroller.current = node;
    restoring.current = node !== null && offset.current > 0;
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!restoring.current) offset.current = event.nativeEvent.contentOffset.y;
  }, []);
  // 中身の高さが決まってから戻す（それより前だと、高さが足りず一番上に丸められる）。
  const onContentSizeChange = useCallback(() => {
    if (!restoring.current) return;
    restoring.current = false;
    requestAnimationFrame(() => scroller.current?.scrollTo({ y: offset.current, animated: false }));
  }, []);

  return { ref, onScroll, onContentSizeChange, scrollEventThrottle: 16 };
}
