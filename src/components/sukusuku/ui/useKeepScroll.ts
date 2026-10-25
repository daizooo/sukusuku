'use client';

import { useCallback, useRef, type UIEvent } from 'react';

/**
 * 奥の画面（編集・選ぶ画面）へ進んで戻ったとき、一覧を直前のスクロール位置から始める（2026-10-25）。
 * 奥の画面を開くと一覧のスクロールの枠は取り除かれ、戻ると作り直されて一番上になる。項目の多い設定では、
 * 触っていた場所を探し直すことになるので、位置だけを覚えておいて戻す（mobile の useKeepScroll と同じ）。
 * 奥の画面へ進んでも残る親（state を持つコンポーネント）で呼び、返り値をそのまま枠の div に広げる。
 * 新しく開いたときは一番上から（親ごと作り直されれば位置も捨てられる）。
 */
export function useKeepScroll() {
  const offset = useRef(0);

  // 枠が作り直された直後に位置を戻す（中身は同じ描画で入っているので、そのまま戻せる）。
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node !== null && offset.current > 0) node.scrollTop = offset.current;
  }, []);
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    offset.current = event.currentTarget.scrollTop;
  }, []);

  return { ref, onScroll };
}
