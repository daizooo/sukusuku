import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTimeString } from '@/lib/dateUtils';
import {
  formatMinutesText,
  nextFeedingSchedule,
  resolveLastFeeding,
  type FeedingSchedule,
  type NextFeedingInfo,
} from '@/lib/feedingSchedule';
import { colors } from '@/lib/theme';
import BabyBottleIcon from '@/components/ui/BabyBottleIcon';

// 「次の授乳はいつだっけ」に、画面を見るだけで答えるためのホームのカード。
//
// 目安の起点は「前回の授乳」。保存済みの記録だけでなく、まだ記録に入っていない
// 授乳（母乳の計測中・記録待ち）も起点として扱う（src/lib/feedingSchedule.ts）。

interface NextFeedingProps {
  info: NextFeedingInfo;
  /** 「生後48日目（1ヶ月17日）」。空なら出さない。次の授乳と1枚のカードにまとめて出す。 */
  babyAge?: string;
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
      {!!babyAge && (
        <View style={styles.ageRow}>
          <Text style={styles.ageText}>{babyAge}</Text>
        </View>
      )}

      <View style={styles.headerRow}>
        <View style={styles.headerLabel}>
          <BabyBottleIcon size={13} color={colors.milkText} />
          <Text style={styles.headerText}>次の授乳の目安</Text>
        </View>
        <Text style={styles.interval}>{formatMinutesText(info.intervalMinutes)}ごと</Text>
      </View>

      {info.isLoading && <Text style={styles.placeholder}>読み込み中...</Text>}

      {/* 飲ませている最中は、終わる時刻が分からないので目安を出しようがない。
          前の授乳の目安を過ぎた赤い表示のままにせず、いまの様子をそのまま出す。 */}
      {last.isNursing && <Text style={styles.nursing}>いま授乳中です</Text>}

      {!info.isLoading && !last.isNursing && !schedule && (
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

          {/* 記録より先に目安を進めているので、そう分かるようにしておく。
              記録し忘れたまま放っておかれないよう、ここから入力画面へ促す。 */}
          {last.isPendingRecord && (
            <Text style={styles.pending}>授乳の記録がまだです。忘れないうちに記録を。</Text>
          )}

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

// カードの色。amber-50/200 よりもう一段薄くして、下の記録パネルを引き立てる。
// このカードだけで使うのでテーマには足さない。
const CARD_SURFACE = '#fffdf5';
const CARD_BORDER = colors.milkBadge; // amber-100
const TRACK_SURFACE = '#fef6dc';

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_SURFACE,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  // 生後日数。カードの見出しとして一番大きく出し、下の次の授乳とは罫線で区切る。
  ageRow: {
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  ageText: { fontSize: 16, fontWeight: '700', color: colors.text },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerText: { fontSize: 12, fontWeight: '700', color: colors.milkText },
  interval: { fontSize: 11, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  placeholder: { fontSize: 13, color: colors.textFaint, marginTop: 6, fontWeight: '500' },
  empty: { fontSize: 13, color: colors.textMuted, marginTop: 6, fontWeight: '500' },
  nursing: { fontSize: 20, fontWeight: '700', color: colors.milkText, marginTop: 2 },
  pending: { fontSize: 11, fontWeight: '500', color: colors.milkText, marginTop: 4 },
  dueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  dueTime: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  remaining: { fontSize: 13, fontWeight: '700', color: colors.milk, fontVariant: ['tabular-nums'] },
  overdueText: { color: colors.pumping },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: TRACK_SURFACE,
    overflow: 'hidden',
    marginTop: 8,
  },
  trackFill: { height: '100%', borderRadius: 999, backgroundColor: colors.milkProgress },
  trackFillOverdue: { backgroundColor: colors.pumping },
});
