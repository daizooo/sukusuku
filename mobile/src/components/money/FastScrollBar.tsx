import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';

// 長い一覧の右端に出す、つかんで動かせる「早送りのバー」（2026-10-15。家計の記録の一覧で、過去へすぐ飛ぶため）。
// PWA版の `src/components/sukusuku/money/FastScrollBar.tsx` と同じ決まり。
// 2026-10-16: バーは**最初から出しておく**（消さない）。右端の細い帯のどこを触っても、バーがそこへ飛んで一覧もその位置へ動き、
// バーをつかんで動かしてもよい。**触っているあいだだけ**、横にその位置の見出し（日付）を出す。
// 一覧の高さは描いた分から見積もるので、遠くへ飛んだあとに少しずれることがある（スクロールすれば合う）。

/** バーのつまみの高さ。 */
const THUMB_HEIGHT = 56;
/** 触れる帯の幅（見た目のつまみは細い）。 */
const STRIP_WIDTH = 28;

export interface FastScrollController {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  /** つまみの縦の位置（0〜帯の高さ − THUMB_HEIGHT）。 */
  thumbTop: Animated.Value;
  /** 触っている間だけ true（日付の吹き出しを出す）。 */
  dragging: boolean;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  /** 帯の View に付ける ref（画面上の位置を測る）。 */
  stripRef: RefObject<View | null>;
}

export function useFastScroll<T>(listRef: RefObject<FlatList<T> | null>): FastScrollController {
  const metrics = useRef({ offset: 0, content: 1, viewport: 1 });
  const track = useRef(0);
  const stripTop = useRef(0);
  const currentTop = useRef(0);
  const grabOffset = useRef(THUMB_HEIGHT / 2);
  const isDragging = useRef(false);
  const stripRef = useRef<View>(null);
  const thumbTop = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);

  const range = () => Math.max(track.current - THUMB_HEIGHT, 1);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      metrics.current = { offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height };
      track.current = layoutMeasurement.height;
      // 触っているあいだは、つまみは指についていく（スクロールの反映で揺らさない）。
      if (isDragging.current) return;
      const maxOffset = Math.max(contentSize.height - layoutMeasurement.height, 1);
      const ratio = Math.min(Math.max(contentOffset.y / maxOffset, 0), 1);
      currentTop.current = ratio * range();
      thumbTop.setValue(currentTop.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thumbTop],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    track.current = event.nativeEvent.layout.height;
  }, []);

  /** 帯の上の位置（pageY − 帯の上端）へ、つまみと一覧を動かす。 */
  const moveTo = useCallback(
    (yInStrip: number) => {
      const top = Math.min(Math.max(yInStrip - grabOffset.current, 0), range());
      currentTop.current = top;
      thumbTop.setValue(top);
      const maxOffset = Math.max(metrics.current.content - metrics.current.viewport, 0);
      listRef.current?.scrollToOffset({ offset: (top / range()) * maxOffset, animated: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listRef, thumbTop],
  );

  const panHandlers = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const pageY = event.nativeEvent.pageY;
          isDragging.current = true;
          setDragging(true);
          // 帯の画面上の位置を測ってから、触った位置へ動かす。つまみの上を触ったときは、つまみの触った所を保つ。
          stripRef.current?.measure((_x, _y, _width, height, _pageX, top) => {
            stripTop.current = top;
            track.current = height;
            const yInStrip = pageY - top;
            const onThumb = yInStrip >= currentTop.current && yInStrip <= currentTop.current + THUMB_HEIGHT;
            grabOffset.current = onThumb ? yInStrip - currentTop.current : THUMB_HEIGHT / 2;
            moveTo(yInStrip);
          });
        },
        onPanResponderMove: (_event, gesture) => moveTo(gesture.moveY - stripTop.current),
        onPanResponderRelease: () => {
          isDragging.current = false;
          setDragging(false);
        },
        onPanResponderTerminate: () => {
          isDragging.current = false;
          setDragging(false);
        },
      }).panHandlers,
    [moveTo],
  );

  return { onScroll, onLayout, thumbTop, dragging, panHandlers, stripRef };
}

/** 一覧の上に重ねる。label は触っているあいだ、つまみの横に出す見出し（その位置の日付など）。 */
export default function FastScrollBar({ controller, label }: { controller: FastScrollController; label: string }) {
  return (
    <View
      ref={controller.stripRef}
      collapsable={false}
      {...swipeBoundary}
      {...controller.panHandlers}
      style={styles.strip}
    >
      <Animated.View pointerEvents="none" style={[styles.thumb, { transform: [{ translateY: controller.thumbTop }] }]}>
        {controller.dragging && label !== '' && (
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{label}</Text>
          </View>
        )}
        <View style={styles.pill} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', top: 0, bottom: 0, right: 0, width: STRIP_WIDTH },
  thumb: { position: 'absolute', top: 0, right: 0, height: THUMB_HEIGHT, flexDirection: 'row', alignItems: 'center' },
  pill: { width: 8, height: THUMB_HEIGHT - 8, marginRight: 2, borderRadius: 4, backgroundColor: colors.money },
  bubble: {
    position: 'absolute',
    right: STRIP_WIDTH + 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.money,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  // 数字を出す Text は fontWeight を必ず付ける（CLAUDE.md）。
  bubbleText: { fontSize: 15, fontWeight: '700', color: '#ffffff', fontVariant: ['tabular-nums'] },
});
