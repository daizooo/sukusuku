import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Droplet, Milk, Thermometer } from 'lucide-react-native';
import type { CareLog } from '@/types/app';
import {
  BADGE_TONE_COLORS,
  formatCelsius,
  getLogBadges,
  getLogTimeText,
  getLogTitle,
  isAlertLog,
  summarizeLogs,
} from '@/lib/careLogUtils';
import { colors } from '@/lib/theme';
import BabyBottleIcon from '@/components/ui/BabyBottleIcon';

// 予定タブに出す育児記録。Web版の
// `src/components/sukusuku/schedule/CareLogSection.tsx` を置き換えたもの。

interface CareLogSummaryProps {
  logs: CareLog[];
}

/** その日の合計を1行にまとめたもの。週表示・日表示で共通して使う。 */
export function CareLogSummaryLine({ logs }: CareLogSummaryProps) {
  const summary = summarizeLogs(logs);
  if (logs.length === 0) return <Text style={styles.empty}>記録なし</Text>;

  return (
    <View style={styles.summary}>
      <View style={styles.summaryItem}>
        <BabyBottleIcon size={12} color={colors.milk} />
        <Text style={styles.summaryText}>{summary.milk.count}回</Text>
        {summary.milk.ml > 0 && <Text style={styles.summaryText}>{summary.milk.ml}ml</Text>}
      </View>
      <View style={styles.summaryItem}>
        <Droplet size={12} color={colors.diaper} />
        <Text style={styles.summaryText}>{summary.diaper.count}回</Text>
        {summary.diaper.poopCount > 0 && (
          <Text style={styles.summaryText}>(💩{summary.diaper.poopCount})</Text>
        )}
      </View>
      <View style={styles.summaryItem}>
        <Milk size={12} color={colors.pumping} />
        <Text style={styles.summaryText}>{summary.pumping.count}回</Text>
        {summary.pumping.ml > 0 && <Text style={styles.summaryText}>{summary.pumping.ml}ml</Text>}
      </View>
      {/* 体温は無い日のほうが多いので、その日にあったときだけ並べる。 */}
      {summary.temperature.count > 0 && (
        <View style={styles.summaryItem}>
          <Thermometer size={12} color={colors.temperature} />
          <Text style={styles.summaryText}>{summary.temperature.count}回</Text>
          {summary.temperature.maxCelsius !== null && (
            <Text style={styles.summaryText}>
              最高 {formatCelsius(summary.temperature.maxCelsius)}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

interface CareLogSectionProps {
  logs: CareLog[];
  isLoading?: boolean;
  /** 合計の上に置く24時間の帯。 */
  timeline?: ReactNode;
  onOpenLogTab: () => void;
}

/**
 * 日表示に出す育児記録。ここでは閲覧だけを行い、追加・編集は記録タブに任せる
 * （同じ入力導線を2か所に置かないため）。
 */
export default function CareLogSection({
  logs,
  isLoading,
  timeline,
  onOpenLogTab,
}: CareLogSectionProps) {
  // 記録タブは最新が上だが、1日の流れを追う面なので古い順に並べる。
  const ordered = [...logs].sort((a, b) => a.time.getTime() - b.time.getTime());

  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          育児記録 {logs.length > 0 ? `(${logs.length}件)` : ''}
        </Text>
        <Pressable accessibilityRole="button" onPress={onOpenLogTab} style={styles.link}>
          <Text style={styles.linkText}>記録タブで開く</Text>
          <ChevronRight size={14} color={colors.navActive} />
        </Pressable>
      </View>

      {isLoading ? (
        <Text style={styles.loading}>読み込み中...</Text>
      ) : (
        <View style={styles.card}>
          {timeline}
          <CareLogSummaryLine logs={logs} />

          {ordered.length > 0 && (
            <View style={styles.list}>
              {ordered.map((log) => (
                <View key={log.id} style={styles.logRow}>
                  <Text style={styles.logTime}>{getLogTimeText(log)}</Text>
                  <Text style={[styles.logTitle, isAlertLog(log) && styles.logTitleAlert]}>
                    {getLogTitle(log)}
                  </Text>
                  <View style={styles.badges}>
                    {getLogBadges(log).map((badge, i) => {
                      const tone = BADGE_TONE_COLORS[badge.tone];
                      return (
                        <View
                          key={`${badge.text}-${i}`}
                          style={[styles.badge, { backgroundColor: tone.background }]}
                        >
                          <Text
                            style={[
                              styles.badgeText,
                              { color: tone.text },
                              tone.bold && styles.badgeTextBold,
                            ]}
                          >
                            {badge.text}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 11, color: colors.textFaint, fontWeight: '500' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryText: { fontSize: 11, color: colors.textSubtle, fontWeight: '500', fontVariant: ['tabular-nums'] },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  link: { flexDirection: 'row', alignItems: 'center' },
  linkText: { fontSize: 12, fontWeight: '500', color: colors.navActive },
  loading: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  list: { borderTopWidth: 1, borderTopColor: colors.background, paddingTop: 4 },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  logTime: { width: 52, fontSize: 12, color: colors.textMuted, fontWeight: '500', fontVariant: ['tabular-nums'] },
  logTitle: { fontSize: 12, fontWeight: '500', color: colors.textSubtle },
  logTitleAlert: { color: colors.danger },
  badges: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginLeft: 8 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '500', fontVariant: ['tabular-nums'] },
  badgeTextBold: { fontWeight: '700' },
});
