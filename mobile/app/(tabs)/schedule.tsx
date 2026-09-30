import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Plus,
} from 'lucide-react-native';
import type { CareLog, DynamicTask, LoginRole, Participant, ScheduleView, Task, UserProfile } from '@/types/app';
import { ROLE_TO_PARTICIPANT } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useRefreshOnFocus } from '@/lib/screenFocus';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { getProfile } from '@/lib/api/profile';
import { deleteTask, insertTask, listTasks, updateTask, updateTaskDone } from '@/lib/api/tasks';
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
  toDateString,
} from '@/lib/dateUtils';
import { byDateThenTime, tasksOnDate } from '@/lib/scheduleUtils';
import { describeError, getProfileFieldValue } from '@/lib/uiUtils';
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation';
import MonthView from '@/components/schedule/MonthView';
import DayView from '@/components/schedule/DayView';
import ListView from '@/components/schedule/ListView';
import UpcomingTasks from '@/components/schedule/UpcomingTasks';
import AddTaskModal, { type TaskDraft } from '@/components/schedule/AddTaskModal';
import TaskDetailModal from '@/components/schedule/TaskDetailModal';

// 予定タブ。Web版の `src/components/sukusuku/tabs/ScheduleTab.tsx` を
// React Nativeに置き換えたもの。出す項目・並び・文言は同じにしてある。
//
// Web版はアプリ全体で持っている状態を受け取るが、こちらはタブごとの画面なので
// 予定・プロフィール・表示中の範囲の記録をこの画面で読む。
//
// 画面の作り方はルートの CLAUDE.md に従い、日付送りは固定して、
// スクロールは予定の一覧だけに閉じる。
//
// 面は月（初期表示）・日（日をタップ）・リスト（「直近のスケジュール」の見出しをタップ）の3つ。
// 切り替えの帯は置かず、日・リストからは戻るボタン（Androidの戻る操作も）で月へ戻る。

// owner: ログイン中の役割から決まる主体（未ログイン相当ならnull）。
// 主体が決まっているときは参加者にも同じ人を初期値として入れる。
const emptyTaskDraft = (date: Date, owner: Participant | null): TaskDraft => ({
  title: '',
  place: '',
  note: '',
  kind: 'event',
  anchorType: 'absolute',
  startDate: toDateString(date),
  startTime: null,
  endTime: null,
  daysAfterBirth: 0,
  owner,
  participants: owner ? [owner] : [],
  remindMinutesBefore: null,
  isPrivate: false,
  recurrence: null,
  timing: '',
});

