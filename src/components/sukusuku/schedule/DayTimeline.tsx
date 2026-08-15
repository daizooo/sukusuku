'use client';

import type { CareLog } from '@/types/app';
import { getMilkMarksOnDate, getSleepBandsOnDate, type SleepBand } from './utils';

interface DayTimelineProps {
  /** 表示中の範囲の記録。前夜から続く睡眠を拾うため、日ごとに絞らずそのまま渡す。 */
  logs: CareLog[];
  day: Date;
  /** 計測中の睡眠をどこまで描くか。 */
  now: Date;
}

const toPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;

// 短い昼寝が消えないよう、帯には最低限の幅を持たせる（約9分ぶん）。
const MIN_BAND_WIDTH = 0.006;

const bandWidth = (band: SleepBand): string => toPercent(Math.max(band.end - band.start, MIN_BAND_WIDTH));

/**
 * 1日を0時から24時までの横1本にした帯。睡眠を面で、授乳を印で出す。
 * 週表示で縦に7日並ぶため、まとまって寝られているか・昼夜が逆転していないかを
 * 見比べられる。細かい時刻は日表示と記録タブで見る。
 */
export default function DayTimeline({ logs, day, now }: DayTimelineProps) {
  const bands = getSleepBandsOnDate(logs, day, now);
  const milkMarks = getMilkMarksOnDate(logs, day);

  // 何も描くものがない日は、空の枠だけが並ばないよう出さない。
  if (bands.length === 0 && milkMarks.length === 0) return null;

  return (
    <div
      role="img"
      aria-label={`0時から24時の睡眠${bands.length}本と授乳${milkMarks.length}回`}
      className="relative h-4 rounded bg-gray-100 overflow-hidden"
    >
      {/* 6時・12時・18時の目盛り */}
      {[0.25, 0.5, 0.75].map((at) => (
        <span key={at} className="absolute inset-y-0 w-px bg-gray-200" style={{ left: toPercent(at) }} />
      ))}

      {bands.map((band, i) => (
        <span
          key={`sleep-${i}`}
          className={`absolute inset-y-0 ${band.inProgress ? 'bg-indigo-300' : 'bg-indigo-400'}`}
          style={{ left: toPercent(band.start), width: bandWidth(band) }}
        />
      ))}

      {milkMarks.map((at, i) => (
        <span
          key={`milk-${i}`}
          className="absolute top-0 h-1.5 w-0.5 bg-amber-500"
          style={{ left: toPercent(at) }}
        />
      ))}
    </div>
  );
}
