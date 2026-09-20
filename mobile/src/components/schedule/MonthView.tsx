import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DynamicTask } from '@/types/app';
import {
  WEEKDAY_LABELS,
  addDays,
  getDaysInMonth,
  getFirstDayOfMonth,
  isSameDay,
  startOfWeek,
} from '@/lib/dateUtils';
import { getHolidayName } from '@/lib/japaneseHolidays';
import { getMilestoneLabel } from '@/lib/milestones';
import { tasksOnDate } from '@/lib/scheduleUtils';
import { getParticipantsTone } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';

// 月グリッド。Web版の `src/components/sukusuku/schedule/MonthView.tsx` を置き換えたもの。
// 予定はタイトル入りのチップで積み、育児記録はここには出さない
// （月表示は予定を見渡すための面。記録は日をタップした先で見る）。
//
// 高さは親から与えられたぶんを週の数で等分する。画面全体をスクロールさせないため、
// マスに入りきらない予定は「+n件」に寄せる。

interface MonthViewProps {
  /** 表示する月（日は問わない）。 */
  month: Date;
  today: Date;
  selectedDate: Date;
  /** ラベルで絞り込み済みの予定。 */
  tasks: DynamicTask[];
  birthDate: string;
  onSelectDate: (date: Date) => void;
  onOpenTask: (task: DynamicTask) => void;
}

// 1マスに出す予定の数。Web版は画面の広さで2件と3件を切り替えるが、
// こちらは携帯だけなので、Web版の狭いほうと同じ2件にする。
const CHIPS = 2;

export default function MonthView({
  month,
  today,
  selectedDate,
  tasks,
  birthDate,
  onSelectDate,
  onOpenTask,
}: MonthViewProps) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  // 前後の月の日も含めて週単位で埋める（週の途中で切らない）。
  const gridStart = startOfWeek(new Date(year, monthIndex, 1));
  const weekCount = Math.ceil(
    (getFirstDayOfMonth(year, monthIndex) + getDaysInMonth(year, monthIndex)) / 7,
  );
  const weeks = Array.from({ length: weekCount }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)),
  );

  return (
    <View style={styles.card}>
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((d, i) => (
          <Text
            key={d}
            style={[
              styles.weekday,
              i === 0 && styles.sunday,
              i === 6 && styles.saturday,
            ]}
          >
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {weeks.map((week, w) => (
          <View key={w} style={styles.week}>
            {week.map((date, columnIndex) => {
              const dayTasks = tasksOnDate(tasks, date);
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, selectedDate);
              const isOtherMonth = date.getMonth() !== monthIndex;
              const holiday = getHolidayName(date);
              const milestone = getMilestoneLabel(birthDate, date);

              return (
                <Pressable
                  key={date.toISOString()}
                  accessibilityRole="button"
                  accessibilityLabel={`${date.getMonth() + 1}月${date.getDate()}日${holiday ? ` ${holiday}` : ''} 予定${dayTasks.length}件`}
                  onPress={() => onSelectDate(date)}
                  style={[
                    styles.cell,
                    // 最終列の右の線はカードの縁と重なるので引かない。
                    columnIndex === 6 && styles.cellLastColumn,
                    isOtherMonth && styles.cellOtherMonth,
                    isSelected && styles.cellSelected,
                  ]}
                >
                  <View style={styles.dateRow}>
                    <View style={[styles.dateBubble, isToday && styles.dateBubbleToday]}>
                      <Text
                        style={[
                          styles.dateText,
                          isToday
                            ? styles.dateTextToday
                            : isOtherMonth
                              ? styles.dateTextOtherMonth
                              : date.getDay() === 0 || holiday
                                ? styles.sunday
                                : date.getDay() === 6
                                  ? styles.saturday
                                  : null,
                        ]}
                      >
                        {date.getDate()}
                      </Text>
                    </View>
                  </View>

                  {/* 祝日と節目が重なる日は祝日を出す。1マスの高さに収めるため1行だけにする。 */}
                  {!isOtherMonth && (holiday || milestone) && (
                    <Text
                      numberOfLines={1}
                      style={[styles.milestone, holiday !== null && styles.holidayLabel]}
                    >
                      {holiday ?? milestone}
                    </Text>
                  )}

                  <View style={styles.chips}>
                    {dayTasks.slice(0, CHIPS).map((task) => {
                      const label = getParticipantsTone(task.participants);
                      return (
                        <Pressable
                          key={task.id}
                          accessibilityRole="button"
                          onPress={() => onOpenTask(task)}
                          style={[
                            styles.chip,
                            task.done
                              ? styles.chipDone
                              : { backgroundColor: label.background, borderColor: label.border },
                            isOtherMonth && styles.chipOtherMonth,
                          ]}
                        >
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.chipText,
                              task.done ? styles.chipTextDone : { color: label.text },
                            ]}
                          >
                            {task.title}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {dayTasks.length > CHIPS && (
                      <Text style={styles.more}>+{dayTasks.length - CHIPS}件</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  weekdayRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '500',
    color: colors.textMuted,
    paddingVertical: 6,
  },
  sunday: { color: colors.sunday },
  saturday: { color: colors.navActive },

  grid: { flex: 1 },
  week: { flex: 1, flexDirection: 'row' },
  cell: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  cellLastColumn: { borderRightColor: 'transparent' },
  cellOtherMonth: { backgroundColor: colors.background },
  cellSelected: { backgroundColor: colors.selectedSurface, borderColor: colors.selectedRing },
  dateRow: { alignItems: 'center' },
  dateBubble: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBubbleToday: { backgroundColor: colors.navActive },
  dateText: { fontSize: 11, color: colors.textSubtle, fontWeight: '500', fontVariant: ['tabular-nums'] },
  dateTextToday: { color: colors.primaryText, fontWeight: '700' },
  dateTextOtherMonth: { color: colors.borderStrong },
  milestone: { fontSize: 8, textAlign: 'center', color: colors.milestone, fontWeight: '500' },
  holidayLabel: { color: colors.sunday },
  chips: { marginTop: 2, gap: 2 },
  chip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  chipDone: { backgroundColor: colors.neutralSurface, borderColor: colors.border },
  chipOtherMonth: { opacity: 0.5 },
  chipText: { fontSize: 9, fontWeight: '500' },
  chipTextDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  more: { fontSize: 9, color: colors.textFaint, paddingHorizontal: 3, fontWeight: '500' },
});
