import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import type { CareLog, DynamicTask } from '@/types/app';
import { isSameDay } from '@/lib/dateUtils';
import { getHolidayName } from '@/lib/japaneseHolidays';
import { formatBabyAgeAt, getMilestoneLabel } from '@/lib/milestones';
import { colors } from '@/lib/theme';
import TaskRow from './TaskRow';
import CareLogSection from './CareLogSection';
import DayTimeline from './DayTimeline';

// 1日の面。予定と育児記録をここで合わせて見る。
// Web版の `src/components/sukusuku/schedule/DayView.tsx` を置き換えたもの。

interface DayViewProps {
  date: Date;
  today: Date;
  /** その日の予定（時刻順に並べ済み）。 */
  tasks: DynamicTask[];
  birthDate: string;
  /** 表示中の範囲の記録。その日のぶんへの絞り込みはこの中で行う。 */
  careLogs: CareLog[];
  isLoadingCareLogs?: boolean;
  onToggleTodo: (task: DynamicTask) => void;
  onOpenTask: (task: DynamicTask) => void;
  onAddTask: (date: Date) => void;
  onOpenLogTab: (date: Date) => void;
}

export default function DayView({
  date,
  today,
  tasks,
  birthDate,
  careLogs,
  isLoadingCareLogs,
  onToggleTodo,
  onOpenTask,
  onAddTask,
  onOpenLogTab,
}: DayViewProps) {
  const babyAge = formatBabyAgeAt(birthDate, date);
  const holiday = getHolidayName(date);
  const milestone = getMilestoneLabel(birthDate, date);
  // 未来の日には記録が存在しないため、記録の枠自体を出さない。
  const isPastOrToday = date.getTime() <= today.getTime();
  // 一覧と合計はその日のぶんだけ。
  const dayLogs = careLogs.filter((log) => isSameDay(log.time, date));

  return (
    <View style={styles.page}>
      {(babyAge || holiday || milestone) && (
        <View style={styles.ageRow}>
          {babyAge !== '' && <Text style={styles.age}>{babyAge}</Text>}
          {holiday && (
            <View style={styles.holiday}>
              <Text style={styles.holidayText}>{holiday}</Text>
            </View>
          )}
          {milestone && (
            <View style={styles.milestone}>
              <Text style={styles.milestoneText}>{milestone}</Text>
            </View>
          )}
        </View>
      )}

      <View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            予定 {tasks.length > 0 ? `(${tasks.length}件)` : ''}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => onAddTask(date)} style={styles.link}>
            <Plus size={14} color={colors.navActive} />
            <Text style={styles.linkText}>この日に追加</Text>
          </Pressable>
        </View>
        {tasks.length === 0 ? (
          // 予定が無いところを押すと、その日の予定・タスクの追加を開く。
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="予定はありません 押すとこの日に追加"
            onPress={() => onAddTask(date)}
            style={({ pressed }) => [styles.empty, pressed && styles.emptyPressed]}
          >
            <Text style={styles.emptyText}>予定はありません</Text>
          </Pressable>
        ) : (
          <View style={styles.tasks}>
            {tasks.map((task) => (
              <TaskRow key={task.occurrenceKey} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
            ))}
          </View>
        )}
      </View>

      {isPastOrToday && (
        <CareLogSection
          logs={dayLogs}
          isLoading={isLoadingCareLogs}
          timeline={<DayTimeline logs={dayLogs} day={date} variant="day" />}
          onOpenLogTab={() => onOpenLogTab(date)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  age: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  holiday: {
    backgroundColor: colors.holidaySurface,
    borderWidth: 1,
    borderColor: colors.holidayBorder,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  holidayText: { fontSize: 10, fontWeight: '700', color: colors.holidayText },
  milestone: {
    backgroundColor: colors.milestoneSurface,
    borderWidth: 1,
    borderColor: colors.milestoneBorder,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  milestoneText: { fontSize: 10, fontWeight: '700', color: colors.milestoneText },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkText: { fontSize: 12, fontWeight: '500', color: colors.navActive },
  emptyText: { fontSize: 14, color: colors.textFaint, textAlign: 'center' },
  emptyPressed: { backgroundColor: colors.selectedSurface },
  empty: {
    paddingVertical: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  tasks: { gap: 8 },
});
