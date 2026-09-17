import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Filter,
} from 'lucide-react-native';
import type { CareLog, DynamicTask, Label, ScheduleView, Task, UserProfile } from '@/types/app';
import { LABELS } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { getProfile } from '@/lib/api/profile';
import {
  deleteTask as deleteTaskApi,
  insertTask,
  listTasks,
  updateTask as updateTaskApi,
  updateTaskDone,
} from '@/lib/api/tasks';
import { listCareLogsInRange } from '@/lib/api/careLogs';
import { readCachedLogsInRange } from '@/lib/offline/careLogs';
import {
  addDays,
  addMonths,
  calculateTargetDate,
  formatDateHeading,
  formatDateString,
  isSameDay,
  isSameMonth,
  parseDateString,
  startOfDay,
  startOfWeek,
  toDateString,
} from '@/lib/dateUtils';
import { byDateThenTime, tasksOnDate } from '@/lib/scheduleUtils';
import { getLabelColors, getProfileFieldValue } from '@/lib/uiUtils';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import MonthView from '@/components/schedule/MonthView';
import WeekView from '@/components/schedule/WeekView';
import DayView from '@/components/schedule/DayView';
import ListView from '@/components/schedule/ListView';
import TaskDetailModal from '@/components/schedule/TaskDetailModal';
import AddTaskModal, { type TaskDraft } from '@/components/schedule/AddTaskModal';

// 予定タブ。Web版の `src/components/sukusuku/tabs/ScheduleTab.tsx` を
// React Nativeに置き換えたもの。表示の切り替え・絞り込み・日付の送り・
// 月/週/日/リストの中身は同じにしてある。
//
// Web版はアプリ全体で1つ持っている状態を受け取るが、こちらはタブごとの画面なので
// この画面で読む（プロフィール・予定・表示中の範囲の育児記録）。

const LABEL_FILTERS: (Label | 'すべて')[] = ['すべて', ...LABELS];

const VIEW_TABS: { id: ScheduleView; label: string }[] = [
  { id: 'month', label: '月' },
  { id: 'week', label: '週' },
  { id: 'day', label: '日' },
  { id: 'list', label: 'リスト' },
];

const formatShortDate = (date: Date): string => `${date.getMonth() + 1}月${date.getDate()}日`;

const emptyTaskDraft = (date: Date): TaskDraft => ({
  title: '',
  place: '',
  note: '',
  anchorType: 'absolute',
  startDate: toDateString(date),
  startTime: null,
  endTime: null,
  daysAfterBirth: 0,
  label: '家族',
  remindMinutesBefore: null,
  timing: '',
});

