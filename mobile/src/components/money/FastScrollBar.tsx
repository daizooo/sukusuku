import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
// スクロールすると現れ、少し止まると消える。つかんで上下に動かすと、動かした割合の位置へ一覧が飛ぶ。バーが出ているあいだは、横にその位置の見出し（日付）が出る。
// 一覧の高さは描いた分から見積もるので、遠くへ飛んだあとに少しずれることがある（スクロールすれば合う）。

/** バーのつまみの高さ。 */
const THUMB_HEIGHT = 56;
/** つまみをつかめる幅（見た目の幅は細い）。 */
const GRIP_WIDTH = 32;
/** スクロールが止まってからバーを消すまでの時間（ミリ秒）。 */
const HIDE_DELAY_MS = 1400;

export interface FastScrollController {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (event: LayoutChangeEvent) => void;
  /** つまみの縦の位置（0〜trackHeight − THUMB_HEIGHT）。 */
  thumbTop: Animated.Value;
  opacity: Animated.Value;
  /** バーが出ている間だけ true（出ていないときは触れない）。 */
  visible: boolean;
  dragging: boolean;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
}

export function useFastScroll<T>(listRef: RefObject<FlatList<T> | null>): FastScrollController {
  const metrics = useRef({ offset: 0, content: 1, viewport: 1 });
  const track = useRef(0);
  const currentTop = useRef(0);
  const startTop = useRef(0);
  const isDragging = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbTop = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);

  const range = () => Math.max(track.current - THUMB_HEIGHT, 1);

  const hideSoon = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (isDragging.current) return;
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setVisible(false));
    }, HIDE_DELAY_MS);
  }, [opacity]);

  const reveal = useCallback(() => {
    setVisible(true);
    Animated.timing(opacity, { toValue: 1, duration: 100, useNativeDriver: true }).start();
    hideSoon();
  }, [opacity, hideSoon]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      metrics.current = { offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height };
      track.current = layoutMeasurement.height;
      // つかんで動かしているあいだは、つまみは指についていく（スクロールの反映で揺らさない）。
      if (isDragging.current) return;
      const maxOffset = Math.max(contentSize.height - layoutMeasurement.height, 1);
      const ratio = Math.min(Math.max(contentOffset.y / maxOffset, 0), 1);
      currentTop.current = ratio * range();
      thumbTop.setValue(currentTop.current);
      reveal();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reveal, thumbTop],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    track.current = event.nativeEvent.layout.height;
  }, []);

  const panHandlers = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          isDragging.current = true;
          setDragging(true);
          startTop.current = currentTop.current;
          if (hideTimer.current) clearTimeout(hideTimer.current);
        },
        onPanResponderMove: (_event, gesture) => {
          const top = Math.min(Math.max(startTop.current + gesture.dy, 0), range());
          currentTop.current = top;
          thumbTop.setValue(top);
          const maxOffset = Math.max(metrics.current.content - metrics.current.viewport, 0);
          listRef.current?.scrollToOffset({ offset: (top / range()) * maxOffset, animated: false });
        },
        onPanResponderRelease: () => {
          isDragging.current = false;
          setDragging(false);
          hideSoon();
        },
        onPanResponderTerminate: () => {
          isDragging.current = false;
          setDragging(false);
          hideSoon();
        },
      }).panHandlers,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hideSoon, listRef, thumbTop],
  );

  return { onScroll, onLayout, thumbTop, opacity, visible, dragging, panHandlers };
}

/** 一覧の上に重ねる。label はつかんでいるあいだ、つまみの横に出す見出し（その位置の日付など）。 */
export default function FastScrollBar({ controller, label }: { controller: FastScrollController; label: string }) {
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Animated.View
        pointerEvents={controller.visible ? 'box-none' : 'none'}
        style={[styles.thumb, { opacity: controller.opacity, transform: [{ translateY: controller.thumbTop }] }]}
      >
        {label !== '' && (
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{label}</Text>
          </View>
        )}
        <View {...swipeBoundary} {...controller.panHandlers} style={styles.grip}>
          <View style={styles.pill} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject },
  thumb: { position: 'absolute', top: 0, right: 0, height: THUMB_HEIGHT, flexDirection: 'row', alignItems: 'center' },
  grip: { width: GRIP_WIDTH, height: THUMB_HEIGHT, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 2 },
  pill: { width: 8, height: THUMB_HEIGHT - 8, borderRadius: 4, backgroundColor: colors.money },
  bubble: {
    marginRight: 6,
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
