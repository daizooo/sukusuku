import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CareLog, DynamicTask } from '@/types/app';
import { WEEKDAY_LABELS, addDays, isSameDay, startOfWeek } from '@/lib/dateUtils';
import { getMilestoneLabel } from '@/lib/milestones';
import { tasksOnDate } from '@/lib/scheduleUtils';
import { colors } from '@/lib/theme';
import TaskRow from './TaskRow';
import { CareLogSummaryLine } from './CareLogSection';
import DayTimeline, { TimelineScale } from './DayTimeline';

// 7日分を縦に並べた週の面。Web版の
// `src/components/sukusuku/schedule/WeekView.tsx` を置き換えたもの。
// 月表示と日表示の中間として、「この1週間に何があるか」と
// 「記録がどれくらいあったか」を1画面で見る。

interface WeekViewProps {
  /** この日を含む週を表示する。 */
  date: Date;
  today: Date;
  tasks: DynamicTask[];
  birthDate: string;
  /** 表示中の週の記録（日ごとに振り分けて使う）。 */
  careLogs: CareLog[];
  isLoadingCareLogs?: boolean;
  onSelectDate: (date: Date) => void;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
}

export default function WeekView({
  date,
  today,
  tasks,
  birthDate,
  careLogs,
  isLoadingCareLogs,
  onSelectDate,
  onToggleTodo,
  onOpenTask,
}: WeekViewProps) {
  const start = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <View style={styles.list}>
      {/* 帯の目盛り。7日ぶんの帯に共通するので、上に1本だけ置く。
          記録がなく帯が1本も出ない週（これから来る週など）では出さない。 */}
      {careLogs.length > 0 && !isLoadingCareLogs && (
        <View style={styles.scale}>
          <TimelineScale />
        </View>
      )}

      {days.map((day) => {
        const dayTasks = tasksOnDate(tasks, day);
        const dayLogs = careLogs.filter((log) => isSameDay(log.time, day));
        const isToday = isSameDay(day, today);
        const isPastOrToday = day.getTime() <= today.getTime();
        const milestone = getMilestoneLabel(birthDate, day);

        return (
          <View key={day.toISOString()}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onSelectDate(day)}
              style={styles.dayHeader}
            >
              <View style={[styles.dateBubble, isToday && styles.dateBubbleToday]}>
                <Text style={[styles.dateText, isToday && styles.dateTextToday]}>
                  {day.getDate()}
                </Text>
              </View>
              <Text
                style={[
                  styles.weekday,
                  day.getDay() === 0 && styles.sunday,
                  day.getDay() === 6 && styles.saturday,
                ]}
              >
                {WEEKDAY_LABELS[day.getDay()]}
              </Text>
              {milestone && (
                <View style={styles.milestone}>
                  <Text style={styles.milestoneText}>{milestone}</Text>
                </View>
              )}
            </Pressable>

            {dayTasks.length > 0 ? (
              <View style={styles.tasks}>
                {dayTasks.map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
                ))}
              </View>
            ) : (
              <Text style={styles.noTask}>予定なし</Text>
            )}

            {isPastOrToday && !isLoadingCareLogs && (
              <View style={styles.logs}>
                <DayTimeline logs={dayLogs} day={day} />
                <CareLogSummaryLine logs={dayLogs} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  scale: { paddingHorizontal: 4 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  dateBubble: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBubbleToday: { backgroundColor: colors.navActive },
  dateText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  dateTextToday: { color: colors.primaryText },
  weekday: { fontSize: 12, fontWeight: '500', color: colors.textMuted, flexShrink: 1 },
  sunday: { color: colors.sunday },
  saturday: { color: colors.navActive },
  milestone: {
    backgroundColor: colors.milestoneSurface,
    borderWidth: 1,
    borderColor: colors.milestoneBorder,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  milestoneText: { fontSize: 10, fontWeight: '700', color: colors.milestoneText },
  tasks: { gap: 8 },
  noTask: { fontSize: 12, color: colors.textFaint, paddingHorizontal: 4, paddingVertical: 4 },
  logs: { marginTop: 6, paddingHorizontal: 4, gap: 4 },
});
