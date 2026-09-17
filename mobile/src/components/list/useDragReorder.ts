import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Vibration,
  type LayoutChangeEvent,
  type PanResponderInstance,
  type ViewStyle,
} from 'react-native';

/**
 * 長押ししてそのまま指で動かす並べ替え（Google Keepと同じ操作）。
 * Web版の `src/components/sukusuku/ui/useDragReorder.ts` を置き換えたもの。
 *
 * 矢印ボタンや「並べ替えモード」を持たずに済ませるための仕組み。要点は3つ。
 *
 * - **長押しで持ち上げる。** 押してすぐ動いたらスクロールとみなして持ち上げない。
 *   持ち上がったあいだは一覧のスクロールを止める（`isActive` を渡して切る）。
 * - **並びはその場で入れ替える。** 指の下にある相手の枠に入ったら順番を差し替え、
 *   持っている枠だけを指に追従させる。
 * - **離したときに保存する。** 動かした結果の並びを渡すので、呼び出し側は
 *   position を振り直すだけでよい。
 *
 * 動かせるのは同じ枠（セクション）の中だけ。枠は文字列のキーで区別する。
 *
 * Web版との違いは指の居場所の求め方だけ。Web版はブラウザから画面座標をもらえるが、
 * こちらは枠の中の座標しか分からないので、「つかんだ枠の真ん中 + 動かした量」を
 * 指の居場所とみなす（長押しの時点では指は止まっているので、ずれは小さい）。
 */

/** 長押しと判定するまでの時間。短いとスクロールのたびに持ち上がる。 */
export const HOLD_MS = 280;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  sectionKey: string;
  id: string;
  /** つかんだ時点の並び。離したときに変わっていなければ保存しない。 */
  initial: string[];
  /** つかんだ時点の置き場所。並びが変わったぶんだけ、ここへ当て直す。 */
  slots: Rect[];
}

export interface DragReorder {
  /** 表示用の並び。動かしている最中も並べ替えずに返す（動かすのは位置だけ）。 */
  arrange: <T extends { id: string }>(sectionKey: string, rows: T[]) => T[];
  /** 動かす枠そのものに付ける。置き場所を測るのに使う。 */
  measureProps: (id: string) => { onLayout: (event: LayoutChangeEvent) => void };
  /** つかむ場所に付ける（枠全体でも、見出しだけでもよい）。 */
  holdProps: (
    sectionKey: string,
    rows: { id: string }[],
    id: string,
  ) => { onLongPress: () => void; delayLongPress: number };
  /** 指と、入れ替わったぶんの動き。枠に当てる。 */
  styleFor: (id: string) => ViewStyle;
  isDragging: (id: string) => boolean;
  /** 持ち上げているあいだは true。一覧のスクロールを止めるのに使う。 */
  isActive: boolean;
  /** 動かしているあいだ指を追うための受け口。枠を並べている入れ物に付ける。 */
  panHandlers: PanResponderInstance['panHandlers'];
}

const centerOf = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

const contains = (rect: Rect, x: number, y: number) =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

export function useDragReorder(
  onReorder: (sectionKey: string, orderedIds: string[]) => void,
): DragReorder {
  const layouts = useRef(new Map<string, Rect>()).current;
  const drag = useRef<DragState | null>(null);
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const delta = useRef({ x: 0, y: 0 });

  // 描き直しが要るのは「持ち上げた枠」と「入れ替わった並び」だけ。
  const [active, setActive] = useState<{ sectionKey: string; id: string; ids: string[] } | null>(
    null,
  );
  // 指を離したときの受け口は作り直さないので、いまの並びは ref からも読めるようにする。
  const activeRef = useRef(active);
  activeRef.current = active;

  // 保存先は毎回の描画で変わるので、いまのものを持っておく。
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const finish = () => {
    const current = drag.current;
    drag.current = null;
    delta.current = { x: 0, y: 0 };
    pan.setValue({ x: 0, y: 0 });
    const ids = activeRef.current?.ids ?? current?.initial ?? [];
    setActive(null);
    if (!current) return;
    if (ids.some((id, index) => id !== current.initial[index])) {
      onReorderRef.current(current.sectionKey, ids);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // 長押しで持ち上がったあとだけ、指の動きを受け取る（それまではスクロールに任せる）。
        onMoveShouldSetPanResponder: () => drag.current !== null,
        onMoveShouldSetPanResponderCapture: () => drag.current !== null,
        onPanResponderMove: (_event, gesture) => {
          const current = drag.current;
          if (!current) return;
          delta.current = { x: gesture.dx, y: gesture.dy };
          pan.setValue({ x: gesture.dx, y: gesture.dy });

          setActive((prev) => {
            if (!prev) return prev;
            // 次の指の動きでも読めるよう、ref にも同じものを残す。
            const index = prev.ids.indexOf(current.id);
            if (index < 0) return prev;

            // 指の居場所。つかんだ枠の真ん中から、動かしたぶんだけずらす。
            const home = current.slots[current.initial.indexOf(current.id)];
            if (!home) return prev;
            const finger = centerOf(home);
            const x = finger.x + gesture.dx;
            const y = finger.y + gesture.dy;

            // 指の下にある相手の置き場所へ差し込む。
            let target = index;
            prev.ids.forEach((id, i) => {
              if (id === current.id) return;
              const slot = current.slots[i];
              if (slot && contains(slot, x, y)) target = i;
            });
            if (target === index) return prev;

            const ids = [...prev.ids];
            ids.splice(index, 1);
            ids.splice(target, 0, current.id);
            const next = { ...prev, ids };
            activeRef.current = next;
            return next;
          });
        },
        onPanResponderRelease: finish,
        onPanResponderTerminate: finish,
        onPanResponderTerminationRequest: () => false,
      }),
    // finish は描画のたびに作り直されるが、中で見ているのは ref と state の更新関数だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return {
    arrange: (sectionKey, rows) => rows,

    measureProps: (id) => ({
      onLayout: (event: LayoutChangeEvent) => {
        layouts.set(id, event.nativeEvent.layout);
      },
    }),

    holdProps: (sectionKey, rows, id) => ({
      delayLongPress: HOLD_MS,
      onLongPress: () => {
        // 1つしかないときは動かしても並びが変わらない。
        if (rows.length < 2 || drag.current) return;
        const ids = rows.map((row) => row.id);
        const slots = ids.map((rowId) => layouts.get(rowId) ?? { x: 0, y: 0, width: 0, height: 0 });
        drag.current = { sectionKey, id, initial: ids, slots };
        delta.current = { x: 0, y: 0 };
        pan.setValue({ x: 0, y: 0 });
        setActive({ sectionKey, id, ids });
        // 持ち上がったことを指に返す（Web版の navigator.vibrate(10) と同じ）。
        Vibration.vibrate(10);
      },
    }),

    styleFor: (id) => {
      const current = drag.current;
      if (!current || !active) return {};

      // 持っている枠は指に付いてくる。
      if (id === current.id) {
        return {
          transform: pan.getTranslateTransform(),
          zIndex: 20,
          elevation: 8,
        } as unknown as ViewStyle;
      }

      // ほかの枠は、入れ替わったぶんだけ置き場所を移す。
      const from = current.initial.indexOf(id);
      const to = active.ids.indexOf(id);
      if (from < 0 || to < 0 || from === to) return {};
      const start = current.slots[from];
      const end = current.slots[to];
      if (!start || !end) return {};
      return { transform: [{ translateX: end.x - start.x }, { translateY: end.y - start.y }] };
    },

    isDragging: (id) => active?.id === id,
    isActive: active !== null,
    panHandlers: panResponder.panHandlers,
  };
}
