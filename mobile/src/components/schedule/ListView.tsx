import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import type { DynamicTask } from '@/types/app';
import { formatDateHeading } from '@/lib/dateUtils';
import { formatBabyAgeAt } from '@/lib/milestones';
import {
  buildScheduleSections,
  byDateDesc,
  formatRelativeDay,
  type ScheduleListSection,
} from '@/lib/scheduleUtils';
import { colors } from '@/lib/theme';
import TaskRow from './TaskRow';

// 予定を期限の近さでまとめた一覧。先の予定をまとめて確かめるための面。
// Web版の `src/components/sukusuku/schedule/ListView.tsx` と同じ並び・見出し。

interface ListViewProps {
  tasks: DynamicTask[];
  isLoading?: boolean;
  today: Date;
  /** 生後日数の表示に使う。未登録なら空文字。 */
  birthDate: string;
  onToggleTodo: (task: DynamicTask) => void;
  onOpenTask: (task: DynamicTask) => void;
}

const SECTION_TONE: Record<ScheduleListSection['tone'], string> = {
  alert: colors.overdueText,
  today: colors.accentBlueStrong,
  plain: colors.textMuted,
};

/** 日付・曜日と相対表記をまとめた1日の見出し。予定の行には日付を繰り返さない。 */
function DayHeading({
  date,
  today,
  birthDate,
  sectionTitle,
}: {
  date: Date;
  today: Date;
  birthDate: string;
  sectionTitle: string;
}) {
  const relative = formatRelativeDay(date, today);
  const babyAge = formatBabyAgeAt(birthDate, date);

  return (
    <View style={styles.dayHeading}>
      <Text style={styles.dayHeadingDate}>{formatDateHeading(date, today)}</Text>
      {/* セクションの見出しと同じことを繰り返さない（「今日」の中の「今日」など）。 */}
      {relative !== sectionTitle && <Text style={styles.dayHeadingRelative}>{relative}</Text>}
      {babyAge !== null && <Text style={styles.dayHeadingAge}>{babyAge}</Text>}
    </View>
  );
}

export default function ListView({
  tasks,
  isLoading,
  today,
  birthDate,
  onToggleTodo,
  onOpenTask,
}: ListViewProps) {
  const [showDone, setShowDone] = useState(false);

  const sections = buildScheduleSections(tasks, today);
  // 誕生日が未登録で日付が確定しない予定は、日付順の並びに混ぜず末尾にまとめる。
  const undated = tasks.filter((t) => !t.targetDateObj && !t.done);
  const done = tasks.filter((t) => t.done).sort(byDateDesc);

  if (isLoading) return <Text style={styles.notice}>読み込み中...</Text>;
  if (tasks.length === 0) return <Text style={styles.notice}>予定はまだありません</Text>;

  return (
    <View style={styles.body}>
      {sections.map((section) => (
        <View key={section.key}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: SECTION_TONE[section.tone] }]}>
              {section.title}
            </Text>
            <Text style={styles.sectionCount}>{section.count}件</Text>
          </View>
          <View style={styles.groups}>
            {section.groups.map((group) => (
              <View key={group.date.getTime()}>
                <DayHeading
                  date={group.date}
                  today={today}
                  birthDate={birthDate}
                  sectionTitle={section.title}
                />
                <View style={styles.tasks}>
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={onToggleTodo}
                      onOpen={onOpenTask}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}

      {undated.length > 0 && (
        <View>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>日付未定</Text>
            <Text style={styles.sectionCount}>{undated.length}件</Text>
          </View>
          <Text style={styles.undatedNote}>
            お子様の誕生日を設定タブで登録すると、カレンダーに表示されます。
          </Text>
          <View style={styles.tasks}>
            {undated.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
            ))}
          </View>
        </View>
      )}

      {done.length > 0 && (
        <View>
          {/* 済んだ予定は畳んでおき、見返したいときだけ開く。 */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDone }}
            onPress={() => setShowDone((v) => !v)}
            style={styles.doneToggle}
          >
            <View style={styles.doneToggleLabel}>
              {showDone ? (
                <ChevronDown size={14} color={colors.textMuted} />
              ) : (
                <ChevronRight size={14} color={colors.textMuted} />
              )}
              <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>完了済み</Text>
            </View>
            <Text style={styles.sectionCount}>{done.length}件</Text>
          </Pressable>
          {showDone && (
            <View style={[styles.tasks, styles.doneList]}>
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={onToggleTodo}
                  onOpen={onOpenTask}
                  showDate
                />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 20 },
  notice: { fontSize: 13, color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700' },
  sectionCount: { fontSize: 11, color: colors.textFaint },
  groups: { gap: 12 },
  dayHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  dayHeadingDate: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  dayHeadingRelative: { fontSize: 11, color: colors.textMuted },
  dayHeadingAge: { fontSize: 11, color: colors.textFaint },
  tasks: { gap: 8 },
  undatedNote: {
    fontSize: 11,
    color: colors.textFaint,
    lineHeight: 17,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  doneToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  doneToggleLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  doneList: { marginTop: 6 },
});
