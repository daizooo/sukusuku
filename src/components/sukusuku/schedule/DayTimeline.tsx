'use client';

import type { CareLog } from '@/types/app';
import { getMilkMarksOnDate, getSleepBandsOnDate, type SleepBand } from './utils';

/** 帯の使い方。週表示は7日ぶんを並べるので細く、日表示は1日だけなので太く出す。 */
type TimelineVariant = 'week' | 'day';

interface DayTimelineProps {
  /** 表示中の範囲の記録。前夜から続く睡眠を拾うため、日ごとに絞らずそのまま渡す。 */
  logs: CareLog[];
  day: Date;
  /** 計測中の睡眠をどこまで描くか。 */
  now: Date;
  variant?: TimelineVariant;
}

const toPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;

// 短い昼寝が消えないよう、帯には最低限の幅を持たせる（約9分ぶん）。
const MIN_BAND_WIDTH = 0.006;

const bandWidth = (band: SleepBand): string => toPercent(Math.max(band.end - band.start, MIN_BAND_WIDTH));

/** 0時を0、24時を1とした目盛りの位置。 */
const at = (hour: number): number => hour / 24;

/** 目盛りの数字。帯の下（週表示では7本の帯の上）に1本だけ置く。 */
export function TimelineScale() {
  return (
    <div className="flex justify-between text-[10px] text-gray-400 tabular-nums">
      {[0, 6, 12, 18, 24].map((hour) => (
        <span key={hour}>{hour}時</span>
      ))}
    </div>
  );
}

/**
 * 1日を0時から24時までの横1本にした帯。睡眠を面で、授乳を印で出す。
 *
 * 週表示では7日ぶんが縦に並ぶため、まとまって寝られているか・昼夜が逆転して
 * いないかを見比べられる。日表示は1日しか出さないぶん帯を太く取れるので、
 * 30分の昼寝のような細い面でも潰れずに読める。細かい時刻は記録の一覧で見る。
 */
export default function DayTimeline({ logs, day, now, variant = 'week' }: DayTimelineProps) {
  const bands = getSleepBandsOnDate(logs, day, now);
  const milkMarks = getMilkMarksOnDate(logs, day);
  const isDay = variant === 'day';

  // 何も描くものがない日は、空の枠だけが並ばないよう出さない。
  if (bands.length === 0 && milkMarks.length === 0) return null;

  const track = (
    <div
      role="img"
      aria-label={`0時から24時の睡眠${bands.length}本と授乳${milkMarks.length}回`}
      className={`relative overflow-hidden bg-gray-100 ${isDay ? 'h-9 rounded-lg' : 'h-4 rounded'}`}
    >
      {/* 日表示は帯が太く時刻を追いやすいので、3時間ごとの薄い目盛りも足す。 */}
      {isDay &&
        [3, 9, 15, 21].map((hour) => (
          <span key={hour} className="absolute inset-y-0 w-px bg-gray-200/70" style={{ left: toPercent(at(hour)) }} />
        ))}

      {/* 6時・12時・18時の目盛り */}
      {[6, 12, 18].map((hour) => (
        <span key={hour} className="absolute inset-y-0 w-px bg-gray-200" style={{ left: toPercent(at(hour)) }} />
      ))}

      {bands.map((band, i) => (
        <span
          key={`sleep-${i}`}
          className={`absolute inset-y-0 ${band.inProgress ? 'bg-indigo-300' : 'bg-indigo-400'}`}
          style={{ left: toPercent(band.start), width: bandWidth(band) }}
        />
      ))}

      {/* 授乳の印。帯を貫かせると睡眠が途切れたように見えるため、上から短く下ろす。 */}
      {milkMarks.map((mark, i) => (
        <span
          key={`milk-${i}`}
          className={`absolute top-0 w-0.5 bg-amber-500 ${isDay ? 'h-2.5' : 'h-1.5'}`}
          style={{ left: toPercent(mark) }}
        />
      ))}
    </div>
  );

  // 日表示は帯が1本だけなので、目盛りの数字も帯とひとまとまりで出す。
  if (!isDay) return track;

  return (
    <div className="space-y-1">
      {track}
      <TimelineScale />
    </div>
  );
}
