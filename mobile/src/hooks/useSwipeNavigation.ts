import { useMemo, useRef } from 'react';
import { PanResponder, type PanResponderInstance } from 'react-native';

/**
 * 左右の矢印ボタンで日付・ページを送る画面に、横スワイプでも同じ操作ができるようにする
 * ための共通フック。「しきい値を超えて横に動いたか」「縦（スクロール）より横の動きが
 * 大きいか」の判定だけをここに1つにまとめ、予定タブ・記録タブなど複数の画面で使い回す。
 * 画面ごとのUI（矢印ボタンや見出し）はそのままで、対象の View に返り値を
 * `{...panHandlers}` として足すだけで使える（`react-native-gesture-handler` 等の
 * 追加ライブラリは使わず、コア標準の PanResponder だけで組んでいる）。
 */

/** これ未満の横移動は指の震え・タップの誤差とみなして無視する。 */
const HORIZONTAL_THRESHOLD = 50;
/** 縦のスクロールを奪わないよう、横方向がこれを超えて動くまでは判定を始めない。 */
const DIRECTION_LOCK_SLOP = 10;

export interface UseSwipeNavigationOptions {
  /** 左スワイプ（指を左へ）＝カルーセルで次へ進む向き。矢印の「次へ」ボタンと同じ処理を渡す。 */
  onSwipeLeft?: () => void;
  /** 右スワイプ（指を右へ）＝前へ戻る向き。矢印の「前へ」ボタンと同じ処理を渡す。 */
  onSwipeRight?: () => void;
  /**
   * false の間はスワイプを無視する。「次へ」ボタンが disabled のときにスワイプでだけ
   * 進めてしまう、といったズレを防ぐために使う（呼び出し側でその条件を渡す）。
   */
  enabled?: boolean;
}

export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
}: UseSwipeNavigationOptions): PanResponderInstance['panHandlers'] {
  // 毎回の描画でコールバックが変わっても PanResponder は作り直さなくて済むよう、ref 経由で読む。
  const latest = useRef({ onSwipeLeft, onSwipeRight, enabled });
  latest.current = { onSwipeLeft, onSwipeRight, enabled };

  const isHorizontalSwipe = (dx: number, dy: number) =>
    latest.current.enabled && Math.abs(dx) > DIRECTION_LOCK_SLOP && Math.abs(dx) > Math.abs(dy);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // 横方向にはっきり動いたときだけ受け取る。縦方向の動き（一覧のスクロール）や
        // 単なるタップ（矢印ボタン・今日ボタンなど）はそのまま素通しする。
        onMoveShouldSetPanResponder: (_event, gesture) => isHorizontalSwipe(gesture.dx, gesture.dy),
        onMoveShouldSetPanResponderCapture: (_event, gesture) => isHorizontalSwipe(gesture.dx, gesture.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_event, gesture) => {
          if (!latest.current.enabled) return;
          if (Math.abs(gesture.dx) < HORIZONTAL_THRESHOLD) return;
          if (Math.abs(gesture.dx) <= Math.abs(gesture.dy)) return;
          if (gesture.dx < 0) latest.current.onSwipeLeft?.();
          else latest.current.onSwipeRight?.();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return panResponder.panHandlers;
}
