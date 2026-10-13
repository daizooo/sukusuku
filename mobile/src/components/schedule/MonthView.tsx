import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';
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
import { getTaskTone } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';

// 月グリッド。Web版の `src/components/sukusuku/schedule/MonthView.tsx` を置き換えたもの。
// Googleカレンダーの月表示にならい、予定は1行ずつ色付きの帯にして積む:
// - 予定: 主体の色の帯（淡い地に濃い文字）
// - タスク: 灰の帯に灰のチェックの丸（docs/calendar.md §1）
// - 完了: 薄い灰の帯に取り消し線
// 曜日は1週目のマスの頭に出し、月の初日も他の日と同じく日付の数字だけ（月は見出しに出ている）。
// 日曜・祝日は赤、土曜は青（曜日の文字も同じ）。今日だけ青い丸に白、前後の月の日は薄い灰。
// 育児記録はここには出さない（月表示は予定を見渡すための面。記録は日をタップした先で見る）。
//
// 押したところで動きが分かれる（Googleカレンダーと同じ）:
// - 日付の数字 → その日の日表示
// - 予定の行 → 予定の詳細
// - それ以外のマスの中（予定の無いところ） → その日の予定・タスクの追加
// 手触りは予定と空きで逆にする（Googleカレンダーと同じ）。予定の行・日付の数字は
// 触れている間に色が変わり、予定の無いマスの中は変わらない。
//
// 高さは親から与えられたぶんを週の数で等分する。画面全体をスクロールさせないため、
// マスに入りきらない予定は「他n件」に寄せる。

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

// 1マスに出す予定の数の上限。これを超えたぶんは「他n件」にまとめる（Web版と同じ）。
const CHIPS = 4;

// マスの高さは画面と週の数で変わるので、上の CHIPS 件が入らないときは件数を減らして
// 「他n件」に寄せる。下の値は styles の実寸の見積もり（余白・枠を含む）。styles を変えたら合わせる。
const CELL_CHROME = 6; // マスの上下の余白と枠
const WEEKDAY_HEIGHT = 12; // 1週目のマスの頭の曜日
const DATE_HEIGHT = 18; // 日付の丸
const LABEL_HEIGHT = 13; // 祝日・節目の行
const CHIP_HEIGHT = 15; // 予定1行（帯）
const MORE_HEIGHT = 12;
const CHIP_GAP = 2;

/** 予定が total 件あるマスで、予定へ回せる高さ room に何件出せるか。 */
const chipsThatFit = (total: number, room: number): number => {
  const stack = (n: number) => n * CHIP_HEIGHT + Math.max(n - 1, 0) * CHIP_GAP;
  const limit = Math.min(total, CHIPS);
  // 全部出せるなら「他n件」は要らない（CHIPS を超える分だけは「他n件」が必要）。
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
                      rowHeight -
                        CELL_CHROME -
                        (w === 0 ? WEEKDAY_HEIGHT : 0) -
                        DATE_HEIGHT -
                        (hasLabel ? LABEL_HEIGHT : 0) -
                        CHIP_GAP,
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
                    isSelected && styles.cellSelected,
                  ]}
                >
                  {w === 0 && (
                    <Text
                      style={[
                        styles.weekday,
                        columnIndex === 0 && styles.dateTextSunday,
                        columnIndex === 6 && styles.dateTextSaturday,
                      ]}
                    >
                      {WEEKDAY_LABELS[columnIndex]}
                    </Text>
                  )}
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
                              : date.getDay() === 0 || holiday !== null
                                ? styles.dateTextSunday
                                : date.getDay() === 6
                                  ? styles.dateTextSaturday
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
                      // マスの幅（約47dp）に「スポーツの日」などは10で収まらないため、長いものだけ縮める。
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      style={[styles.milestone, holiday !== null && styles.holidayLabel]}
                    >
                      {holiday ?? milestone}
                    </Text>
                  )}

                  <View style={styles.chips}>
                    {dayTasks.slice(0, shownChips).map((task) => (
                      <Pressable
                        key={task.occurrenceKey}
                        accessibilityRole="button"
                        onPress={() => onOpenTask(task)}
                        // 触れている間は帯を少し薄くして、触った感を出す。
                        style={({ pressed }) => [
                          styles.chip,
                          {
                            backgroundColor: task.done ? colors.neutralSurface : getTaskTone(task).background,
                          },
                          pressed && styles.chipPressed,
                          isOtherMonth && styles.chipOtherMonth,
                        ]}
                      >
                        {task.kind === 'task' && <CheckCircle2 size={9} color={colors.textMuted} />}
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="clip"
                          style={[
                            styles.chipText,
                            { color: getTaskTone(task).text },
                            task.done && styles.chipTextDone,
                          ]}
                        >
                          {task.title}
                        </Text>
                      </Pressable>
                    ))}
                    {dayTasks.length > shownChips && (
                      <Text style={styles.more}>他{dayTasks.length - shownChips}件</Text>
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
  weekday: {
    height: WEEKDAY_HEIGHT,
    textAlign: 'center',
    fontSize: 9,
    lineHeight: WEEKDAY_HEIGHT,
    fontWeight: '700',
    color: colors.textMuted,
  },

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
  cellSelected: { backgroundColor: colors.selectedSurface, borderColor: colors.selectedRing },
  dateRow: { alignItems: 'center' },
  dateBubble: {
    minWidth: DATE_HEIGHT,
    paddingHorizontal: 3,
    height: DATE_HEIGHT,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBubbleToday: { backgroundColor: colors.navActive },
  dateBubblePressed: { backgroundColor: colors.border },
  dateBubbleTodayPressed: { backgroundColor: colors.navActiveText },
  dateText: { fontSize: 11, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dateTextToday: { color: colors.primaryText, fontWeight: '700' },
  dateTextOtherMonth: { color: colors.textFaint },
  dateTextSunday: { color: colors.sunday },
  dateTextSaturday: { color: colors.navActive },
  milestone: { fontSize: 10, lineHeight: 13, textAlign: 'center', color: colors.milestone, fontWeight: '500' },
  holidayLabel: { color: colors.sunday },
  chips: { marginTop: CHIP_GAP, gap: CHIP_GAP },
  chip: {
    height: CHIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 3,
    paddingHorizontal: 3,
  },
  chipPressed: { opacity: 0.7 },
  chipOtherMonth: { opacity: 0.5 },
  chipText: { flex: 1, fontSize: 9, fontWeight: '600', textAlign: 'center' },
  chipTextDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  more: { fontSize: 9, color: colors.textMuted, paddingHorizontal: 2, fontWeight: '700' },
});
