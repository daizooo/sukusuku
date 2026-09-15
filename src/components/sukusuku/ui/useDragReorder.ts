'use client';

import { useEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * 長押ししてそのまま指で動かす並べ替え（Google Keepと同じ操作）。
 *
 * 矢印ボタンや「並べ替えモード」を持たずに済ませるための仕組み。
 * ライブラリは足さない（docs/lists.md §9）。要点は3つ。
 *
 * - **長押しで持ち上げる。** 押してすぐ動いたらスクロールとみなして持ち上げない。
 *   逆に指が止まったまま HOLD_MS 経てば、その時点ではまだスクロールが
 *   始まっていないので、そこから `touchmove` を止めれば画面は動かなくなる。
 * - **並びはその場で入れ替える。** 指の下にある相手の枠に入ったら順番を差し替え、
 *   持っている要素だけを指に追従させる（下の applyOffset）。
 * - **離したときに保存する。** 動かした結果の並びを渡すので、呼び出し側は
 *   position を振り直すだけでよい。
 *
 * 動かせるのは同じ枠（セクション）の中だけ。枠は文字列のキーで区別する。
 */

/** 長押しと判定するまでの時間。短いとスクロールのたびに持ち上がる。 */
const HOLD_MS = 280;
/** 長押しの前にこれだけ動いたらスクロールとみなす。 */
const CANCEL_PX = 8;
/** 画面の上下これだけに近づいたら自動でスクロールする。 */
const EDGE_PX = 56;
const MAX_SPEED_PX = 14;

interface Point {
  x: number;
  y: number;
}

interface DragState {
  sectionKey: string;
  id: string;
  /** つかんだ時点の並び。離したときに変わっていなければ保存しない。 */
  initial: string[];
  ids: string[];
  grab: Point;
  /** つかんだ瞬間の要素の位置（画面座標）。 */
  home: Point;
  /** いま要素に当てている移動量。 */
  offset: Point;
  scroller: HTMLElement | null;
}

interface Active {
  sectionKey: string;
  id: string;
  ids: string[];
}

export interface DragReorder {
  /** 表示用の並び。ドラッグ中の枠だけ入れ替えた配列を返す。 */
  arrange: <T extends { id: string }>(sectionKey: string, rows: T[]) => T[];
  /** 動かす要素そのものに付ける。 */
  dragRef: (id: string) => (el: HTMLElement | null) => void;
  /** つかむ場所に付ける（要素全体でも、見出しだけでもよい）。 */
  handleProps: (
    sectionKey: string,
    rows: { id: string }[],
    id: string,
  ) => { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void };
  isDragging: (id: string) => boolean;
}

const blockTouch = (event: TouchEvent) => event.preventDefault();

/** スクロールしている親を探す。自動スクロールの相手になる。 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

function createController(setActive: (active: Active | null) => void) {
  let onReorder: (sectionKey: string, orderedIds: string[]) => void = () => {};
  const elements = new Map<string, HTMLElement>();
  const refs = new Map<string, (el: HTMLElement | null) => void>();
  const pointer: Point = { x: 0, y: 0 };
  let drag: DragState | null = null;
  let pending: { timer: number; start: Point } | null = null;
  let frame: number | null = null;

  const detach = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  const clearPending = () => {
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending = null;
  };

  /**
   * 持っている要素を指に追いつかせる。
   * 並びが変わって要素の居場所が動いても、いま当てている移動量を引けば
   * 本来の位置が分かるので、そこから当て直す。
   */
  const applyOffset = () => {
    if (!drag) return;
    const el = elements.get(drag.id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const homeX = rect.left - drag.offset.x;
    const homeY = rect.top - drag.offset.y;
    drag.offset = {
      x: drag.home.x + (pointer.x - drag.grab.x) - homeX,
      y: drag.home.y + (pointer.y - drag.grab.y) - homeY,
    };
    el.style.transform = `translate(${drag.offset.x}px, ${drag.offset.y}px)`;
  };

  /** 指の下にある相手の枠に入ったら、その位置へ差し込む。 */
  const reorder = () => {
    if (!drag) return;
    const index = drag.ids.indexOf(drag.id);
    if (index < 0) return;
    let target = index;
    drag.ids.forEach((id, i) => {
      if (id === drag?.id) return;
      const el = elements.get(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom) {
        target = i;
      }
    });
    if (target === index) return;
    const ids = [...drag.ids];
    ids.splice(index, 1);
    ids.splice(target, 0, drag.id);
    drag.ids = ids;
    setActive({ sectionKey: drag.sectionKey, id: drag.id, ids });
  };

  /** 画面の端まで持っていったら、そのままスクロールする。 */
  const autoScroll = () => {
    const scroller = drag?.scroller;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const fromTop = pointer.y - rect.top;
    const fromBottom = rect.bottom - pointer.y;
    let delta = 0;
    if (fromTop < EDGE_PX) delta = -Math.ceil(((EDGE_PX - fromTop) / EDGE_PX) * MAX_SPEED_PX);
    else if (fromBottom < EDGE_PX) delta = Math.ceil(((EDGE_PX - fromBottom) / EDGE_PX) * MAX_SPEED_PX);
    if (delta !== 0) scroller.scrollTop += delta;
  };

  const tick = () => {
    autoScroll();
    reorder();
    applyOffset();
    frame = requestAnimationFrame(tick);
  };

  const begin = (sectionKey: string, ids: string[], id: string) => {
    const el = elements.get(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    drag = {
      sectionKey,
      id,
      initial: [...ids],
      ids: [...ids],
      grab: { ...pointer },
      home: { x: rect.left, y: rect.top },
      offset: { x: 0, y: 0 },
      scroller: scrollParent(el),
    };
    setActive({ sectionKey, id, ids: [...ids] });
    // 長押しが決まった時点ではまだスクロールが始まっていないので、ここから止められる。
    document.addEventListener('touchmove', blockTouch, { passive: false });
    document.body.style.userSelect = 'none';
    navigator.vibrate?.(10);
    frame = requestAnimationFrame(tick);
  };

  /**
   * 動かしたあとの指離しは「押した」扱いにしない（カードを開かない）。
   * 動かしたものの中で起きたクリックだけを1回止める。ほかの場所は素通しする。
   */
  const swallowNextClick = (moved: HTMLElement | undefined) => {
    const remove = () => document.removeEventListener('click', handler, { capture: true });
    function handler(event: MouseEvent) {
      if (moved && event.target instanceof Node && !moved.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      remove();
    }
    document.addEventListener('click', handler, { capture: true });
    window.setTimeout(remove, 250);
  };

  const finish = () => {
    if (!drag) return;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    document.removeEventListener('touchmove', blockTouch);
    document.body.style.userSelect = '';
    const el = elements.get(drag.id);
    if (el) el.style.transform = '';
    const { sectionKey, ids, initial } = drag;
    drag = null;
    setActive(null);
    swallowNextClick(el);
    if (ids.some((id, index) => id !== initial[index])) onReorder(sectionKey, ids);
  };

  function onPointerMove(event: PointerEvent) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (!pending) return;
    // 長押しの前に動いたなら、並べ替えではなくスクロールしたいということ。
    if (Math.hypot(event.clientX - pending.start.x, event.clientY - pending.start.y) > CANCEL_PX) {
      clearPending();
      detach();
    }
  }

  function onPointerUp() {
    clearPending();
    detach();
    finish();
  }

  return {
    /** 保存先は毎回の描画で変わるので、外から差し替える。 */
    setOnReorder(next: (sectionKey: string, orderedIds: string[]) => void) {
      onReorder = next;
    },
    dragRef(id: string) {
      const cached = refs.get(id);
      if (cached) return cached;
      const ref = (el: HTMLElement | null) => {
        if (el) elements.set(id, el);
        else elements.delete(id);
      };
      refs.set(id, ref);
      return ref;
    },
    handleProps(sectionKey: string, rows: { id: string }[], id: string) {
      return {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
          if (event.button !== 0 || drag || pending) return;
          if (rows.length < 2) return;
          pointer.x = event.clientX;
          pointer.y = event.clientY;
          const start = { x: event.clientX, y: event.clientY };
          const ids = rows.map((row) => row.id);
          pending = {
            start,
            timer: window.setTimeout(() => {
              pending = null;
              begin(sectionKey, ids, id);
            }, HOLD_MS),
          };
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
          window.addEventListener('pointercancel', onPointerUp);
        },
      };
    },
    dispose() {
      clearPending();
      detach();
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener('touchmove', blockTouch);
      document.body.style.userSelect = '';
      drag = null;
    },
  };
}

export function useDragReorder(onReorder: (sectionKey: string, orderedIds: string[]) => void): DragReorder {
  const [active, setActive] = useState<Active | null>(null);
  const [controller] = useState(() => createController(setActive));

  useEffect(() => {
    controller.setOnReorder(onReorder);
  }, [controller, onReorder]);

  useEffect(() => () => controller.dispose(), [controller]);

  return {
    arrange<T extends { id: string }>(sectionKey: string, rows: T[]): T[] {
      if (!active || active.sectionKey !== sectionKey) return rows;
      const byId = new Map(rows.map((row) => [row.id, row]));
      const arranged = active.ids.map((id) => byId.get(id)).filter((row): row is T => row !== undefined);
      // 並べ替え中に増えた項目（同期など）は落とさず末尾に付ける。
      const known = new Set(active.ids);
      return [...arranged, ...rows.filter((row) => !known.has(row.id))];
    },
    dragRef: controller.dragRef,
    handleProps: controller.handleProps,
    isDragging: (id: string) => active?.id === id,
  };
}
