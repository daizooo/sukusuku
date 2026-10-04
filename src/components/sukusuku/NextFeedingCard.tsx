'use client';

import { useEffect, useState } from 'react';
import { formatTimeString } from '@/lib/dateUtils';
import {
  formatMinutesText,
  nextFeedingSchedule,
  resolveLastFeeding,
  type FeedingSchedule,
  type NextFeedingInfo,
} from '@/lib/feedingSchedule';
import BabyBottleIcon from './ui/BabyBottleIcon';

// 「次の授乳はいつだっけ」に、画面を見るだけで答えるためのホームのカード。
// 記録タブにも1行の帯を出していたが、同じことを2か所で言っていて
// タイムラインの場所を取るだけだったのでやめた（表示はホームだけ）。
//
// 目安の起点は「前回の授乳」。保存済みの記録だけでなく、まだ記録に入っていない
// 授乳（母乳の計測中・記録待ち）も起点として扱う（lib/feedingSchedule.ts）。

interface NextFeedingProps {
  info: NextFeedingInfo;
  /** 「生後48日目（1ヶ月17日）」。空なら出さない。次の授乳と1枚のカードにまとめて出す。 */
  babyAge?: string;
  /** タップしたときの動き。渡さなければタップできない表示になる。 */
  onOpen?: () => void;
}

/**
 * 残り時間の表示を進めるための時計。表示は分単位なので30秒ごとで足りる。
 * 画面を消している間はブラウザがタイマーを間引くため、戻ってきたら読み直す。
 */
const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timerId = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timerId);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
};

/** 「あと1時間40分」「そろそろ」「20分すぎ」。 */
const remainingText = (schedule: FeedingSchedule): string => {
  if (!schedule.isOverdue) return `あと ${formatMinutesText(schedule.remainingMinutes)}`;
  return schedule.overdueMinutes === 0 ? 'そろそろ' : `${formatMinutesText(schedule.overdueMinutes)}すぎ`;
};

/**
 * 育児タブの見出し用。生後日数と、次の授乳の目安（時刻・残り時間・前回からの進み具合）を
 * 琥珀色の1枚にまとめて出す。下の「日付ごとの記録」のパネルと色で分ける。
 */
export default function NextFeedingCard({ info, babyAge, onOpen }: NextFeedingProps) {
  const now = useNow();
  // 母乳は測り終えて保存するまで記録に入らない。その間も前回の授乳として数える
  // （そうしないと、飲ませ終えた直後に「◯分すぎ」と赤く出てしまう）。
  const last = resolveLastFeeding(info.lastFedAt, info.pendingNursing);
  const schedule = nextFeedingSchedule(last.lastFedAt, info.intervalMinutes, now);

  const content = (
    <>
      {/* 生後日数。カードの見出しとして一番大きく出し、下の次の授乳とは罫線で区切る。 */}
      {babyAge && (
        <p className="pb-2.5 mb-2.5 border-b border-amber-200 text-base font-bold text-gray-900">{babyAge}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-amber-700 flex items-center">
          <BabyBottleIcon size={13} className="mr-1" />
          次の授乳の目安
        </span>
        <span className="text-[11px] text-gray-500 font-medium">
          {formatMinutesText(info.intervalMinutes)}ごと
        </span>
      </div>

      {info.isLoading && <p className="mt-1.5 text-sm text-gray-400">読み込み中...</p>}

      {/* 飲ませている最中は、終わる時刻が分からないので目安を出しようがない。
          前の授乳の目安を過ぎた赤い表示のままにせず、いまの様子をそのまま出す。 */}
      {last.isNursing && <p className="mt-0.5 text-xl font-bold text-amber-700">いま授乳中です</p>}

      {!info.isLoading && !last.isNursing && !schedule && (
        <p className="mt-1.5 text-sm text-gray-500">授乳を記録すると、次の目安の時刻が出ます。</p>
      )}

      {schedule && (
        <>
          <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
            <span
              className={`text-[28px] leading-tight font-bold tabular-nums tracking-tight ${
                schedule.isOverdue ? 'text-rose-600' : 'text-gray-900'
              }`}
            >
              {formatTimeString(schedule.dueAt)}
            </span>
            <span className={`text-sm font-bold ${schedule.isOverdue ? 'text-rose-600' : 'text-amber-600'}`}>
              {remainingText(schedule)}
            </span>
          </div>

          {/* 記録より先に目安を進めているので、そう分かるようにしておく。
              記録し忘れたまま放っておかれないよう、ここから入力画面へ促す。 */}
          {last.isPendingRecord && (
            <p className="mt-1 text-[11px] font-medium text-amber-700">授乳の記録がまだです。忘れないうちに記録を。</p>
          )}

          {/* 前回からいまへの進み具合。時刻を読まなくても目で分かるように。 */}
          <div className="mt-2 h-1.5 rounded-full bg-amber-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                schedule.isOverdue ? 'bg-rose-500' : 'bg-amber-400'
              }`}
              style={{ width: `${schedule.progress * 100}%` }}
            />
          </div>
        </>
      )}
    </>
  );

  const className = 'w-full text-left bg-amber-50 rounded-[20px] border border-amber-200 px-4 py-3.5';

  if (!onOpen) return <div className={className}>{content}</div>;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${className} hover:bg-amber-100/60 transition active:scale-[0.99]`}
    >
      {content}
    </button>
  );
}
