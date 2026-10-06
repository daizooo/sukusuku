'use client';

import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { SubsidyBallId, SubsidyRate } from '@/types/app';
import LotteryBall from './LotteryBall';

// 補助くじの当たりの演出（docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/LotteryCelebration.tsx` と同じ形・同じ動き（動きは globals.css）。
//
// 出た玉が弾むように出て、後ろで光の筋がゆっくり回り、紙吹雪が舞う。
// はずれは無いので毎回出すが、補助率が高いほど紙吹雪を多くする（金玉は光の筋を2重にする）。

/** 光の筋の色（玉の色を薄くしたもの。白玉は地に溶けないよう金色）。 */
const RAY_COLOR: Record<SubsidyBallId, string> = {
  white: '#fde68a',
  blue: '#bfdbfe',
  red: '#fecaca',
  gold: '#fde68a',
};

const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#fbbf24'];

/** 補助率ごとの紙吹雪の数。 */
const CONFETTI_COUNT: Record<SubsidyRate, number> = { 25: 14, 50: 20, 75: 28, 100: 40 };

const RAY_COUNT = 12;
const RAY_BOX = 280;

const RAYS = Array.from({ length: RAY_COUNT }, (_, index) => {
  const center = RAY_BOX / 2;
  const half = Math.PI / RAY_COUNT / 2;
  const angle = (index * 2 * Math.PI) / RAY_COUNT;
  const a = { x: center + center * Math.cos(angle - half), y: center + center * Math.sin(angle - half) };
  const b = { x: center + center * Math.cos(angle + half), y: center + center * Math.sin(angle + half) };
  return `${center},${center} ${a.x},${a.y} ${b.x},${b.y}`;
});

function Rays({ color, reverse }: { color: string; reverse?: boolean }) {
  return (
    <svg
      aria-hidden
      width={RAY_BOX}
      height={RAY_BOX}
      className={`pointer-events-none absolute left-1/2 top-1/2 ${reverse ? 'lottery-rays-reverse' : 'lottery-rays'}`}
      style={{ marginLeft: -RAY_BOX / 2, marginTop: -RAY_BOX / 2 }}
    >
      {RAYS.map((points, index) => (
        <polygon key={index} points={points} fill={color} opacity={reverse ? 0.45 : 0.8} />
      ))}
    </svg>
  );
}

const makePieces = (count: number) =>
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
  const pieces = useMemo(() => makePieces(count), [count]);
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {pieces.map((piece, index) => (
        <span
          key={index}
          className={`lottery-confetti absolute ${piece.round ? 'h-2 w-2 rounded-full' : 'h-[11px] w-1.5 rounded-[1px]'}`}
          style={
            {
              backgroundColor: piece.color,
              '--dx': `${piece.dx}px`,
              '--dy': `${piece.dy}px`,
              '--turn': `${piece.turn}deg`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** 中身が弾むように出る（delay ミリ秒あとに）。 */
export function PopIn({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <span className={`lottery-pop ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </span>
  );
}

interface LotteryCelebrationProps {
  ball: SubsidyBallId;
  rate: SubsidyRate;
  height: number;
}

export default function LotteryCelebration({ ball, rate, height }: LotteryCelebrationProps) {
  // useId の値には「:」などが入り、url(#…) で読めないことがあるため英数字だけにする。
  const fadeId = `lotteryFade${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div className="relative flex w-full items-center justify-center overflow-hidden rounded-2xl" style={{ height }}>
      <Rays color={RAY_COLOR[ball]} />
      {ball === 'gold' && <Rays color="#fbbf24" reverse />}
      {/* 光の筋の先を、枠の地の色へぼかす（四角く切れて見えないように）。 */}
      <svg aria-hidden width="100%" height="100%" className="pointer-events-none absolute inset-0">
        <defs>
          <radialGradient id={fadeId} cx="50%" cy="50%" r="50%">
            <stop offset="0.55" stopColor="#ffffff" stopOpacity={0} />
            <stop offset="1" stopColor="#ffffff" stopOpacity={1} />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${fadeId})`} />
      </svg>
      <span className="absolute left-1/2 top-1/2 -ml-[75px] -mt-[75px] h-[150px] w-[150px] rounded-full bg-white/75" />
      <PopIn className="relative">
        <LotteryBall ball={ball} size={104} />
      </PopIn>
      <Confetti count={CONFETTI_COUNT[rate]} />
    </div>
  );
}
