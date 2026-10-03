import { useState } from 'react';
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
import { getOwnerTone, getSplitTones } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';

// 月グリッド。Web版の `src/components/sukusuku/schedule/MonthView.tsx` を置き換えたもの。
// 予定はタイトル入りのチップで積み、育児記録はここには出さない
// （月表示は予定を見渡すための面。記録は日をタップした先で見る）。
//
// 押したところで動きが分かれる（Googleカレンダーと同じ）:
// - 日付の数字 → その日の日表示
// - 予定のチップ → 予定の詳細
// - それ以外のマスの中（予定の無いところ） → その日の予定・タスクの追加
// 手触りは予定と空きで逆にする（Googleカレンダーと同じ）。予定のチップ・日付の数字は
// 触れている間に色が変わり、予定の無いマスの中は変わらない。
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
  /** 日付の数字を押したとき。その日の日表示へ移る。 */
  onSelectDate: (date: Date) => void;
  /** マスの予定が無いところを押したとき。その日を初期値にした予定の追加を開く。 */
  onAddTask: (date: Date) => void;
  onOpenTask: (task: DynamicTask) => void;
}

// 1マスに出す予定の数の上限。Web版は画面の広さで2件と3件を切り替えるが、
// こちらは携帯だけなので、Web版の狭いほうと同じ2件にする。
const CHIPS = 2;

// マスの高さは画面と週の数で変わる（下に「直近のスケジュール」が並ぶぶん低い）ので、
// 上の CHIPS 件が入らないときは件数を減らして「+n件」に寄せる。
// 下の値は styles の実寸の見積もり（余白・枠を含む）。styles を変えたら合わせる。
const CELL_CHROME = 6; // マスの上下の余白と枠
const DATE_HEIGHT = 18; // 日付の丸
const LABEL_HEIGHT = 11; // 祝日・節目の行
const CHIP_HEIGHT = 16;
const MORE_HEIGHT = 12;
const CHIP_GAP = 1;

/** 予定が total 件あるマスで、予定へ回せる高さ room に何件のチップを出せるか。 */
const chipsThatFit = (total: number, room: number): number => {
  const stack = (n: number) => n * CHIP_HEIGHT + Math.max(n - 1, 0) * CHIP_GAP;
  const limit = Math.min(total, CHIPS);
  // 全部出せるなら「+n件」は要らない（CHIPS を超える分だけは「+n件」が必要）。
  if (total <= CHIPS && stack(total) <= room) return total;
  for (let n = limit; n > 0; n -= 1) {
    if (stack(n) + CHIP_GAP + MORE_HEIGHT <= room) return n;
  }
  return 0;
};

