import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  MapPin,
  Plus,
} from 'lucide-react-native';
import type { DynamicTask } from '@/types/app';
import { WEEKDAY_LABELS, startOfDay } from '@/lib/dateUtils';
import { byDateThenTime } from '@/lib/scheduleUtils';
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

/** 「10/19(月)」の形。日数の計算はせず、日付そのものを出す。 */
const formatMonthDay = (date: Date): string =>
  `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]})`;

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
            const owner = task.owner ?? (task.participants.length === 1 ? task.participants[0] : '');
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

                {/* 列をそろえるため、日付は幅を固定して2段（上に年、下に月日と曜日）で出す。
                    時刻は一覧では出さない（詳細で見る）。 */}
                <View style={styles.when}>
                  <Text style={styles.whenYear}>
                    {task.targetDateObj ? `${task.targetDateObj.getFullYear()}年` : ' '}
                  </Text>
                  <Text numberOfLines={1} style={styles.whenDate}>
                    {task.targetDateObj ? formatMonthDay(task.targetDateObj) : '未定'}
                  </Text>
                </View>

                <View style={styles.main}>
                  <Text numberOfLines={1} style={styles.taskTitle}>
                    {task.title}
                  </Text>
                  {task.place !== '' && (
                    <View style={styles.placeRow}>
                      <MapPin size={11} color={colors.textFaint} />
                      <Text numberOfLines={1} style={styles.place}>
                        {task.place}
                      </Text>
                    </View>
                  )}
                </View>

                {/* 主催者（主体）。主体が未設定の古い予定は、参加者が1人のときだけその人を出す。 */}
                <View
                  style={[
                    styles.label,
                    owner !== '' && { backgroundColor: tone.background, borderColor: tone.border },
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.labelText, { color: tone.text }]}>
                    {owner}
                  </Text>
                </View>
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
  // 列の幅は固定して、行ごとに並びがずれないようにする（日付・主催者）。
  when: { width: 72 },
  whenYear: { fontSize: 10, fontWeight: '500', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  whenDate: { fontSize: 13, fontWeight: '700', color: colors.navActive, fontVariant: ['tabular-nums'] },
  main: { flex: 1, minWidth: 0, gap: 1 },
  taskTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  place: { flex: 1, fontSize: 11, fontWeight: '500', color: colors.textMuted },
  label: {
    width: 48,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 4,
    paddingVertical: 1,
  },
  labelText: { fontSize: 10, fontWeight: '700' },
});
