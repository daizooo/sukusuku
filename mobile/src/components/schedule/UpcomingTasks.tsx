import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Circle,
  Plus,
} from 'lucide-react-native';
import type { DynamicTask } from '@/types/app';
import { formatTimeRange, startOfDay } from '@/lib/dateUtils';
import { byDateThenTime, formatRelativeDay } from '@/lib/scheduleUtils';
import { getOwnerTone } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';

// 月表示のカレンダーの下に置く「直近のスケジュール」。以前はホームタブにあったもの。
// 高さは親から与えられたぶんに収め、あふれた分はこの中だけでスクロールする
// （画面全体はスクロールさせない）。
//
// 見出しを押すと、すべての予定を日付順に並べたリスト表示へ移る。
//
// 予定の追加ボタンは、右下の丸いボタンだと一覧の右下に重なって隠してしまうため、
// 月表示ではこの見出しの中に置く。

interface UpcomingTasksProps {
  /** 担当で絞り込み済みの予定。 */
  tasks: DynamicTask[];
  isLoading: boolean;
  today: Date;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
  onAddTask: () => void;
  /** 見出しを押したとき・期限切れの件数を押したときにリスト表示へ移る。 */
  onShowAll: () => void;
}

/** 一覧に出す件数の上限。それより先は「すべて見る」で見る。 */
const MAX_TASKS = 10;

export default function UpcomingTasks({
  tasks,
  isLoading,
  today,
  onToggleTodo,
  onOpenTask,
  onAddTask,
  onShowAll,
}: UpcomingTasksProps) {
  const startOfToday = startOfDay(today).getTime();
  const pending = tasks.filter((t) => !t.done);

  // 期限切れは古いものほど先頭に来るため、そのまま並べると直近の予定を
  // 食いつぶしてしまう。件数だけ知らせて、中身はリスト表示に任せる。
  const overdueCount = pending.filter(
    (t) => t.targetDateObj && startOfDay(t.targetDateObj).getTime() < startOfToday,
  ).length;

  // 今日以降の予定を近い順に。日付未設定は後ろに回る（byDateThenTime）。
  const upcoming = pending
    .filter((t) => !t.targetDateObj || startOfDay(t.targetDateObj).getTime() >= startOfToday)
    .sort(byDateThenTime)
    .slice(0, MAX_TASKS);

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="直近のスケジュール。押すとすべての予定をリストで見る"
          onPress={onShowAll}
          hitSlop={8}
          style={styles.titleButton}
        >
          <Text style={styles.title}>直近のスケジュール</Text>
          <ChevronRight size={16} color={colors.navActive} />
        </Pressable>
        {overdueCount > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`期限切れ${overdueCount}件。リストで見る`}
            onPress={onShowAll}
            style={styles.overdue}
          >
            <AlertTriangle size={12} color={colors.alertText} />
            <Text style={styles.overdueText}>期限切れ {overdueCount}件</Text>
          </Pressable>
        )}
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="予定を追加"
          onPress={onAddTask}
          style={styles.add}
        >
          <Plus size={18} color={colors.primaryText} />
        </Pressable>
      </View>

      {isLoading ? (
        <Text style={styles.empty}>読み込み中...</Text>
      ) : upcoming.length === 0 ? (
        <Text style={styles.empty}>直近の予定はありません</Text>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          nestedScrollEnabled
          persistentScrollbar
        >
          {upcoming.map((task) => {
            const tone = getOwnerTone(task.owner, task.participants);
            return (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                onPress={() => onOpenTask(task)}
                style={styles.row}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={task.done ? '完了を取り消す' : '完了にする'}
                  onPress={() => onToggleTodo(task.id)}
                  hitSlop={8}
                >
                  {task.done ? (
                    <CheckCircle2 size={20} color={colors.navActive} />
                  ) : (
                    <Circle size={20} color={colors.textFaint} />
                  )}
                </Pressable>

                {/* 幅の狭い端末でも日付と時刻が欠けないよう、この2つは縮めず、
                    タイトルだけが省略される。 */}
                <View style={styles.when}>
                  <Text style={styles.whenDate}>
                    {task.targetDateObj ? formatRelativeDay(task.targetDateObj, today) : '未定'}
                  </Text>
                  <Text style={styles.whenTime}>
                    {task.kind === 'event' ? formatTimeRange(task.startTime, task.endTime) : ''}
                  </Text>
                </View>

                <Text numberOfLines={1} style={styles.taskTitle}>
                  {task.title}
                </Text>
                {task.remindMinutesBefore !== null && (
                  <BellRing size={12} color={colors.milkProgress} />
                )}
                {task.participants.length > 0 && (
                  <View
                    style={[
                      styles.label,
                      { backgroundColor: tone.background, borderColor: tone.border },
                    ]}
                  >
                    <Text style={[styles.labelText, { color: tone.text }]}>
                      {task.participants.join('・')}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // 親から与えられた高さの中に必ず収め、はみ出す分は一覧のスクロールに回す。
  section: { flex: 1, minHeight: 0, gap: 6, overflow: 'hidden' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  overdue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.alertSurface,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  overdueText: { fontSize: 11, fontWeight: '500', color: colors.alertText },
  add: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.navActive,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { fontSize: 13, color: colors.textFaint, textAlign: 'center', paddingVertical: 12 },
  list: { flex: 1, minHeight: 0 },
  // 末尾の行が枠の縁で切れて見えないよう、最後まで送ったときに余白が残るようにする。
  listContent: { gap: 6, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  when: { minWidth: 52 },
  whenDate: { fontSize: 12, fontWeight: '700', color: colors.navActive },
  whenTime: { fontSize: 10, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  taskTitle: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text },
  label: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  labelText: { fontSize: 10, fontWeight: '700' },
});
