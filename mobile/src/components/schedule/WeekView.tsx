import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DynamicTask } from '@/types/app';
import { WEEKDAY_LABELS, addDays, isSameDay, startOfWeek } from '@/lib/dateUtils';
import { getHolidayName } from '@/lib/japaneseHolidays';
import { getMilestoneLabel } from '@/lib/milestones';
import { tasksOnDate } from '@/lib/scheduleUtils';
import { colors } from '@/lib/theme';
import TaskRow from './TaskRow';

// 7日分を縦に並べた週の面。Web版の
// `src/components/sukusuku/schedule/WeekView.tsx` を置き換えたもの。
// 月表示と日表示の中間として、「この1週間に何があるか」を1画面で見る。
//
// 育児記録はここには出さない。7日ぶんの帯と合計を並べると縦に伸びて、
// 肝心の7日が1画面に収まらなくなるため。記録は日表示と記録タブで見る。

interface WeekViewProps {
  /** この日を含む週を表示する。 */
  date: Date;
  today: Date;
  tasks: DynamicTask[];
  birthDate: string;
  onSelectDate: (date: Date) => void;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
}

export default function WeekView({
  date,
  today,
  tasks,
  birthDate,
  onSelectDate,
  onToggleTodo,
  onOpenTask,
}: WeekViewProps) {
  const start = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <View style={styles.list}>
      {days.map((day) => {
        const dayTasks = tasksOnDate(tasks, day);
        const isToday = isSameDay(day, today);
        const holiday = getHolidayName(day);
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
                  (day.getDay() === 0 || holiday !== null) && styles.sunday,
                  day.getDay() === 6 && styles.saturday,
                ]}
              >
                {WEEKDAY_LABELS[day.getDay()]}
              </Text>
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
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
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
  dateText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  dateTextToday: { color: colors.primaryText },
  weekday: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  sunday: { color: colors.sunday },
  saturday: { color: colors.navActive },
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
  tasks: { gap: 8 },
  noTask: { fontSize: 12, color: colors.textFaint, paddingHorizontal: 4, paddingVertical: 4 },
});
