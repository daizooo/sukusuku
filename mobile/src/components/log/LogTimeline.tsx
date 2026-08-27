import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CareLog } from '@/types/app';
import {
  BADGE_TONE_COLORS,
  getLogBadges,
  getLogTimeText,
  getLogTitle,
  isAlertLog,
} from '@/lib/careLogUtils';
import { isLocalCareLogId } from '@/lib/offline/careLogs';
import { colors } from '@/lib/theme';

// その日の記録の一覧。Web版の記録タブのタイムラインにあたる。
//
// 入力画面があるのは授乳・体温・吐き戻しなので、開いて直せるのもその3つ。
// おむつ・搾乳も同じ並びに出すが、タップしても開かない（フェーズ2でそれぞれの入力画面を作る）。

const TYPE_COLOR: Record<CareLog['type'], string> = {
  milk: colors.milk,
  diaper: colors.diaper,
  pumping: colors.pumping,
  temperature: colors.temperature,
  spitup: colors.spitup,
};

/** 入力画面があり、タップして直せる記録か。 */
const EDITABLE_TYPES: CareLog['type'][] = ['milk', 'temperature', 'spitup'];

const isEditable = (log: CareLog): boolean => EDITABLE_TYPES.includes(log.type);

interface LogTimelineProps {
  logs: CareLog[];
  memberLabel: (id: string | null) => string;
  /** 入力画面のある記録（授乳・体温・吐き戻し）をタップしたとき。 */
  onSelect: (log: CareLog) => void;
}

export default function LogTimeline({ logs, memberLabel, onSelect }: LogTimelineProps) {
  return (
    <View style={styles.list}>
      {logs.map((log) => {
        const editable = isEditable(log);
        return (
          <Pressable
            key={log.id}
            accessibilityRole={editable ? 'button' : undefined}
            disabled={!editable}
            onPress={() => editable && onSelect(log)}
            style={[styles.card, isAlertLog(log) && styles.alertCard]}
          >
            <View style={[styles.dot, { backgroundColor: TYPE_COLOR[log.type] }]} />
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{getLogTitle(log)}</Text>
                <Text style={styles.time}>{getLogTimeText(log)}</Text>
              </View>

              <Badges log={log} />

              <View style={styles.footer}>
                <Text style={styles.note} numberOfLines={2}>
                  {log.note || 'メモなし'}
                </Text>
                <Text style={styles.author}>{memberLabel(log.createdBy)}が記録</Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Badges({ log }: { log: CareLog }) {
  const badges = getLogBadges(log);
  // まだ送れていない記録は、この端末の中にしか無いことが分かるようにしておく。
  const unsent = isLocalCareLogId(log.id);
  if (badges.length === 0 && !unsent) return null;

  return (
    <View style={styles.badges}>
      {badges.map((badge) => {
        const tone = BADGE_TONE_COLORS[badge.tone];
        return (
          <View key={badge.text} style={[styles.badge, { backgroundColor: tone.background }]}>
            {badge.swatch && <View style={[styles.swatch, { backgroundColor: badge.swatch }]} />}
            <Text style={[styles.badgeText, { color: tone.text }]}>{badge.text}</Text>
          </View>
        );
      })}
      {unsent && (
        <View style={[styles.badge, { backgroundColor: colors.neutralSurface }]}>
          <Text style={[styles.badgeText, { color: colors.textMuted }]}>未送信</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  alertCard: { borderColor: colors.danger, borderLeftWidth: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  time: { fontSize: 12, color: colors.textMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11 },
  swatch: { width: 9, height: 9, borderRadius: 5 },
  footer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  note: { flex: 1, fontSize: 12, color: colors.textMuted },
  author: { fontSize: 11, color: colors.textFaint },
});
