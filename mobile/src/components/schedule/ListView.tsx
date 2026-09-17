import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
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
// Web版の `src/components/sukusuku/schedule/ListView.tsx` を置き換えたもの。
//
// Web版は見出しを position:sticky で貼り付けている。React Nativeに sticky は無いので、
// 同じ見え方になる SectionList（見出しが上に貼り付く一覧）で組む。

interface ListViewProps {
  tasks: DynamicTask[];
  isLoading?: boolean;
  today: Date;
  /** 生後日数の表示に使う。未登録なら空文字。 */
  birthDate: string;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
}

const TONE_COLOR: Record<ScheduleListSection['tone'], string> = {
  alert: colors.alertText,
  today: colors.navActiveText,
  plain: colors.textMuted,
};

/** 一覧に並ぶ1行。日の見出しと予定を同じ流れに置く。 */
type Row =
  | { kind: 'day'; key: string; date: Date; sectionTitle: string }
  | { kind: 'task'; key: string; task: DynamicTask; showDate?: boolean }
  | { kind: 'note'; key: string; text: string };

interface Section {
  key: string;
  title: string;
  color: string;
  count: number;
  /** 完了済みだけ、見出しを押して開け閉めする。 */
  collapsible?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  data: Row[];
}

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
      {babyAge && <Text style={styles.dayHeadingAge}>{babyAge}</Text>}
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

  if (isLoading) return <Text style={styles.message}>読み込み中...</Text>;
  if (tasks.length === 0) return <Text style={styles.message}>予定はまだありません</Text>;

  // 誕生日が未登録で日付が確定しない予定は、日付順の並びに混ぜず末尾にまとめる。
  const undated = tasks.filter((t) => !t.targetDateObj && !t.done);
  const done = tasks.filter((t) => t.done).sort(byDateDesc);

  const sections: Section[] = buildScheduleSections(tasks, today).map((section) => ({
    key: section.key,
    title: section.title,
    color: TONE_COLOR[section.tone],
    count: section.count,
    data: section.groups.flatMap<Row>((group) => [
      {
        kind: 'day',
        key: `${section.key}-day-${group.date.getTime()}`,
        date: group.date,
        sectionTitle: section.title,
      },
      ...group.tasks.map<Row>((task) => ({ kind: 'task', key: task.id, task })),
    ]),
  }));

  if (undated.length > 0) {
    sections.push({
      key: 'undated',
      title: '日付未定',
      color: colors.textMuted,
      count: undated.length,
      data: [
        {
          kind: 'note',
          key: 'undated-note',
          text: 'お子様の誕生日を設定タブで登録すると、カレンダーに表示されます。',
        },
        ...undated.map<Row>((task) => ({ kind: 'task', key: task.id, task })),
      ],
    });
  }

  if (done.length > 0) {
    // 済んだ予定は畳んでおき、見返したいときだけ開く。
    sections.push({
      key: 'done',
      title: '完了済み',
      color: colors.textMuted,
      count: done.length,
      collapsible: true,
      isOpen: showDone,
      onToggle: () => setShowDone((v) => !v),
      data: showDone
        ? done.map<Row>((task) => ({ kind: 'task', key: task.id, task, showDate: true }))
        : [],
    });
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.key}
      stickySectionHeadersEnabled
      contentContainerStyle={styles.content}
      renderSectionHeader={({ section }) => {
        const heading = (
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              {section.collapsible &&
                (section.isOpen ? (
                  <ChevronDown size={14} color={colors.textMuted} />
                ) : (
                  <ChevronRight size={14} color={colors.textMuted} />
                ))}
              <Text style={[styles.sectionTitle, { color: section.color }]}>{section.title}</Text>
            </View>
            <Text style={styles.sectionCount}>{section.count}件</Text>
          </View>
        );
        if (!section.collapsible) return heading;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: section.isOpen }}
            onPress={section.onToggle}
          >
            {heading}
          </Pressable>
        );
      }}
      renderItem={({ item }) => {
        if (item.kind === 'day') {
          return (
            <DayHeading
              date={item.date}
              today={today}
              birthDate={birthDate}
              sectionTitle={item.sectionTitle}
            />
          );
        }
        if (item.kind === 'note') return <Text style={styles.note}>{item.text}</Text>;
        return (
          <View style={styles.taskWrap}>
            <TaskRow
              task={item.task}
              onToggle={onToggleTodo}
              onOpen={onOpenTask}
              showDate={item.showDate}
            />
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  message: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700' },
  sectionCount: { fontSize: 11, color: colors.textFaint },
  dayHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 6,
  },
  dayHeadingDate: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  dayHeadingRelative: { fontSize: 11, color: colors.textMuted },
  dayHeadingAge: { fontSize: 11, color: colors.textFaint },
  note: { fontSize: 11, color: colors.textFaint, paddingHorizontal: 4, paddingBottom: 8, lineHeight: 17 },
  taskWrap: { paddingBottom: 8 },
});
