import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTimeString } from '@/lib/dateUtils';
import {
  formatMinutesText,
  nextFeedingSchedule,
  type FeedingSchedule,
  type NextFeedingInfo,
} from '@/lib/feedingSchedule';
import { colors } from '@/lib/theme';
import BabyBottleIcon from '@/components/ui/BabyBottleIcon';

// 「次の授乳はいつだっけ」に、画面を見るだけで答えるためのホームのカード。
// Web版の `src/components/sukusuku/NextFeedingCard.tsx` と出す中身・並びを同じにしてある。

interface NextFeedingProps {
  info: NextFeedingInfo;
  /** タップしたときの動き。渡さなければタップできない表示になる。 */
  onOpen?: () => void;
}

/**
 * 残り時間の表示を進めるための時計。表示は分単位なので30秒ごとで足りる。
 * 画面を消している間はタイマーが間引かれるため、前面に戻ったら読み直す。
 */
const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timerId = setInterval(tick, 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timerId);
      subscription.remove();
    };
  }, []);
  return now;
};

/** 「あと1時間40分」「そろそろ」「20分すぎ」。 */
const remainingText = (schedule: FeedingSchedule): string => {
  if (!schedule.isOverdue) return `あと ${formatMinutesText(schedule.remainingMinutes)}`;
  return schedule.overdueMinutes === 0
    ? 'そろそろ'
    : `${formatMinutesText(schedule.overdueMinutes)}すぎ`;
};

/** ホーム用。目安の時刻・残り時間・前回からの進み具合をまとめて出す。 */
export default function NextFeedingCard({ info, onOpen }: NextFeedingProps) {
  const now = useNow();
  const schedule = nextFeedingSchedule(info.lastFedAt, info.intervalMinutes, now);

  const content = (
    <>
      <View style={styles.headerRow}>
        <View style={styles.headerLabel}>
          <BabyBottleIcon size={13} color={colors.milkText} />
          <Text style={styles.headerText}>次の授乳の目安</Text>
        </View>
        <Text style={styles.interval}>{formatMinutesText(info.intervalMinutes)}ごと</Text>
      </View>

      {info.isLoading && <Text style={styles.placeholder}>読み込み中...</Text>}

      {!info.isLoading && !schedule && (
        <Text style={styles.empty}>授乳を記録すると、次の目安の時刻が出ます。</Text>
      )}

      {schedule && (
        <>
          <View style={styles.dueRow}>
            <Text style={[styles.dueTime, schedule.isOverdue && styles.overdueText]}>
              {formatTimeString(schedule.dueAt)}
            </Text>
            <Text style={[styles.remaining, schedule.isOverdue && styles.overdueText]}>
              {remainingText(schedule)}
            </Text>
          </View>

          {/* 前回からいまへの進み具合。時刻を読まなくても目で分かるように。 */}
          <View style={styles.track}>
            <View
              style={[
                styles.trackFill,
                schedule.isOverdue && styles.trackFillOverdue,
                { width: `${Math.min(1, schedule.progress) * 100}%` },
              ]}
            />
          </View>

          <Text style={styles.lastFed}>
            前回 {formatTimeString(schedule.lastFedAt)}
            {info.lastFedTitle ? `（${info.lastFedTitle}）` : ''}
            {/* 設定した間隔が実際と合っているか確かめられるよう、実績も添える */}
            {info.averageIntervalMinutes !== null
              ? ` ・ 最近の平均 ${formatMinutesText(info.averageIntervalMinutes)}`
              : ''}
          </Text>
        </>
      )}
    </>
  );

  if (!onOpen) return <View style={styles.card}>{content}</View>;

  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.card}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerText: { fontSize: 12, fontWeight: '700', color: colors.milkText },
  interval: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  placeholder: { fontSize: 13, color: colors.textFaint, marginTop: 6 },
  empty: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
  dueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  dueTime: { fontSize: 24, fontWeight: '700', color: colors.text },
  remaining: { fontSize: 13, fontWeight: '700', color: colors.milk },
  overdueText: { color: colors.pumping },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.neutralSurface,
    overflow: 'hidden',
    marginTop: 6,
  },
  trackFill: { height: '100%', borderRadius: 999, backgroundColor: colors.milkProgress },
  trackFillOverdue: { backgroundColor: colors.pumping },
  lastFed: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
});
