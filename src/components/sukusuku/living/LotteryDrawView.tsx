'use client';

import { useId } from 'react';
import { BookOpen, Check, ChevronRight, CircleQuestionMark, Gift, History, Ticket, type LucideIcon } from 'lucide-react';
import type { SubsidyBallId } from '@/types/app';
import { ballOf, type DrawPlan } from '@/lib/subsidyLotteryUtils';
import GaraponMachine from './GaraponMachine';
import LotteryBall from './LotteryBall';

// お買いもの福引のホーム（docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/LotteryDrawView.tsx` と同じ項目・並び・文言。
//
// 福引所の1枚の面にまとめる: 福引券（残り回数）・ガラポン・今月のラッキーカラーなど・買いたいものと金額・「ガラポン！」。
// 賞品一覧・金コレ（金賞コレクション）・履歴・ヘルプは下のボタンから、画面の中央の枠で開く。持っている券は、あるときだけ右上のボタンから開く。
// 「ガラポン！」を押すと、この面のガラポンが回り、受け皿に玉が出てから結果の枠が開く。

export type LotteryDialogKind = 'prizes' | 'coupons' | 'collection' | 'history' | 'help';

/** 面の地の色（左上→右下）。 */
const HERO_FROM = '#dc2626';
const HERO_TO = '#f97316';

const MENU: { id: LotteryDialogKind; label: string; icon: LucideIcon }[] = [
  { id: 'prizes', label: '賞品一覧', icon: Gift },
  { id: 'collection', label: '金コレ', icon: BookOpen },
  { id: 'history', label: '履歴', icon: History },
  { id: 'help', label: 'ヘルプ', icon: CircleQuestionMark },
];

const inputClass =
  'w-full rounded-xl bg-white/95 px-3.5 py-2.5 text-[15px] tabular-nums text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:opacity-70';
const chipClass = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold';

interface LotteryDrawViewProps {
  plan: DrawPlan;
  isLoading: boolean;
  /** 今月あと何回引けるか。 */
  remaining: number;
  /** テストモード中か（回数が減らないので、枚数の表示を変える）。 */
  testMode: boolean;
  /** 使えるひと押し券の枚数と、使うか。 */
  pushCount: number;
  usePush: boolean;
  /** 使える券の枚数（1枚以上のときだけ「持っている券」のボタンを出す）。 */
  couponCount: number;
  onUsePush: (value: boolean) => void;
  itemName: string;
  priceText: string;
  onItemName: (value: string) => void;
  onPriceText: (value: string) => void;
  error: string | null;
  canDraw: boolean;
  onSubmit: () => void;
  /** ガラポンを回しているか。 */
  spinning: boolean;
  /** 受け皿に出た玉（回し終わる直前だけ）。 */
  dropBall: SubsidyBallId | null;
  onOpen: (dialog: LotteryDialogKind) => void;
}

export default function LotteryDrawView({
  plan,
  isLoading,
  remaining,
  testMode,
  pushCount,
  usePush,
  onUsePush,
  couponCount,
  itemName,
  priceText,
  onItemName,
  onPriceText,
  error,
  canDraw,
  onSubmit,
  spinning,
  dropBall,
  onOpen,
}: LotteryDrawViewProps) {
  const lucky = ballOf(plan.luckyBall);
  const editable = remaining > 0 && !spinning;
  // useId の値には「:」などが入り、url(#…) で読めないことがあるため英数字だけにする。
  const gradientId = `lotteryHome${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div className="relative mb-3 flex-1 min-h-0 overflow-hidden rounded-[20px]">
      <svg aria-hidden width="100%" height="100%" className="absolute inset-0">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={HERO_FROM} />
            <stop offset="1" stopColor={HERO_TO} />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gradientId})`} />
        <circle cx="92%" cy="8%" r={70} fill="#ffffff" opacity={0.08} />
        <circle cx="4%" cy="46%" r={48} fill="#ffffff" opacity={0.07} />
        <circle cx="80%" cy="62%" r={30} fill="#fde68a" opacity={0.14} />
      </svg>
      <div className="relative flex h-full flex-col justify-between gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 font-extrabold tabular-nums ${
              remaining > 0 || isLoading
                ? 'border-amber-400 bg-amber-200 text-[15px] text-red-900'
                : 'border-white/35 bg-white/20 text-[13px] text-white'
            }`}
          >
            <Ticket size={18} />
            {isLoading
              ? '福引券 …'
              : testMode
                ? '福引券 テスト中'
                : remaining > 0
                  ? `福引券 あと${remaining}回`
                  : '今月の福引券は使い切りました'}
          </p>
          {couponCount > 0 && (
            <button
              type="button"
              disabled={spinning}
              onClick={() => onOpen('coupons')}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/20 py-1.5 pl-3 pr-2 text-xs font-bold tabular-nums text-white transition hover:bg-white/30"
            >
              持っている券 {couponCount}
              <ChevronRight size={14} />
            </button>
          )}
        </div>

        <div className="flex justify-center">
          <GaraponMachine width={180} mode={spinning ? 'spin' : 'idle'} ball={dropBall} />
        </div>

        <div className="flex flex-wrap justify-center gap-1.5">
          <span className={`${chipClass} bg-white/20 text-white`}>
            今月のラッキーカラー
            <LotteryBall ball={plan.luckyBall} size={14} />
            {lucky.ball}
          </span>
          {plan.floor > 25 && (
            <span className={`${chipClass} bg-amber-400 text-red-900`}>
              {plan.floor === 100 ? '100%確定！' : `${plan.floor}%以上確定！`}
            </span>
          )}
          {pushCount > 0 && (
            <button
              type="button"
              role="switch"
              aria-checked={usePush}
              disabled={!editable}
              onClick={() => onUsePush(!usePush)}
              className={`${chipClass} transition disabled:opacity-60 ${
                usePush ? 'bg-amber-400 text-red-900' : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              {usePush && <Check size={14} />}
              ひと押し券を使う（{pushCount}）
            </button>
          )}
        </div>

        <div className="space-y-2">
          <input
            className={inputClass}
            value={itemName}
            onChange={(event) => onItemName(event.target.value)}
            placeholder="買いたいもの"
            disabled={!editable}
          />
          <input
            className={inputClass}
            value={priceText}
            onChange={(event) => onPriceText(event.target.value)}
            inputMode="numeric"
            placeholder="金額（例：2000）"
            disabled={!editable}
          />
          {error && <p className="text-center text-xs font-bold text-amber-200">{error}</p>}
          <button
            type="button"
            disabled={!canDraw}
            onClick={onSubmit}
            className={`w-full rounded-2xl border-2 py-3.5 text-xl font-extrabold tracking-widest transition active:opacity-85 ${
              canDraw || spinning
                ? 'border-amber-200 bg-amber-400 text-red-900 hover:bg-amber-300'
                : 'border-white/35 bg-white/25 text-white/80'
            } ${canDraw ? 'lottery-beat' : ''}`}
          >
            {spinning ? 'ガラガラガラ…' : 'ガラポン！'}
          </button>
        </div>

        <div className="flex justify-around">
          {MENU.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                disabled={spinning}
                onClick={() => onOpen(entry.id)}
                className="flex min-w-[60px] flex-col items-center gap-1 transition active:opacity-70"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30">
                  <Icon size={20} />
                </span>
                <span className="text-[11px] font-bold text-white">{entry.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
