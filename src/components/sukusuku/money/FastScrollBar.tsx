'use client';

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { swipeBoundary } from '../ui/useSwipeNavigation';

// 長い一覧の右端に出す、つかんで動かせる「早送りのバー」（2026-10-15。家計の記録の一覧で、過去へすぐ飛ぶため）。
// mobile版の `mobile/src/components/money/FastScrollBar.tsx` と同じ決まり。
// スクロールすると現れ、少し止まると消える。つかんで上下に動かすと、動かした割合の位置へ一覧が飛び、横にその位置の見出し（日付）が出る。
// 親は、スクロールする要素（scrollRef）と同じ大きさの相対位置の枠の中に置く。

/** バーのつまみの高さ。 */
const THUMB_HEIGHT = 56;
/** スクロールが止まってからバーを消すまでの時間（ミリ秒）。 */
const HIDE_DELAY_MS = 1400;

export default function FastScrollBar({ scrollRef, label }: { scrollRef: RefObject<HTMLElement | null>; label: string }) {
  const [top, setTop] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ y: 0, top: 0 });
  const hideTimer = useRef<number | undefined>(undefined);

  const hideSoon = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!isDragging.current) setVisible(false);
    }, HIDE_DELAY_MS);
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const onScroll = () => {
      // つかんで動かしているあいだは、つまみは指についていく（スクロールの反映で揺らさない）。
      if (!isDragging.current) {
        const max = Math.max(element.scrollHeight - element.clientHeight, 1);
        const range = Math.max(element.clientHeight - THUMB_HEIGHT, 1);
        setTop(Math.min(Math.max(element.scrollTop / max, 0), 1) * range);
      }
      setVisible(true);
      hideSoon();
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      window.clearTimeout(hideTimer.current);
    };
  }, [scrollRef]);

  const moveTo = (clientY: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const range = Math.max(element.clientHeight - THUMB_HEIGHT, 1);
    const next = Math.min(Math.max(dragStart.current.top + clientY - dragStart.current.y, 0), range);
    setTop(next);
    element.scrollTop = (next / range) * Math.max(element.scrollHeight - element.clientHeight, 0);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    isDragging.current = true;
    setDragging(true);
    dragStart.current = { y: event.clientY, top };
    window.clearTimeout(hideTimer.current);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) moveTo(event.clientY);
  };
  const onPointerEnd = () => {
    isDragging.current = false;
    setDragging(false);
    hideSoon();
  };

  return (
    <div
      aria-hidden={!visible}
      className={`pointer-events-none absolute right-0 top-0 flex items-center transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ height: THUMB_HEIGHT, transform: `translateY(${top}px)` }}
    >
      {dragging && label !== '' && (
        <span className="mr-1.5 whitespace-nowrap rounded-full bg-blue-600 px-3.5 py-2 text-[15px] font-bold tabular-nums text-white shadow-md">
          {label}
        </span>
      )}
      <div
        {...swipeBoundary}
        role="presentation"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className={`flex w-8 touch-none items-center justify-end pr-0.5 ${visible ? 'pointer-events-auto' : ''}`}
        style={{ height: THUMB_HEIGHT }}
      >
        <span className="w-2 rounded bg-blue-600" style={{ height: THUMB_HEIGHT - 8 }} />
      </div>
    </div>
  );
}
