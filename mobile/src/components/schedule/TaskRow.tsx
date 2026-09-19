import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BellRing, CalendarDays, CheckCircle2, Circle, Clock, MapPin } from 'lucide-react-native';
import type { DynamicTask } from '@/types/app';
import { formatTimeRange } from '@/lib/dateUtils';
import { getLabelColors } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';

// 予定1件の行。Web版の `src/components/sukusuku/schedule/TaskRow.tsx` を置き換えたもの。
// リスト表示・週表示・日表示で共通して使うところも同じ。

interface TaskRowProps {
  task: DynamicTask;
  onToggle: (id: string) => void;
  onOpen: (task: DynamicTask) => void;
  /** 日付を行に出すか（日をまたいで並べる一覧で使う）。 */
  showDate?: boolean;
}

export default function TaskRow({ task, onToggle, onOpen, showDate }: TaskRowProps) {
  const label = getLabelColors(task.label);

  return (
    <Pressable accessibilityRole="button" onPress={() => onOpen(task)} style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={task.done ? '未完了に戻す' : '完了にする'}
        onPress={() => onToggle(task.id)}
        hitSlop={8}
        style={styles.check}
      >
        {task.done ? (
          <CheckCircle2 size={22} color={colors.navActive} />
        ) : (
          <Circle size={22} color={colors.borderStrong} />
        )}
      </Pressable>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={styles.titleGroup}>
            <Text style={[styles.title, task.done && styles.titleDone]}>{task.title}</Text>
            {task.remindMinutesBefore !== null && !task.done && (
              <BellRing size={12} color={colors.milkProgress} />
            )}
          </View>
          <View
            style={[styles.label, { backgroundColor: label.background, borderColor: label.border }]}
          >
            <Text style={[styles.labelText, { color: label.text }]}>{task.label}</Text>
          </View>
        </View>

        <View style={styles.meta}>
          {showDate && (
            <View style={styles.metaItem}>
              <CalendarDays size={12} color={colors.navActiveText} />
              <Text style={styles.metaDate}>{task.targetDate}</Text>
            </View>
          )}
          <View style={styles.metaItem}>
            <Clock size={12} color={colors.textMuted} />
            <Text style={styles.metaText}>{formatTimeRange(task.startTime, task.endTime)}</Text>
          </View>
          {task.place !== '' && (
            <View style={styles.metaItem}>
              <MapPin size={12} color={colors.textMuted} />
              <Text style={styles.metaText} numberOfLines={1}>
                {task.place}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  check: { marginTop: 1 },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  titleGroup: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '500', color: colors.textSubtle, lineHeight: 19 },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  label: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  labelText: { fontSize: 10, fontWeight: '700' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaDate: { fontSize: 12, fontWeight: '500', color: colors.navActiveText, fontVariant: ['tabular-nums'] },
  metaText: { fontSize: 12, color: colors.textMuted, flexShrink: 1, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