export default function ScheduleScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;
  const router = useRouter();

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [todos, setTodos] = useState<Task[]>([]);
  const [isLoadingTodos, setIsLoadingTodos] = useState(true);

  const [view, setView] = useState<ScheduleView>('month');
  const [labelFilter, setLabelFilter] = useState<Label | 'すべて'>('すべて');
  const [isPickingFilter, setIsPickingFilter] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [calendarDate, setCalendarDate] = useState(() => startOfDay(new Date()));

  const [careLogs, setCareLogs] = useState<CareLog[]>([]);
  const [loadedLogRange, setLoadedLogRange] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<DynamicTask | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [tempEditingTask, setTempEditingTask] = useState<DynamicTask | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTask, setNewTask] = useState<TaskDraft>(() => emptyTaskDraft(new Date()));

  const today = useMemo(() => startOfDay(new Date()), []);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const [loadedProfile, loadedTasks] = await Promise.all([
          getProfile(supabase, membership.familyId),
          listTasks(supabase, membership.familyId),
        ]);
        if (!isMounted) return;
        setProfile(loadedProfile);
        setTodos(loadedTasks);
      } catch {
        // 圏外でも画面は出す。出せるところまで出して、残りは空のままにする。
      } finally {
        if (isMounted) setIsLoadingTodos(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const birthDate = profile ? getProfileFieldValue(profile, 'birthDate') : '';

  // 日付指定の予定は start_date をそのまま使い、
  // 出生日基準の予定は「子の誕生日 + 生後日数」で解決する。
  const dynamicTodos = useMemo<DynamicTask[]>(
    () =>
      todos.map((todo) => {
        const targetDateObj =
          todo.anchorType === 'absolute'
            ? parseDateString(todo.startDate ?? '')
            : calculateTargetDate(birthDate, todo.daysAfterBirth);
        return { ...todo, targetDateObj, targetDate: formatDateString(targetDateObj) };
      }),
    [todos, birthDate],
  );

  const filteredTodos = useMemo(
    () => dynamicTodos.filter((t) => labelFilter === 'すべて' || t.label === labelFilter),
    [dynamicTodos, labelFilter],
  );

  const weekStart = startOfWeek(selectedDate);
  const monthStart = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);

  // 週表示・日表示に出す育児記録。表示中の範囲だけを取りに行く。
  // 月表示は記録を出さないため、月をめくっても問い合わせは起きない。
  const logRange = useMemo(() => {
    if (view === 'day') {
      const from = startOfDay(selectedDate);
      return { from, to: addDays(from, 1) };
    }
    if (view === 'week') {
      const from = startOfWeek(selectedDate);
      return { from, to: addDays(from, 7) };
    }
    return null;
  }, [view, selectedDate]);

  // 範囲が変わったときだけ取り直す（週表示で同じ週の中の日を選び直しても再取得しない）。
  // これから来る日には記録が存在しないため、未来だけの範囲は問い合わせない。
  const logFrom = logRange?.from.getTime() ?? null;
  const logTo = logRange?.to.getTime() ?? null;
  const needsLogs = logFrom !== null && logTo !== null && logFrom <= today.getTime();
  const logRangeKey = logFrom === null || logTo === null ? null : `${logFrom}-${logTo}`;
  const isLogsLoaded = loadedLogRange === logRangeKey;
  const visibleLogs = needsLogs && isLogsLoaded ? careLogs : [];
  const isLoadingCareLogs = needsLogs && !isLogsLoaded;

  useEffect(() => {
    if (!familyId || !needsLogs || logFrom === null || logTo === null || logRangeKey === null) return;
    let cancelled = false;
    const from = new Date(logFrom);
    const to = new Date(logTo);
    void (async () => {
      // 圏外でも出せるよう、端末の控えを先に出してからサーバーの返事で置き換える。
      try {
        const cached = await readCachedLogsInRange(familyId, from, to);
        if (!cancelled && cached.length > 0) {
          setCareLogs(cached);
          setLoadedLogRange(logRangeKey);
        }
      } catch {
        // 控えが読めなくてもサーバーから取り直せばよい。
      }
      try {
        const data = await listCareLogsInRange(supabase, familyId, from, to);
        if (!cancelled) setCareLogs(data);
      } catch {
        // 取れなければ控えのまま（控えも無ければ「記録なし」になる）。
      } finally {
        // 成功・失敗どちらでも「この範囲は取得済み」にして読み込み表示を終わらせる。
        if (!cancelled) setLoadedLogRange(logRangeKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familyId, needsLogs, logFrom, logTo, logRangeKey]);

  // 日を選ぶと日表示へ移る（月・週は俯瞰、日は詳細という役割分担）。
  const selectDate = (date: Date, openDayView = true) => {
    const day = startOfDay(date);
    setSelectedDate(day);
    if (!isSameMonth(day, calendarDate)) {
      setCalendarDate(new Date(day.getFullYear(), day.getMonth(), 1));
    }
    if (openDayView) setView('day');
  };

  const step = (delta: number) => {
    if (view === 'month') {
      setCalendarDate(addMonths(monthStart, delta));
      return;
    }
    selectDate(addDays(selectedDate, view === 'week' ? delta * 7 : delta), false);
  };

  const goToday = () => {
    setCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  };

  const openPicker = () =>
    DateTimePickerAndroid.open({
      value: view === 'month' ? monthStart : selectedDate,
      mode: 'date',
      onChange: (_event, picked) => {
        if (!picked) return;
        // 月表示は月だけを見るので、選んだ日の月へ移る。
        if (view === 'month') setCalendarDate(new Date(picked.getFullYear(), picked.getMonth(), 1));
        else selectDate(picked, false);
      },
    });

  const toggleTodo = useCallback(
    async (task: DynamicTask) => {
      const nextDone = !task.done;
      // 楽観的更新
      setTodos((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: nextDone } : t)));
      setSelectedTask((prev) => (prev && prev.id === task.id ? { ...prev, done: nextDone } : prev));
      try {
        await updateTaskDone(supabase, task.id, nextDone);
      } catch {
        // 送れなければ元に戻す。圏外での予定の書き込みはまだ控えていない。
        setTodos((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !nextDone } : t)));
        setSelectedTask((prev) =>
          prev && prev.id === task.id ? { ...prev, done: !nextDone } : prev,
        );
      }
    },
    [],
  );

  const openTaskDetail = (task: DynamicTask) => {
    setSelectedTask(task);
    setIsEditingTask(false);
    setTempEditingTask(task);
  };

  const saveTaskEdit = async () => {
    if (!tempEditingTask) return;
    const updated = tempEditingTask;
    setTodos((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
    setSelectedTask(updated);
    setIsEditingTask(false);
    try {
      await updateTaskApi(supabase, updated);
    } catch {
      Alert.alert('保存に失敗しました', 'もう一度お試しください。');
    }
  };

  const handleDeleteTask = async (id: string) => {
    const previous = todos;
    setTodos((prev) => prev.filter((t) => t.id !== id));
    setSelectedTask(null);
    try {
      await deleteTaskApi(supabase, id);
    } catch {
      setTodos(previous);
      Alert.alert('削除に失敗しました', 'もう一度お試しください。');
    }
  };

  const handleAddTask = async () => {
    if (!familyId || newTask.title === '') return;
    const input = { ...newTask };
    setShowAddModal(false);
    setNewTask(emptyTaskDraft(selectedDate));
    try {
      const created = await insertTask(supabase, familyId, input);
      setTodos((prev) => [...prev, created]);
    } catch {
      Alert.alert('予定の追加に失敗しました', 'もう一度お試しください。');
    }
  };

  // カレンダーで選んでいる日を初期値にして予定を追加する。
  const openAddTaskModal = (date: Date) => {
    setNewTask(emptyTaskDraft(date));
    setShowAddModal(true);
  };

  if (isSessionLoading) return null;
  if (!session) return <Redirect href="/login" />;

  const title =
    view === 'month'
      ? `${monthStart.getFullYear()}年 ${monthStart.getMonth() + 1}月`
      : view === 'week'
        ? `${formatShortDate(weekStart)} - ${formatShortDate(addDays(weekStart, 6))}`
        : formatDateHeading(selectedDate, today);

  const isShowingToday =
    view === 'month'
      ? isSameMonth(monthStart, today)
      : view === 'week'
        ? isSameDay(weekStart, startOfWeek(today))
        : isSameDay(selectedDate, today);

  const tasksInMonth = filteredTodos.filter(
    (t) => t.targetDateObj && isSameMonth(t.targetDateObj, monthStart),
  );

  // 予定のない月をめくり続けなくて済むよう、次に予定がある日へ直接飛べるようにする。
  const nextMonthWithTask = filteredTodos
    .filter((t) => t.targetDateObj && t.targetDateObj >= addMonths(monthStart, 1))
    .sort(byDateThenTime)[0]?.targetDateObj;

  const filterTone = labelFilter === 'すべて' ? null : getLabelColors(labelFilter);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* 表示の切り替えと担当の絞り込みは同じ1段に置く（スマホで縦の高さを予定表に回すため）。 */}
      <View style={styles.toolbar}>
        <SegmentedTabs
          accessibilityLabel="スケジュールの表示"
          value={view}
          onChange={setView}
          options={VIEW_TABS}
          fill={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="担当で絞り込む"
          onPress={() => setIsPickingFilter(true)}
          style={[
            styles.filter,
            filterTone !== null && {
              backgroundColor: filterTone.background,
              borderColor: filterTone.border,
            },
          ]}
        >
          <Filter size={14} color={filterTone?.text ?? colors.textSubtle} />
          <Text style={[styles.filterText, filterTone !== null && { color: filterTone.text }]}>
            {labelFilter}
          </Text>
          <ChevronDown size={14} color={filterTone?.text ?? colors.textSubtle} />
        </Pressable>
      </View>

      {view !== 'list' && (
        <View style={styles.dateBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="前へ"
            onPress={() => step(-1)}
            hitSlop={8}
            style={styles.arrow}
          >
            <ChevronLeft size={20} color={colors.textSubtle} />
          </Pressable>

          <View style={styles.dateTitleRow}>
            <Text style={styles.dateTitle}>{title}</Text>
            {/* 端末のピッカーで任意の月・日へ直接ジャンプする */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={view === 'month' ? '月を選ぶ' : '日付を選ぶ'}
              onPress={openPicker}
              hitSlop={8}
            >
              <CalendarDays size={16} color={colors.textFaint} />
            </Pressable>
            {!isShowingToday && (
              <Pressable accessibilityRole="button" onPress={goToday} style={styles.todayButton}>
                <Text style={styles.todayButtonText}>今日</Text>
              </Pressable>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="次へ"
            onPress={() => step(1)}
            hitSlop={8}
            style={styles.arrow}
          >
            <ChevronRight size={20} color={colors.textSubtle} />
          </Pressable>
        </View>
      )}

      {/* タブ全体はスクロールさせない。月表示は与えられた高さに収め、
          週・日・リストは中身だけをスクロールさせる（ルートの CLAUDE.md）。 */}
      {view === 'month' && (
        <View style={styles.month}>
          <MonthView
            month={monthStart}
            today={today}
            selectedDate={selectedDate}
            tasks={filteredTodos}
            birthDate={birthDate}
            onSelectDate={(date) => selectDate(date)}
            onOpenTask={openTaskDetail}
          />
          {!isLoadingTodos && tasksInMonth.length === 0 && nextMonthWithTask && (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setCalendarDate(
                  new Date(nextMonthWithTask.getFullYear(), nextMonthWithTask.getMonth(), 1),
                )
              }
              style={styles.nextMonth}
            >
              <CornerDownRight size={14} color={colors.accentBlue} />
              <Text style={styles.nextMonthText}>
                次に予定がある月へ ({nextMonthWithTask.getFullYear()}年
                {nextMonthWithTask.getMonth() + 1}月)
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {view !== 'month' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {view === 'week' && (
            <WeekView
              date={selectedDate}
              today={today}
              tasks={filteredTodos}
              birthDate={birthDate}
              careLogs={visibleLogs}
              isLoadingCareLogs={isLoadingCareLogs}
              onSelectDate={(date) => selectDate(date)}
              onToggleTodo={toggleTodo}
              onOpenTask={openTaskDetail}
            />
          )}

          {view === 'day' && (
            <DayView
              date={selectedDate}
              today={today}
              tasks={tasksOnDate(filteredTodos, selectedDate)}
              birthDate={birthDate}
              careLogs={visibleLogs}
              isLoadingCareLogs={isLoadingCareLogs}
              onToggleTodo={toggleTodo}
              onOpenTask={openTaskDetail}
              onAddTask={openAddTaskModal}
              onOpenLogTab={(date) =>
                router.push({ pathname: '/log', params: { date: toDateString(date) } })
              }
            />
          )}

          {view === 'list' && (
            <ListView
              tasks={filteredTodos}
              isLoading={isLoadingTodos}
              today={today}
              birthDate={birthDate}
              onToggleTodo={toggleTodo}
              onOpenTask={openTaskDetail}
            />
          )}
        </ScrollView>
      )}

      {/* 絞り込みの選択。Web版は選択（select）だが、React Nativeには同じものが無いので
          選択肢を出して選ぶ形にする。出る中身・並びは同じ。 */}
      <Modal
        visible={isPickingFilter}
        transparent
        animationType="fade"
        onRequestClose={() => setIsPickingFilter(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setIsPickingFilter(false)}>
          <View style={styles.picker}>
            {LABEL_FILTERS.map((option) => {
              const selected = option === labelFilter;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setLabelFilter(option);
                    setIsPickingFilter(false);
                  }}
                  style={[styles.pickerOption, selected && styles.pickerOptionSelected]}
                >
                  <Text style={[styles.pickerText, selected && styles.pickerTextSelected]}>
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      <AddTaskModal
        show={showAddModal}
        newTask={newTask}
        allowBirthRelative={birthDate === ''}
        onChange={setNewTask}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddTask}
      />

      <TaskDetailModal
        selectedTask={selectedTask}
        isEditingTask={isEditingTask}
        tempEditingTask={tempEditingTask}
        allowBirthRelative={birthDate === ''}
        onStartEdit={() => setIsEditingTask(true)}
        onChangeTempEditingTask={setTempEditingTask}
        onSaveEdit={saveTaskEdit}
        onClose={() => setSelectedTask(null)}
        onToggleDone={() => selectedTask && void toggleTodo(selectedTask)}
        onDelete={() => selectedTask && void handleDeleteTask(selectedTask.id)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  filter: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 44,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  filterText: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 8,
    marginBottom: 12,
  },
  arrow: { padding: 8 },
  dateTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  todayButton: {
    backgroundColor: colors.accentBlueSurface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  todayButtonText: { fontSize: 11, fontWeight: '700', color: colors.accentBlueStrong },
  month: { flex: 1, paddingBottom: 12 },
  nextMonth: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  nextMonthText: { fontSize: 13, fontWeight: '500', color: colors.accentBlue },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  picker: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 8,
  },
  pickerOption: { paddingHorizontal: 16, paddingVertical: 12 },
  pickerOptionSelected: { backgroundColor: colors.accentBlueSurface },
  pickerText: { fontSize: 14, color: colors.text },
  pickerTextSelected: { fontWeight: '700', color: colors.accentBlueText },
});
