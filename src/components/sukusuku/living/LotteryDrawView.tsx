'use client';

import { useId, useState } from 'react';
import { CircleQuestionMark, Sparkles } from 'lucide-react';
import type { SubsidyBallId } from '@/types/app';
import {
  BALLS,
  MONTHLY_LIMIT,
  NOTE_TEXT,
  PRICE_MAX,
  PRICE_MIN,
  ballOf,
  type DrawPlan,
} from '@/lib/subsidyLotteryUtils';
import GaraponMachine from './GaraponMachine';
import LotteryBall, { BALL_COLOR } from './LotteryBall';
import LotteryHelpModal from './LotteryHelpModal';

// 補助くじの「くじ」の面（docs/home.md §9）。mobile版の
// `mobile/src/components/living/LotteryDrawView.tsx` と同じ項目・並び・文言。
// ルール・今月の福引券・今回の救済・入力・補助率ごとの確率。
//
// 福引所らしく見せる: 上は紅白ののれん色の看板（ガラポンの絵・福引券）、ラッキーカラーの玉は光り、
// 「ガラポン！」は脈打つ大きなボタン、確率は賞品一覧（玉・賞の名前・補助率・確率の棒）にする。

interface LotteryDrawViewProps {
  plan: DrawPlan;
  isLoading: boolean;
  /** 今月引ける回数（誕生月は3回）と、あと何回か。 */
  allowance: number;
  remaining: number;
  /** テストモード中か（回数が減らないので、枚数の表示を変える）。 */
  testMode: boolean;
  /** 使えるひと押し券の枚数と、使うか。 */
  pushCount: number;
  usePush: boolean;
  onUsePush: (value: boolean) => void;
  itemName: string;
  priceText: string;
  onItemName: (value: string) => void;
  onPriceText: (value: string) => void;
  error: string | null;
  canDraw: boolean;
  onSubmit: () => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-[15px] tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100';
const cardClass = 'space-y-2 rounded-xl border border-gray-200 bg-white p-3';

/** 看板の地の色（左上→右下）。 */
const HERO_FROM = '#dc2626';
const HERO_TO = '#f97316';

/** 福引券1枚（左右に切り欠きのある券）。残っている券は金色、使った券は薄く。 */
function FukubikiTicket({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-[26px] w-10 items-center justify-center">
      <svg aria-hidden width={40} height={26} viewBox="0 0 40 26" className="absolute inset-0">
        <path
          d="M0,0 H40 V8 A5,5 0 0 0 40,18 V26 H0 V18 A5,5 0 0 0 0,8 Z"
          fill={active ? '#fde68a' : 'rgba(255,255,255,0.18)'}
          stroke={active ? '#b45309' : 'rgba(255,255,255,0.5)'}
          strokeWidth={1.5}
          strokeDasharray={active ? undefined : '3,2'}
        />
      </svg>
      <span className={`relative text-[13px] font-extrabold ${active ? 'text-amber-700' : 'text-white/55'}`}>福</span>
    </span>
  );
}

/** ラッキーカラーの玉。まわりに光の輪が広がる。 */
function GlowingBall({ ball }: { ball: SubsidyBallId }) {
  return (
    <span className="relative flex h-[30px] w-[30px] shrink-0 items-center justify-center">
      <span
        aria-hidden
        className="lottery-ring absolute h-[26px] w-[26px] rounded-full border-[3px]"
        style={{ borderColor: BALL_COLOR[ball].edge }}
      />
      <LotteryBall ball={ball} size={26} />
    </span>
  );
}

export default function LotteryDrawView({
  plan,
  isLoading,
  allowance,
  remaining,
  testMode,
  pushCount,
  usePush,
  onUsePush,
  itemName,
  priceText,
  onItemName,
  onPriceText,
  error,
  canDraw,
  onSubmit,
}: LotteryDrawViewProps) {
  const lucky = ballOf(plan.luckyBall);
  const [helpOpen, setHelpOpen] = useState(false);
  // useId の値には「:」などが入り、url(#…) で読めないことがあるため英数字だけにする。
  const gradientId = `lotteryHero${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-6">
      <div className="relative space-y-1.5 overflow-hidden rounded-2xl p-3.5">
        <svg aria-hidden width="100%" height="100%" className="absolute inset-0">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={HERO_FROM} />
              <stop offset="1" stopColor={HERO_TO} />
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${gradientId})`} />
          <circle cx="88%" cy="18%" r={46} fill="#ffffff" opacity={0.08} />
          <circle cx="8%" cy="92%" r={34} fill="#ffffff" opacity={0.08} />
          <circle cx="60%" cy="105%" r={22} fill="#fde68a" opacity={0.18} />
        </svg>
        <div className="relative flex items-center justify-between">
          <p className="text-[19px] font-extrabold tracking-wider text-white">✦ ガラポン福引所 ✦</p>
          <button
            type="button"
            aria-label="補助くじのルールを見る"
            onClick={() => setHelpOpen(true)}
            className="shrink-0 rounded-full text-white hover:text-amber-100 transition"
          >
            <CircleQuestionMark size={22} />
          </button>
        </div>
        <p className="relative text-xs text-white/90">
          趣味以外で必要なもの・税込{PRICE_MIN.toLocaleString('ja-JP')}〜{PRICE_MAX.toLocaleString('ja-JP')}円なら、
          月{MONTHLY_LIMIT}回（誕生月は{MONTHLY_LIMIT + 1}回）まで、家族のお金から補助が出ます
        </p>
        <div className="relative flex items-center gap-3 pt-0.5">
          <GaraponMachine width={116} mode="idle" />
          <div className="flex-1 space-y-1.5">
            <p className="text-xs font-bold text-amber-200">今月の福引券</p>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: allowance }, (_, index) => (
                <FukubikiTicket key={index} active={index < remaining} />
              ))}
            </div>
            <p className="text-lg font-extrabold tabular-nums text-white">
              {isLoading ? '…' : testMode ? 'テスト中（減りません）' : remaining > 0 ? `あと${remaining}回` : '使い切りました'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-center gap-2.5">
          <GlowingBall ball={plan.luckyBall} />
          <p className="text-[13px] font-bold text-amber-700">今月のラッキーカラーは{lucky.ball}。出たら補助率が1段アップ</p>
        </div>
        {plan.notes.map((note) => (
          <p key={note} className="text-xs text-gray-700">
            {NOTE_TEXT[note]}
          </p>
        ))}
        {plan.floor > 25 && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-sm font-bold text-green-700">
            <Sparkles size={16} />
            今回は{plan.floor === 100 ? '100%が確定！' : `${plan.floor}%以上が確定！`}
          </p>
        )}
        {pushCount > 0 && (
          <label className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-gray-900">ひと押し券を使う（{pushCount}枚）</span>
            <input
              type="checkbox"
              checked={usePush}
              onChange={(event) => onUsePush(event.target.checked)}
              disabled={remaining <= 0}
              className="h-5 w-5 accent-blue-500"
            />
          </label>
        )}
      </div>

      <div className={cardClass}>
        <input
          className={inputClass}
          value={itemName}
          onChange={(event) => onItemName(event.target.value)}
          placeholder="買うもの（例: 洗濯ネット）"
          disabled={remaining <= 0}
        />
        <input
          className={inputClass}
          value={priceText}
          onChange={(event) => onPriceText(event.target.value)}
          inputMode="numeric"
          placeholder="税込の価格（円）"
          disabled={remaining <= 0}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="button"
          disabled={!canDraw}
          onClick={onSubmit}
          className={`flex w-full items-center justify-center gap-2 rounded-[14px] border-2 border-amber-400 bg-red-600 py-3.5 text-[19px] font-extrabold tracking-widest text-white transition hover:bg-red-700 active:opacity-85 disabled:border-gray-300 disabled:bg-gray-300 disabled:hover:bg-gray-300 ${canDraw ? 'lottery-beat' : ''}`}
        >
          <Sparkles size={20} className={canDraw ? 'text-amber-200' : 'text-white'} />
          ガラポン！
          <Sparkles size={20} className={canDraw ? 'text-amber-200' : 'text-white'} />
        </button>
      </div>

      <div className="space-y-1.5 rounded-xl border border-gray-200 bg-white p-3">
        <p className="text-[13px] font-extrabold text-gray-900">賞品一覧</p>
        {plan.odds.map((entry) => {
          const ball = BALLS.find((item) => item.rate === entry.rate) ?? BALLS[0];
          return (
            <div key={entry.rate} className={`flex items-center gap-2 ${entry.percent === 0 ? 'opacity-40' : ''}`}>
              <LotteryBall ball={ball.id} size={20} />
              <span className="w-[84px] truncate text-xs font-bold text-gray-700">{ball.name}</span>
              <span className="w-[38px] text-[13px] font-extrabold tabular-nums text-gray-900">{entry.rate}%</span>
              <span className="h-2 flex-1 overflow-hidden rounded bg-gray-100">
                <span
                  className="block h-full rounded"
                  style={{ width: `${entry.percent}%`, backgroundColor: BALL_COLOR[ball.id].edge }}
                />
              </span>
              <span className="w-9 text-right text-xs font-bold tabular-nums text-gray-500">{entry.percent}%</span>
            </div>
          );
        })}
        <p className="text-[10px] text-gray-400">棒と右の数字は今回の出る確率（救済を含む）</p>
      </div>
      {helpOpen && <LotteryHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
