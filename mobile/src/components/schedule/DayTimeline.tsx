import { StyleSheet, Text, View } from 'react-native';
import type { CareLog } from '@/types/app';
import { colors } from '@/lib/theme';
import { getMilkMarksOnDate } from '@/lib/scheduleUtils';

// 1日を0時から24時までの横1本にした帯。授乳を印で出す。
// Web版の `src/components/sukusuku/schedule/DayTimeline.tsx` と同じ。
//
// 週表示では7日ぶんが縦に並ぶため、授乳の間隔がそろってきたか・夜間にどれだけ
// 起こされているかを見比べられる。日表示は1日しか出さないぶん帯を太く取れる。
// 細かい時刻は記録の一覧で見る。

/** 帯の使い方。週表示は7日ぶんを並べるので細く、日表示は1日だけなので太く出す。 */
type TimelineVariant = 'week' | 'day';

interface DayTimelineProps {
  /** 表示中の範囲の記録。日ごとの絞り込みは中で行う。 */
  logs: CareLog[];
  day: Date;
  variant?: TimelineVariant;
}

/** 0時を0、24時を1とした目盛りの位置。 */
const at = (hour: number): number => hour / 24;

const toPercent = (value: number): `${number}%` => `${Number((value * 100).toFixed(2))}%`;

/** 目盛りの数字。帯の下（週表示では7本の帯の上）に1本だけ置く。 */
export function TimelineScale() {
  return (
    <View style={styles.scale}>
      {[0, 6, 12, 18, 24].map((hour) => (
        <Text key={hour} style={styles.scaleText}>
          {hour}時
        </Text>
      ))}
    </View>
  );
}

export default function DayTimeline({ logs, day, variant = 'week' }: DayTimelineProps) {
  const milkMarks = getMilkMarksOnDate(logs, day);
  const isDay = variant === 'day';

  // 何も描くものがない日は、空の枠だけが並ばないよう出さない。
  if (milkMarks.length === 0) return null;

  const track = (
    <View
      accessibilityRole="image"
      accessibilityLabel={`0時から24時の授乳${milkMarks.length}回`}
      style={[styles.track, isDay ? styles.trackDay : styles.trackWeek]}
    >
      {/* 日表示は帯が太く時刻を追いやすいので、3時間ごとの薄い目盛りも足す。 */}
      {isDay &&
        [3, 9, 15, 21].map((hour) => (
          <View key={hour} style={[styles.tick, styles.tickFaint, { left: toPercent(at(hour)) }]} />
        ))}

      {/* 6時・12時・18時の目盛り */}
      {[6, 12, 18].map((hour) => (
        <View key={hour} style={[styles.tick, { left: toPercent(at(hour)) }]} />
      ))}

      {/* 授乳の印。 */}
      {milkMarks.map((mark, i) => (
        <View key={`milk-${i}`} style={[styles.mark, { left: toPercent(mark) }]} />
      ))}
    </View>
  );

  // 日表示は帯が1本だけなので、目盛りの数字も帯とひとまとまりで出す。
  if (!isDay) return track;

  return (
    <View style={styles.dayGroup}>
      {track}
      <TimelineScale />
    </View>
  );
}

const styles = StyleSheet.create({
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  scaleText: { fontSize: 10, color: colors.textFaint },
  track: { position: 'relative', overflow: 'hidden', backgroundColor: colors.neutralSurface },
  trackWeek: { height: 16, borderRadius: 4 },
  trackDay: { height: 36, borderRadius: 8 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.border },
  tickFaint: { opacity: 0.6 },
  mark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.timelineMark },
  dayGroup: { gap: 4 },
});
