import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BellRing, CalendarDays, CheckCircle2, Circle, Clock, MapPin } from 'lucide-react-native';
import type { DynamicTask } from '@/types/app';
import { formatTimeRange } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { getLabelColors } from '@/lib/uiUtils';

// 予定1件の行。リスト表示・週表示・日表示で共通して使う。
// Web版の `src/components/sukusuku/schedule/TaskRow.tsx` と同じ出し方
// （丸の印で完了の切り替え、右上にラベル、下に日付・時刻・場所）。

interface TaskRowProps {
  task: DynamicTask;
  onToggle: (task: DynamicTask) => void;
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
        onPress={() => onToggle(task)}
        hitSlop={8}
        style={styles.check}
      >
        {task.done ? (
          <CheckCircle2 size={22} color={colors.accentBlue} />
        ) : (
          <Circle size={22} color={colors.border} />
        )}
      </Pressable>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, task.done && styles.titleDone]}>{task.title}</Text>
          {task.remindMinutesBefore !== null && !task.done && (
            <BellRing size={12} color={colors.milestoneText} style={styles.bell} />
          )}
          <View
            style={[
              styles.labelChip,
              { backgroundColor: label.background, borderColor: label.border },
            ]}
          >
            <Text style={[styles.labelText, { color: label.text }]}>{task.label}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          {showDate && (
            <View style={styles.meta}>
              <CalendarDays size={12} color={colors.accentBlueText} />
              <Text style={[styles.metaText, styles.metaDate]}>{task.targetDate}</Text>
            </View>
          )}
          <View style={styles.meta}>
            <Clock size={12} color={colors.textMuted} />
            <Text style={styles.metaText}>{formatTimeRange(task.startTime, task.endTime)}</Text>
          </View>
          {task.place !== '' && (
            <View style={[styles.meta, styles.metaPlace]}>
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
  },
  check: { marginTop: 1 },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { flexShrink: 1, fontSize: 13, fontWeight: '500', color: colors.text, lineHeight: 18 },
  titleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  bell: { marginTop: 3, marginLeft: 6 },
  labelChip: {
    marginLeft: 'auto',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 4,
  },
  labelText: { fontSize: 10, fontWeight: '700' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaPlace: { flexShrink: 1 },
  metaText: { fontSize: 12, color: colors.textMuted },
  metaDate: { color: colors.accentBlueText, fontWeight: '500' },
});
