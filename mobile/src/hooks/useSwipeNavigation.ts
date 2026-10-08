import { useMemo, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderInstance,
} from 'react-native';

/**
 * 左右の矢印ボタンで日付・ページを送る画面に、横スワイプでも同じ操作ができるようにする
 * ための共通フック。「しきい値を超えて横に動いたか」「縦（スクロール）より横の動きが
 * 大きいか」の判定だけをここに1つにまとめ、予定タブ・記録タブなど複数の画面で使い回す。
 * 見出し帯だけでなく画面全体（どこをスワイプしても）で反応させたいので、返り値を
 * 画面いちばん外側の View（SafeAreaView 等）に `{...panHandlers}` として足して使う
 * （`react-native-gesture-handler` 等の追加ライブラリは使わず、コア標準の
 * PanResponder だけで組んでいる）。横方向がはっきり大きいときだけ反応するため、
 * 一覧の縦スクロールやボタンのタップはこれまで通り素通しする。
 *
 * スワイプしている感じが出るよう、返り値の style を足した Animated.View（動かしたい中身）が
 * 指に合わせて横に動く。しきい値を超えて離すと画面の外へ流れ、切り替えたあと反対側から
 * 流れ込む。超えなければ元の位置へ戻る。進めない向き（端・今日より先など）は
 * コールバックを渡さず（undefined）、指に半分ほどしかついてこないようにする。
 */

/** これ未満の横移動は指の震え・タップの誤差とみなして無視する。 */
const HORIZONTAL_THRESHOLD = 50;
/** 縦のスクロールを奪わないよう、横方向がこれを超えて動くまでは判定を始めない。 */
const DIRECTION_LOCK_SLOP = 10;
/** 進めない向きへ引いたときに、指の動きのどれだけ中身を動かすか。 */
const EDGE_RESISTANCE = 0.3;
/** 画面の外へ流れる時間と、反対側から流れ込む時間（ミリ秒）。 */
const SLIDE_OUT_MS = 140;
const SLIDE_IN_MS = 200;

/**
 * スワイプを受け持つ場所が入れ子になったとき（家計タブの面の切り替えの中に、振り返りの
 * 期間の切り替えがある等）、指を置いた場所にいちばん近い（内側の）ものだけを反応させる印。
 * 触れ始めのイベントは内側から外側へ順に届くので、最初に届いたものが受け持つ。
 * PanResponder の capture は外側から先に聞かれるため、これが無いと外側が奪ってしまう。
 */
let claimed: { event: object; owner: object | null } | null = null;

const claim = (event: GestureResponderEvent, owner: object | null) => {
  if (claimed?.event === event.nativeEvent) return;
  claimed = { event: event.nativeEvent, owner };
};

/**
 * モーダルの中身のいちばん外側の View に足す。React の木ではモーダルの中も開いた画面の
 * 子なので、足さないとモーダルの中でのスワイプが下の画面の切り替えまで届いてしまう。
 */
export const swipeBoundary = {
  onTouchStart: (event: GestureResponderEvent) => claim(event, null),
};

export type SwipeHandlers = PanResponderInstance['panHandlers'] & {
  onTouchStart: (event: GestureResponderEvent) => void;
};

export interface SwipeNavigation {
  /** 受け持つ面（画面いちばん外側の View など）に `{...handlers}` として足す。 */
  handlers: SwipeHandlers;
  /** 指に合わせて動かす中身（Animated.View）の style に足す。 */
  style: { transform: { translateX: Animated.Value }[] };
}

export interface UseSwipeNavigationOptions {
  /** 左スワイプ（指を左へ）＝カルーセルで次へ進む向き。矢印の「次へ」ボタンと同じ処理を渡す。進めないときは undefined。 */
  onSwipeLeft?: () => void;
  /** 右スワイプ（指を右へ）＝前へ戻る向き。矢印の「前へ」ボタンと同じ処理を渡す。戻れないときは undefined。 */
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
}: UseSwipeNavigationOptions): SwipeNavigation {
  // 毎回の描画でコールバックが変わっても PanResponder は作り直さなくて済むよう、ref 経由で読む。
  const latest = useRef({ onSwipeLeft, onSwipeRight, enabled });
  latest.current = { onSwipeLeft, onSwipeRight, enabled };
  const owner = useRef({}).current;
  const translateX = useRef(new Animated.Value(0)).current;

  const settle = () =>
    Animated.spring(translateX, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();

  const isHorizontalSwipe = (dx: number, dy: number) =>
    latest.current.enabled &&
    claimed?.owner === owner &&
    Math.abs(dx) > DIRECTION_LOCK_SLOP &&
    Math.abs(dx) > Math.abs(dy);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // 横方向にはっきり動いたときだけ受け取る。縦方向の動き（一覧のスクロール）や
        // 単なるタップ（矢印ボタン・今日ボタンなど）はそのまま素通しする。
        onMoveShouldSetPanResponder: (_event, gesture) => isHorizontalSwipe(gesture.dx, gesture.dy),
        onMoveShouldSetPanResponderCapture: (_event, gesture) => isHorizontalSwipe(gesture.dx, gesture.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => translateX.stopAnimation(),
        onPanResponderMove: (_event, gesture) => {
          const action = gesture.dx < 0 ? latest.current.onSwipeLeft : latest.current.onSwipeRight;
          translateX.setValue(action ? gesture.dx : gesture.dx * EDGE_RESISTANCE);
        },
        onPanResponderTerminate: settle,
        onPanResponderRelease: (_event, gesture) => {
          const action = gesture.dx < 0 ? latest.current.onSwipeLeft : latest.current.onSwipeRight;
          if (
            !latest.current.enabled ||
            !action ||
            Math.abs(gesture.dx) < HORIZONTAL_THRESHOLD ||
            Math.abs(gesture.dx) <= Math.abs(gesture.dy)
          ) {
            settle();
            return;
          }
          // 指の向きへ画面の外まで流し、切り替えてから反対側から流れ込ませる。
          const direction = gesture.dx < 0 ? -1 : 1;
          const width = Dimensions.get('window').width;
          Animated.timing(translateX, {
            toValue: direction * width,
            duration: SLIDE_OUT_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start(() => {
            action();
            translateX.setValue(-direction * width);
            requestAnimationFrame(() =>
              Animated.timing(translateX, {
                toValue: 0,
                duration: SLIDE_IN_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }).start(),
            );
          });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return useMemo(
    () => ({
      handlers: {
        ...panResponder.panHandlers,
        // スワイプを止めている間（enabled=false）は受け持たず、外側に譲る。
        onTouchStart: (event: GestureResponderEvent) => {
          if (latest.current.enabled) claim(event, owner);
        },
      },
      style: { transform: [{ translateX }] },
    }),
    [panResponder, owner, translateX],
  );
}
