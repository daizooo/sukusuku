'use client';

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { swipeBoundary } from '../ui/useSwipeNavigation';

// 長い一覧の右端に出す、つかんで動かせる「早送りのバー」（2026-10-15。家計の記録の一覧で、過去へすぐ飛ぶため）。
// mobile版の `mobile/src/components/money/FastScrollBar.tsx` と同じ決まり。
// 2026-10-16: バーは**最初から出しておく**（消さない）。右端の細い帯のどこを触っても、バーがそこへ飛んで一覧もその位置へ動き、
// バーをつかんで動かしてもよい。**触っているあいだだけ**、横にその位置の見出し（日付）を出す。
// 親は、スクロールする要素（scrollRef）と同じ大きさの相対位置の枠の中に置く。

/** バーのつまみの高さ。 */
const THUMB_HEIGHT = 56;

export default function FastScrollBar({ scrollRef, label }: { scrollRef: RefObject<HTMLElement | null>; label: string }) {
  const [top, setTop] = useState(0);
  const [dragging, setDragging] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const currentTop = useRef(0);
  const grabOffset = useRef(THUMB_HEIGHT / 2);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const update = () => {
      // 触っているあいだは、つまみは指についていく（スクロールの反映で揺らさない）。
      if (isDragging.current) return;
      const max = Math.max(element.scrollHeight - element.clientHeight, 1);
      const range = Math.max(element.clientHeight - THUMB_HEIGHT, 1);
      currentTop.current = Math.min(Math.max(element.scrollTop / max, 0), 1) * range;
      setTop(currentTop.current);
    };
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  }, [scrollRef]);

  /** 帯の上の位置（clientY − 帯の上端）へ、つまみと一覧を動かす。 */
  const moveTo = (yInStrip: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const range = Math.max(element.clientHeight - THUMB_HEIGHT, 1);
    const next = Math.min(Math.max(yInStrip - grabOffset.current, 0), range);
    currentTop.current = next;
    setTop(next);
    element.scrollTop = (next / range) * Math.max(element.scrollHeight - element.clientHeight, 0);
  };
  const yIn = (event: PointerEvent<HTMLDivElement>) => event.clientY - (stripRef.current?.getBoundingClientRect().top ?? 0);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    isDragging.current = true;
    setDragging(true);
    const y = yIn(event);
    // つまみの上を触ったときは、つまみの触った所を保つ。それ以外は、触った位置がつまみの中心になる。
    const onThumb = y >= currentTop.current && y <= currentTop.current + THUMB_HEIGHT;
    grabOffset.current = onThumb ? y - currentTop.current : THUMB_HEIGHT / 2;
    moveTo(y);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) moveTo(yIn(event));
  };
  const onPointerEnd = () => {
    isDragging.current = false;
    setDragging(false);
  };

  return (
    <div
      ref={stripRef}
      {...swipeBoundary}
      role="presentation"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className="absolute inset-y-0 right-0 w-7 touch-none"
    >
      <div className="pointer-events-none absolute right-0 top-0 flex items-center" style={{ height: THUMB_HEIGHT, transform: `translateY(${top}px)` }}>
        {dragging && label !== '' && (
          <span className="absolute right-8 whitespace-nowrap rounded-full bg-blue-600 px-3.5 py-2 text-[15px] font-bold tabular-nums text-white shadow-md">
            {label}
          </span>
        )}
        <span className="mr-0.5 w-2 rounded bg-blue-600" style={{ height: THUMB_HEIGHT - 8 }} />
      </div>
    </div>
  );
}