export default function MonthView({
  month,
  today,
  selectedDate,
  tasks,
  birthDate,
  onSelectDate,
  onAddTask,
  onOpenTask,
}: MonthViewProps) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  // 前後の月の日も含めて週単位で埋める（週の途中で切らない）。
  const gridStart = startOfWeek(new Date(year, monthIndex, 1));
  const weekCount = Math.ceil(
    (getFirstDayOfMonth(year, monthIndex) + getDaysInMonth(year, monthIndex)) / 7,
  );
  // 週1行ぶんの高さ。測れるまでは、予定は CHIPS 件まで出す。
  const [gridHeight, setGridHeight] = useState<number | null>(null);
  const rowHeight = gridHeight === null ? null : gridHeight / weekCount;

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

      <View style={styles.grid} onLayout={(e) => setGridHeight(e.nativeEvent.layout.height)}>
        {weeks.map((week, w) => (
          <View key={w} style={styles.week}>
            {week.map((date, columnIndex) => {
              const dayTasks = tasksOnDate(tasks, date);
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, selectedDate);
              const isOtherMonth = date.getMonth() !== monthIndex;
              const holiday = getHolidayName(date);
              const milestone = getMilestoneLabel(birthDate, date);
              const hasLabel = !isOtherMonth && (holiday !== null || milestone !== null);
              const shownChips =
                rowHeight === null
                  ? CHIPS
                  : chipsThatFit(
                      dayTasks.length,
                      rowHeight - CELL_CHROME - DATE_HEIGHT - (hasLabel ? LABEL_HEIGHT : 0) - CHIP_GAP,
                    );

              return (
                <Pressable
                  key={date.toISOString()}
                  accessibilityRole="button"
                  accessibilityLabel={`${date.getMonth() + 1}月${date.getDate()}日${holiday ? ` ${holiday}` : ''} 予定${dayTasks.length}件 押すと予定を追加`}
                  onPress={() => onAddTask(date)}
                  style={[
                    styles.cell,
                    // 最終列の右の線はカードの縁と重なるので引かない。
                    columnIndex === 6 && styles.cellLastColumn,
                    isOtherMonth && styles.cellOtherMonth,
                    isSelected && styles.cellSelected,
                  ]}
                >
                  <View style={styles.dateRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${date.getMonth() + 1}月${date.getDate()}日の予定を見る`}
                      onPress={() => onSelectDate(date)}
                      hitSlop={{ top: 4, bottom: 4, left: 10, right: 10 }}
                      style={({ pressed }) => [
                        styles.dateBubble,
                        isToday && styles.dateBubbleToday,
                        pressed && (isToday ? styles.dateBubbleTodayPressed : styles.dateBubblePressed),
                      ]}
                    >
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
                    </Pressable>
                  </View>

                  {/* 祝日と節目が重なる日は祝日を出す。1マスの高さに収めるため1行だけにする。 */}
                  {hasLabel && (
                    <Text
                      numberOfLines={1}
                      style={[styles.milestone, holiday !== null && styles.holidayLabel]}
                    >
                      {holiday ?? milestone}
                    </Text>
                  )}

                  <View style={styles.chips}>
                    {dayTasks.slice(0, shownChips).map((task) => {
                      const label = getOwnerTone(task.owner, task.participants);
                      // 2人以上が参加する予定は、帯を参加者の色で等分する（完了したものは灰のまま）。
                      const split = task.done ? null : getSplitTones(task.participants);
                      return (
                        <Pressable
                          key={task.occurrenceKey}
                          accessibilityRole="button"
                          onPress={() => onOpenTask(task)}
                          // 触れている間は地の色を枠の色（濃いほう）に変えて、触った感を出す。
                          style={({ pressed }) => [
                            styles.chip,
                            task.done
                              ? [styles.chipDone, pressed && styles.chipDonePressed]
                              : split
                                ? styles.chipSplit
                                : {
                                    backgroundColor: pressed ? label.border : label.background,
                                    borderColor: label.border,
                                  },
                            isOtherMonth && styles.chipOtherMonth,
                          ]}
                        >
                          {({ pressed }) => (
                            <>
                              {split && (
                                <View style={styles.chipSegments}>
                                  {split.map((tone, i) => (
                                    <View
                                      key={i}
                                      style={[
                                        styles.chipSegment,
                                        { backgroundColor: pressed ? tone.border : tone.background },
                                      ]}
                                    />
                                  ))}
                                </View>
                              )}
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.chipText,
                                  task.done
                                    ? styles.chipTextDone
                                    : { color: split ? colors.text : label.text },
                                ]}
                              >
                                {task.title}
                              </Text>
                            </>
                          )}
                        </Pressable>
                      );
                    })}
                    {dayTasks.length > shownChips && (
                      <Text style={styles.more}>+{dayTasks.length - shownChips}件</Text>
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
    width: DATE_HEIGHT,
    height: DATE_HEIGHT,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBubbleToday: { backgroundColor: colors.navActive },
  dateBubblePressed: { backgroundColor: colors.border },
  dateBubbleTodayPressed: { backgroundColor: colors.navActiveText },
  dateText: { fontSize: 11, color: colors.textSubtle, fontWeight: '500', fontVariant: ['tabular-nums'] },
  dateTextToday: { color: colors.primaryText, fontWeight: '700' },
  dateTextOtherMonth: { color: colors.borderStrong },
  milestone: { fontSize: 8, textAlign: 'center', color: colors.milestone, fontWeight: '500' },
  holidayLabel: { color: colors.sunday },
  chips: { marginTop: CHIP_GAP, gap: CHIP_GAP },
  chip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  // 参加者の色で等分した帯。地は chipSegments が塗るので、枠だけ中立の色にする。
  chipSplit: { borderColor: colors.border, overflow: 'hidden' },
  chipSegments: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  chipSegment: { flex: 1 },
  chipDone: { backgroundColor: colors.neutralSurface, borderColor: colors.border },
  chipDonePressed: { backgroundColor: colors.border },
  chipOtherMonth: { opacity: 0.5 },
  chipText: { fontSize: 9, fontWeight: '500' },
  chipTextDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  more: { fontSize: 9, color: colors.textFaint, paddingHorizontal: 3, fontWeight: '500' },
});
