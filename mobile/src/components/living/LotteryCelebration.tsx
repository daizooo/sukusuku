import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { SubsidyBallId, SubsidyRate } from '@/types/app';
import LotteryBall from '@/components/living/LotteryBall';
import { colors } from '@/lib/theme';

// 補助くじの当たりの演出（docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryCelebration.tsx` と同じ形・同じ動き。
//
// 出た玉が弾むように出て、後ろで光の筋がゆっくり回り、紙吹雪が舞う。
// はずれは無いので毎回出すが、補助率が高いほど紙吹雪を多くする（金玉は光の筋を2重にする）。

/** 光の筋の色（玉の色を薄くしたもの。白玉は地に溶けないよう金色）。 */
export const RAY_COLOR: Record<SubsidyBallId, string> = {
  white: '#fde68a',
  blue: '#bfdbfe',
  red: '#fecaca',
  gold: '#fde68a',
};

const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#fbbf24'];

/** 補助率ごとの紙吹雪の数。 */
export const CONFETTI_COUNT: Record<SubsidyRate, number> = { 25: 14, 50: 20, 75: 28, 100: 40 };

const RAY_COUNT = 12;
const RAY_BOX = 280;

const rayPoints = () => {
  const center = RAY_BOX / 2;
  const half = Math.PI / RAY_COUNT / 2;
  return Array.from({ length: RAY_COUNT }, (_, index) => {
    const angle = (index * 2 * Math.PI) / RAY_COUNT;
    const a = { x: center + center * Math.cos(angle - half), y: center + center * Math.sin(angle - half) };
    const b = { x: center + center * Math.cos(angle + half), y: center + center * Math.sin(angle + half) };
    return `${center},${center} ${a.x},${a.y} ${b.x},${b.y}`;
  });
};

const RAYS = rayPoints();

function Rays({ color, durationMs, reverse }: { color: string; durationMs: number; reverse?: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [durationMs, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: reverse ? ['360deg', '0deg'] : ['0deg', '360deg'] });
  return (
    <Animated.View style={[styles.rays, { transform: [{ rotate }] }]} pointerEvents="none">
      <Svg width={RAY_BOX} height={RAY_BOX}>
        {RAYS.map((points, index) => (
          <Polygon key={index} points={points} fill={color} opacity={reverse ? 0.45 : 0.8} />
        ))}
      </Svg>
    </Animated.View>
  );
}

interface Piece {
  dx: number;
  dy: number;
  turn: number;
  color: string;
  round: boolean;
}

const makePieces = (count: number): Piece[] =>
  Array.from({ length: count }, (_, index) => {
    // 上向きの半円に散らして、あとで下へ落とす。
    const angle = -Math.PI * (0.05 + 0.9 * Math.random());
    const distance = 70 + Math.random() * 80;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      turn: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360),
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      round: index % 3 === 0,
    };
  });

function Confetti({ count }: { count: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  const pieces = useMemo(() => makePieces(count), [count]);
  useEffect(() => {
    progress.setValue(0);
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: 1600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [progress]);
  return (
    <View style={styles.confetti} pointerEvents="none">
      {pieces.map((piece, index) => (
        <Animated.View
          key={index}
          style={[
            piece.round ? styles.dot : styles.strip,
            {
              backgroundColor: piece.color,
              opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateX: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, piece.dx * 0.8, piece.dx] }) },
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 0.4, 1],
                    outputRange: [0, piece.dy * 0.8, piece.dy * 0.4 + 110],
                  }),
                },
                { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.turn}deg`] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

/** 中身が弾むように出る（delay ミリ秒あとに）。 */
export function PopIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, delay, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 150, delay, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [delay, scale, opacity]);
  return <Animated.View style={[style, { opacity, transform: [{ scale }] }]}>{children}</Animated.View>;
}

interface LotteryCelebrationProps {
  ball: SubsidyBallId;
  rate: SubsidyRate;
  height: number;
}

export default function LotteryCelebration({ ball, rate, height }: LotteryCelebrationProps) {
  return (
    <View style={[styles.stage, { height }]}>
      <Rays color={RAY_COLOR[ball]} durationMs={14000} />
      {ball === 'gold' && <Rays color="#fbbf24" durationMs={9000} reverse />}
      {/* 光の筋の先を、枠の地の色へぼかす（四角く切れて見えないように）。 */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="lotteryFade" cx="50%" cy="50%" r="50%">
            <Stop offset="0.55" stopColor={colors.surface} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.surface} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#lotteryFade)" />
      </Svg>
      <View style={styles.glow} />
      <PopIn>
        <LotteryBall ball={ball} size={104} />
      </PopIn>
      <Confetti count={CONFETTI_COUNT[rate]} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 16 },
  rays: { position: 'absolute', width: RAY_BOX, height: RAY_BOX, top: '50%', left: '50%', marginTop: -RAY_BOX / 2, marginLeft: -RAY_BOX / 2 },
  glow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    top: '50%',
    left: '50%',
    marginTop: -75,
    marginLeft: -75,
  },
  confetti: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0 },
  strip: { position: 'absolute', width: 6, height: 11, borderRadius: 1 },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
});
