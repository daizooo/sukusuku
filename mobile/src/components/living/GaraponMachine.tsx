import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polygon, Rect } from 'react-native-svg';
import type { SubsidyBallId } from '@/types/app';
import LotteryBall from '@/components/living/LotteryBall';
import useReduceMotion from '@/components/living/useReduceMotion';

// 補助くじのガラポン（福引の八角形の抽選器）の絵（docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/GaraponMachine.tsx` と同じ形・同じ動き。
//
// - idle: くじの面の飾り。胴がゆらゆら揺れる
// - spin: 結果の画面。胴が3回転してから止まる
// - ball を渡すと、その玉が出口から受け皿へ転がり出る
//
// 座標は横160×縦150の枠で決め、width に合わせて拡大する。回る胴だけ別の絵にして回している。

const VIEW_W = 160;
const VIEW_H = 150;
/** 胴の中心と半径。 */
const DRUM_X = 80;
const DRUM_Y = 62;
const DRUM_R = 48;
/** 胴の絵の一辺（縁の太さのぶん余白を足す）。 */
const DRUM_BOX = (DRUM_R + 4) * 2;
/** 受け皿に止まった玉の中心と直径。 */
const BALL_X = 26;
const BALL_Y = 109;
const BALL_D = 16;
/** 玉が出てくる出口（胴の左下）。 */
const OUTLET_X = 48;
const OUTLET_Y = 88;

const PANEL_COLORS = ['#ef4444', '#f87171'];

const octagon = (cx: number, cy: number, r: number) =>
  Array.from({ length: 8 }, (_, index) => {
    const angle = ((22.5 + index * 45) * Math.PI) / 180;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

interface GaraponMachineProps {
  width: number;
  mode: 'idle' | 'spin';
  /** 回す時間（ミリ秒）。mode が spin のとき使う。 */
  spinMs?: number;
  /** 受け皿に出た玉。null なら出ていない。 */
  ball?: SubsidyBallId | null;
}

export default function GaraponMachine({ width, mode, spinMs = 1400, ball = null }: GaraponMachineProps) {
  const reduceMotion = useReduceMotion();
  const sway = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const drop = useRef(new Animated.Value(0)).current;
  const scale = width / VIEW_W;

  useEffect(() => {
    if (reduceMotion) return;
    if (mode === 'idle') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(sway, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(sway, { toValue: -1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(sway, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    spin.setValue(0);
    const run = Animated.timing(spin, {
      toValue: 1,
      duration: spinMs,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [mode, spinMs, reduceMotion, sway, spin]);

  useEffect(() => {
    if (ball === null) {
      drop.setValue(0);
      return;
    }
    if (reduceMotion) {
      drop.setValue(1);
      return;
    }
    const run = Animated.timing(drop, { toValue: 1, duration: 650, easing: Easing.bounce, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [ball, reduceMotion, drop]);

  const rotate =
    mode === 'idle'
      ? sway.interpolate({ inputRange: [-1, 1], outputRange: ['-10deg', '10deg'] })
      : spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '1080deg'] });

  const center = DRUM_BOX / 2;
  const points = octagon(center, center, DRUM_R);
  const ballSize = BALL_D * scale;

  return (
    <View style={{ width, height: VIEW_H * scale }}>
      {/* 脚・台・出口・受け皿（動かない部分）。 */}
      <Svg width={width} height={VIEW_H * scale} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={StyleSheet.absoluteFill}>
        <Polygon points="62,92 70,92 52,136 42,136" fill="#92400e" />
        <Polygon points="90,92 98,92 118,136 108,136" fill="#92400e" />
        <Rect x={24} y={132} width={112} height={12} rx={4} fill="#b45309" />
        <Rect x={24} y={132} width={112} height={4} rx={2} fill="#d97706" />
        <Line x1={50} y1={90} x2={28} y2={116} stroke="#d97706" strokeWidth={7} strokeLinecap="round" />
        <Rect x={8} y={114} width={38} height={10} rx={5} fill="#fde68a" stroke="#d97706" strokeWidth={2} />
      </Svg>

      {ball !== null && (
        <Animated.View
          style={{
            position: 'absolute',
            left: (BALL_X - BALL_D / 2) * scale,
            top: (BALL_Y - BALL_D / 2) * scale,
            opacity: drop.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
            transform: [
              { translateX: drop.interpolate({ inputRange: [0, 1], outputRange: [(OUTLET_X - BALL_X) * scale, 0] }) },
              { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [(OUTLET_Y - BALL_Y) * scale, 0] }) },
              { rotate: drop.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] }) },
            ],
          }}
        >
          <LotteryBall ball={ball} size={ballSize} />
        </Animated.View>
      )}

      {/* 回る胴。八角形を色違いの8枚に分けて、回っているのが分かるようにする。 */}
      <Animated.View
        style={{
          position: 'absolute',
          left: (DRUM_X - DRUM_BOX / 2) * scale,
          top: (DRUM_Y - DRUM_BOX / 2) * scale,
          width: DRUM_BOX * scale,
          height: DRUM_BOX * scale,
          transform: [{ rotate }],
        }}
      >
        <Svg width={DRUM_BOX * scale} height={DRUM_BOX * scale} viewBox={`0 0 ${DRUM_BOX} ${DRUM_BOX}`}>
          {points.map((point, index) => {
            const next = points[(index + 1) % points.length];
            return (
              <Polygon
                key={index}
                points={`${center},${center} ${point.x},${point.y} ${next.x},${next.y}`}
                fill={PANEL_COLORS[index % 2]}
              />
            );
          })}
          <Polygon
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={4}
            strokeLinejoin="round"
          />
          <Line x1={center} y1={center} x2={center + 32} y2={center} stroke="#78350f" strokeWidth={5} strokeLinecap="round" />
          <Circle cx={center + 32} cy={center} r={6} fill="#fde68a" stroke="#b45309" strokeWidth={2} />
          <Circle cx={center} cy={center} r={9} fill="#fbbf24" stroke="#b45309" strokeWidth={2} />
        </Svg>
      </Animated.View>
    </View>
  );
}