export default function ScheduleScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;
  const router = useRouter();

  const today = useMemo(() => new Date(), []);

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [loginRole, setLoginRole] = useState<LoginRole>(null);
  // ログイン中の役割から決まる主体。新規の予定・タスクの初期値に使う。
  const ownerFromRole = loginRole ? ROLE_TO_PARTICIPANT[loginRole] : null;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [todos, setTodos] = useState<Task[]>([]);
  const [isLoadingTodos, setIsLoadingTodos] = useState(true);

  const [view, setView] = useState<ScheduleView>('month');
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(today));
  const [currentCalendarDate, setCurrentCalendarDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const [careLogs, setCareLogs] = useState<CareLog[]>([]);
  const [loadedLogRange, setLoadedLogRange] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newTask, setNewTask] = useState<TaskDraft>(() => emptyTaskDraft(today, null));
  const [selectedTask, setSelectedTask] = useState<DynamicTask | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [tempEditingTask, setTempEditingTask] = useState<DynamicTask | null>(null);

  // 日表示の育児記録を読み直すための印。記録タブで記録した分に追いつかせるために使う。
  const [logReloadKey, setLogReloadKey] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        setLoginRole(membership.role);
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

  // 他のタブで変えた分に追いつかせる。予定はホームでもチェックを付けられ、子の生年月日は
  // 設定タブで変わる（出生日基準の予定の日付が動く）。日表示の記録は記録タブで増える。
  // 読み込み中の表示には戻さず、届いたら差し替える。
  useRefreshOnFocus(() => {
    setLogReloadKey((prev) => prev + 1);
    if (!familyId) return;
    void Promise.all([getProfile(supabase, familyId), listTasks(supabase, familyId)])
      .then(([loadedProfile, loadedTasks]) => {
        setProfile(loadedProfile);
        setTodos(loadedTasks);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

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

  const monthStart = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), 1);

  // 日表示に出す育児記録。表示中の範囲だけを取りに行く。
  // 月表示・週表示は記録を出さないため、めくっても問い合わせは起きない。
  const logRange = useMemo(() => {
    if (view === 'day') {
      const from = startOfDay(selectedDate);
      return { from, to: addDays(from, 1) };
    }
    return null;
  }, [view, selectedDate]);

  // 範囲が変わったときだけ取り直す。
  // これから来る日には記録が存在しないため、未来だけの範囲は問い合わせない。
  const logFrom = logRange?.from.getTime() ?? null;
  const logTo = logRange?.to.getTime() ?? null;
  const needsLogs = logFrom !== null && logTo !== null && logFrom <= today.getTime();
  // 取得済みの範囲。表示中の範囲と一致していなければ読み込み中とみなす。
  // 週の初日を日表示で開くと頭の時刻が週表示と同じになるため、終わりも含めて見分ける。
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
      // 圏外でも出せるよう、記録タブと同じく端末の控えを先に出してから、
      // サーバーの返事で置き換える（控えを書くのは記録タブの役目なのでここでは読むだけ）。
      try {
        const cached = await readCachedLogsInRange(familyId, from, to);
        if (!cancelled && cached.length > 0) {
          setCareLogs(cached);
          setLoadedLogRange(logRangeKey);
        }
      } catch {
        // 控えが読めなくても、このあとサーバーから取り直せばよい。
      }
      try {
        const data = await listCareLogsInRange(supabase, familyId, from, to);
        if (!cancelled) setCareLogs(data);
      } catch {
        // 取れなければ控えのまま。控えも無ければ「記録なし」になる。
      } finally {
        // 成功・失敗どちらでも「この範囲は取得済み」にして読み込み表示を終わらせる
        if (!cancelled) setLoadedLogRange(logRangeKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familyId, needsLogs, logFrom, logTo, logRangeKey, logReloadKey]);

  // 日を選ぶと日表示へ移る（月・週は俯瞰、日は詳細という役割分担）。
  const selectDate = (date: Date, openDayView = true) => {
    const day = startOfDay(date);
    setSelectedDate(day);
    if (!isSameMonth(day, currentCalendarDate)) {
      setCurrentCalendarDate(new Date(day.getFullYear(), day.getMonth(), 1));
    }
    if (openDayView) setView('day');
  };

  const step = (delta: number) => {
    if (view === 'month') {
      setCurrentCalendarDate(addMonths(monthStart, delta));
      return;
    }
    selectDate(addDays(selectedDate, delta), false);
  };

  const goToday = () => {
    setCurrentCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(startOfDay(today));
  };

  // 矢印ボタンと同じ操作を、画面上どこでの横スワイプでもできるようにする。
  // 一覧表示（list）には日付送りが無いため、それ以外の表示中だけ有効にする。
  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: () => step(1),
    onSwipeRight: () => step(-1),
    enabled: view !== 'list',
  });

  // 日・リストからは、Androidの戻る操作でも月へ戻る（切り替えの帯を置かないぶん、戻り道を用意する）。
  useFocusEffect(
    useCallback(() => {
      if (view === 'month') return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setView('month');
        return true;
      });
      return () => subscription.remove();
    }, [view]),
  );

  // 任意の月・日へ直接ジャンプする。Web版は <input type="month"> / <input type="date"> だが、
  // Androidに月のピッカーは無いので、月表示でも日付のピッカーから年と月だけを受け取る。
  const openJumpPicker = () =>
    DateTimePickerAndroid.open({
      value: view === 'month' ? monthStart : selectedDate,
      mode: 'date',
      onChange: (_event, picked) => {
        if (!picked) return;
        if (view === 'month') setCurrentCalendarDate(new Date(picked.getFullYear(), picked.getMonth(), 1));
        else selectDate(picked, false);
      },
    });

  const title =
    view === 'month'
      ? `${monthStart.getFullYear()}年 ${monthStart.getMonth() + 1}月`
      : formatDateHeading(selectedDate, today);

  const isShowingToday =
    view === 'month' ? isSameMonth(monthStart, today) : isSameDay(selectedDate, today);

  const tasksInMonth = dynamicTodos.filter(
    (t) => t.targetDateObj && isSameMonth(t.targetDateObj, monthStart),
  );

  // 予定のない月をめくり続けなくて済むよう、次に予定がある日へ直接飛べるようにする。
  const nextMonthWithTask = dynamicTodos
    .filter((t) => t.targetDateObj && t.targetDateObj >= addMonths(monthStart, 1))
    .sort(byDateThenTime)[0]?.targetDateObj;

  const toggleTodo = useCallback(
    async (id: string) => {
      const target = todos.find((t) => t.id === id);
      if (!target) return;
      const nextDone = !target.done;

      // 楽観的更新
      setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, done: nextDone } : todo)));
      setSelectedTask((prev) => (prev && prev.id === id ? { ...prev, done: nextDone } : prev));

      try {
        await updateTaskDone(supabase, id, nextDone);
      } catch {
        // 失敗時はロールバック
        setTodos((prev) =>
          prev.map((todo) => (todo.id === id ? { ...todo, done: !nextDone } : todo)),
        );
        setSelectedTask((prev) => (prev && prev.id === id ? { ...prev, done: !nextDone } : prev));
      }
    },
    [todos],
  );

  const openTaskDetail = (task: DynamicTask) => {
    setSelectedTask(task);
    setIsEditingTask(false);
    setTempEditingTask(task);
  };

  const saveTaskEdit = async () => {
    if (!tempEditingTask) return;
    const updated = tempEditingTask;
    const previousTodos = todos;
    const previousSelectedTask = selectedTask;

    setTodos((prev) => prev.map((todo) => (todo.id === updated.id ? { ...todo, ...updated } : todo)));
    setSelectedTask(updated);
    setIsEditingTask(false);

    try {
      await updateTask(supabase, updated);
    } catch (err) {
      // 失敗したまま新しい値を表示し続けると、保存できたと誤解されるため元に戻す
      setTodos(previousTodos);
      setSelectedTask(previousSelectedTask);
      setIsEditingTask(true);
      Alert.alert('保存できませんでした', `もう一度お試しください。${describeError(err)}`);
    }
  };

  const handleDeleteTask = async (id: string) => {
    const previousTodos = todos;
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
    setSelectedTask(null);

    try {
      await deleteTask(supabase, id);
    } catch {
      setTodos(previousTodos);
      Alert.alert('削除できませんでした', 'もう一度お試しください。');
    }
  };

  const handleAddTask = async () => {
    if (!newTask.title || !familyId || !userId) return;
    const input = { ...newTask };

    setShowAddModal(false);
    setNewTask(emptyTaskDraft(today, ownerFromRole));

    try {
      const created = await insertTask(supabase, familyId, input, userId);
      setTodos((prev) => [...prev, created]);
    } catch {
      Alert.alert('予定を追加できませんでした', 'もう一度お試しください。');
    }
  };

  // カレンダーで選んでいる日を初期値にして予定を追加する。
  const openAddTaskModal = (date: Date) => {
    setNewTask(emptyTaskDraft(date, ownerFromRole));
    setShowAddModal(true);
  };

  // 日表示から、その日の記録タブへ移る。
  const openLogTabForDate = (date: Date) =>
    router.push({ pathname: '/log', params: { date: toDateString(date) } });

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.screen} {...swipeHandlers}>
      <View style={styles.page}>
        {/* 月以外（日・リスト）では、月へ戻るボタンを出す。 */}
        {view !== 'month' && (
          <View style={styles.backRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="月表示へ戻る"
              onPress={() => setView('month')}
              hitSlop={8}
              style={styles.backButton}
            >
              <ChevronLeft size={18} color={colors.navActive} />
              <Text style={styles.backText}>月表示</Text>
            </Pressable>
            {view === 'list' && <Text style={styles.listTitle}>すべての予定</Text>}
          </View>
        )}

        {view !== 'list' && (
          <View style={styles.nav}>
            <Pressable accessibilityRole="button" accessibilityLabel="前へ" onPress={() => step(-1)} style={styles.navArrow}>
              <ChevronLeft size={20} color={colors.textSubtle} />
            </Pressable>

            <View style={styles.navTitleRow}>
              <Text style={styles.navTitle}>{title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={view === 'month' ? '月を選ぶ' : '日付を選ぶ'}
                onPress={openJumpPicker}
                hitSlop={8}
              >
                <CalendarDays size={16} color={colors.textFaint} />
              </Pressable>
              {!isShowingToday && (
                <Pressable accessibilityRole="button" onPress={goToday} style={styles.todayButton}>
                  <Text style={styles.todayText}>今日</Text>
                </Pressable>
              )}
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel="次へ" onPress={() => step(1)} style={styles.navArrow}>
              <ChevronRight size={20} color={colors.textSubtle} />
            </Pressable>
          </View>
        )}

        {/* 月表示は、カレンダーの下に「直近のスケジュール」を並べる。高さは 5:3 で分け、
            どちらも画面全体はスクロールさせない。 */}
        {view === 'month' && (
          <View style={styles.body}>
            <View style={styles.calendar}>
              <MonthView
                month={monthStart}
                today={today}
                selectedDate={selectedDate}
                tasks={dynamicTodos}
                birthDate={birthDate}
                onSelectDate={(date) => selectDate(date)}
                onOpenTask={openTaskDetail}
              />
            </View>
            {!isLoadingTodos && tasksInMonth.length === 0 && nextMonthWithTask && (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setCurrentCalendarDate(
                    new Date(nextMonthWithTask.getFullYear(), nextMonthWithTask.getMonth(), 1),
                  )
                }
                style={styles.jump}
              >
                <CornerDownRight size={14} color={colors.navActive} />
                <Text style={styles.jumpText}>
                  次に予定がある月へ ({nextMonthWithTask.getFullYear()}年
                  {nextMonthWithTask.getMonth() + 1}月)
                </Text>
              </Pressable>
            )}
            <View style={styles.upcoming}>
              <UpcomingTasks
                tasks={dynamicTodos}
                isLoading={isLoadingTodos}
                today={today}
                onToggleTodo={toggleTodo}
                onOpenTask={openTaskDetail}
                onAddTask={() => openAddTaskModal(selectedDate)}
                onShowAll={() => setView('list')}
              />
            </View>
          </View>
        )}

        {view === 'day' && (
          <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent}>
            <DayView
              date={selectedDate}
              today={today}
              tasks={tasksOnDate(dynamicTodos, selectedDate)}
              birthDate={birthDate}
              careLogs={visibleLogs}
              isLoadingCareLogs={isLoadingCareLogs}
              onToggleTodo={toggleTodo}
              onOpenTask={openTaskDetail}
              onAddTask={openAddTaskModal}
              onOpenLogTab={openLogTabForDate}
            />
          </ScrollView>
        )}

        {view === 'list' && (
          <View style={styles.body}>
            <ListView
              tasks={dynamicTodos}
              isLoading={isLoadingTodos}
              today={today}
              birthDate={birthDate}
              onToggleTodo={toggleTodo}
              onOpenTask={openTaskDetail}
            />
          </View>
        )}
      </View>

      {/* 月表示では、右下のボタンが「直近のスケジュール」の一覧に重なって隠してしまうため、
          追加ボタンをその見出しの中に置く（UpcomingTasks）。それ以外の表示ではここに置く。 */}
      {view !== 'month' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="予定を追加"
          onPress={() => openAddTaskModal(selectedDate)}
          style={styles.fab}
        >
          <Plus size={28} color={colors.primaryText} />
        </Pressable>
      )}

      <AddTaskModal
        show={showAddModal}
        newTask={newTask}
        // 誕生日が未登録のときだけ「生後日数で指定」を選べるようにする。
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
        onToggleDone={() => selectedTask && void toggleTodo(selectedTask.id)}
        onDelete={() => selectedTask && void handleDeleteTask(selectedTask.id)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1, padding: 16, gap: 12 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  backText: { fontSize: 14, fontWeight: '700', color: colors.navActive },
  listTitle: { fontSize: 17, fontWeight: '700', color: colors.text },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 4,
  },
  navArrow: { padding: 8 },
  navTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  todayButton: {
    backgroundColor: colors.diaperSurface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  todayText: { fontSize: 12, fontWeight: '700', color: colors.navActiveText },

  body: { flex: 1, minHeight: 0 },
  // 月表示の縦の配分。カレンダー 5 : 直近のスケジュール 3。
  // 上にあった切り替えの帯をなくして空いた高さは、この比でどちらにも回る。
  calendar: { flex: 5, minHeight: 0 },
  upcoming: { flex: 3, minHeight: 0, marginTop: 12 },
  scrollContent: { paddingBottom: 96 },
  jump: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  jumpText: { fontSize: 13, fontWeight: '500', color: colors.navActive },

  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.navActive,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
});
