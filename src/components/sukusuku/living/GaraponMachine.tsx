import type { SubsidyBallId } from '@/types/app';
import { BALL_COLOR } from './LotteryBall';

// 補助くじのガラポン（福引の八角形の抽選器）の絵（docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/GaraponMachine.tsx` と同じ形・同じ動き（動きは globals.css）。
//
// - idle: 回す前。胴がゆらゆら揺れる
// - spin: 「ガラポン！」を押してから結果が出るまで。胴が回り続ける
// - ball を渡すと、その玉が出口から受け皿へ転がり出る（回しているあいだに渡す）
//
// 座標は横160×縦150の枠で決め、width に合わせて拡大する。

const VIEW_W = 160;
const VIEW_H = 150;
/** 胴の中心と半径。 */
const DRUM_X = 80;
const DRUM_Y = 62;
const DRUM_R = 48;
/** 受け皿に止まった玉の中心と直径。 */
const BALL_X = 26;
const BALL_Y = 109;
const BALL_D = 16;

const PANEL_COLORS = ['#ef4444', '#f87171'];

const OCTAGON = Array.from({ length: 8 }, (_, index) => {
  const angle = ((22.5 + index * 45) * Math.PI) / 180;
  return { x: DRUM_X + DRUM_R * Math.cos(angle), y: DRUM_Y + DRUM_R * Math.sin(angle) };
});

interface GaraponMachineProps {
  width: number;
  mode: 'idle' | 'spin';
  /** 受け皿に出た玉。null なら出ていない。 */
  ball?: SubsidyBallId | null;
}

export default function GaraponMachine({ width, mode, ball = null }: GaraponMachineProps) {
  const tone = ball ? BALL_COLOR[ball] : null;
  const ballR = BALL_D / 2;
  return (
    <svg
      aria-hidden
      width={width}
      height={(width * VIEW_H) / VIEW_W}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="shrink-0 overflow-visible"
    >
      {/* 脚・台・出口・受け皿（動かない部分）。 */}
      <polygon points="62,92 70,92 52,136 42,136" fill="#92400e" />
      <polygon points="90,92 98,92 118,136 108,136" fill="#92400e" />
      <rect x={24} y={132} width={112} height={12} rx={4} fill="#b45309" />
      <rect x={24} y={132} width={112} height={4} rx={2} fill="#d97706" />
      <line x1={50} y1={90} x2={28} y2={116} stroke="#d97706" strokeWidth={7} strokeLinecap="round" />
      <rect x={8} y={114} width={38} height={10} rx={5} fill="#fde68a" stroke="#d97706" strokeWidth={2} />

      {tone && (
        <g className="garapon-drop">
          <circle cx={BALL_X} cy={BALL_Y} r={ballR - 1} fill={tone.fill} stroke={tone.edge} strokeWidth={2} />
          <ellipse
            cx={BALL_X - ballR * 0.3}
            cy={BALL_Y - ballR * 0.4}
            rx={ballR * 0.28}
            ry={ballR * 0.17}
            fill="rgba(255, 255, 255, 0.55)"
            transform={`rotate(-30 ${BALL_X - ballR * 0.3} ${BALL_Y - ballR * 0.4})`}
          />
        </g>
      )}

      {/* 回る胴。八角形を色違いの8枚に分けて、回っているのが分かるようにする。 */}
      <g className={`garapon-drum ${mode === 'idle' ? 'garapon-idle' : 'garapon-spin'}`}>
        {OCTAGON.map((point, index) => {
          const next = OCTAGON[(index + 1) % OCTAGON.length];
          return (
            <polygon
              key={index}
              points={`${DRUM_X},${DRUM_Y} ${point.x},${point.y} ${next.x},${next.y}`}
              fill={PANEL_COLORS[index % 2]}
            />
          );
        })}
        <polygon
          points={OCTAGON.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={4}
          strokeLinejoin="round"
        />
        <line x1={DRUM_X} y1={DRUM_Y} x2={DRUM_X + 32} y2={DRUM_Y} stroke="#78350f" strokeWidth={5} strokeLinecap="round" />
        <circle cx={DRUM_X + 32} cy={DRUM_Y} r={6} fill="#fde68a" stroke="#b45309" strokeWidth={2} />
        <circle cx={DRUM_X} cy={DRUM_Y} r={9} fill="#fbbf24" stroke="#b45309" strokeWidth={2} />
      </g>
    </svg>
  );
}
