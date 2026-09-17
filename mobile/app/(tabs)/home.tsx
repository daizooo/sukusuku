import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AlertTriangle,
  Baby,
  BellRing,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Heart,
  MapPin,
  Phone,
  Stethoscope,
} from 'lucide-react-native';
import type { DynamicTask, MilkLog, Task, UserProfile } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { getProfile } from '@/lib/api/profile';
import { deleteTask, listTasks, updateTask, updateTaskDone } from '@/lib/api/tasks';
import { listRecentMilkLogs } from '@/lib/api/careLogs';
import { getFeedingSettings } from '@/lib/api/feedingSettings';
import { getLogTitle } from '@/lib/careLogUtils';
import {
  averageFeedingIntervalMinutes,
  DEFAULT_FEEDING_INTERVAL_MINUTES,
  type NextFeedingInfo,
} from '@/lib/feedingSchedule';
import {
  calculateTargetDate,
  formatDateString,
  formatTimeRange,
  parseDateString,
  startOfDay,
} from '@/lib/dateUtils';
import { formatRelativeDay } from '@/lib/scheduleUtils';
import { getLabelColors, getProfileFieldValue } from '@/lib/uiUtils';
import NextFeedingCard from '@/components/NextFeedingCard';
import TaskDetailModal from '@/components/schedule/TaskDetailModal';

// ホームタブ。Web版の `src/components/sukusuku/tabs/HomeTab.tsx` を
// React Nativeに置き換えたもの。出す項目・並び・文言は同じにしてある。
//
// Web版はアプリ全体で1つ持っている状態を受け取るが、こちらはタブごとの画面なので
// この画面で読む。読むものはWeb版と同じ（プロフィール・予定・直近の授乳・授乳の間隔）。

export default function HomeScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;
  const router = useRouter();

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [todos, setTodos] = useState<Task[]>([]);
  const [isLoadingTodos, setIsLoadingTodos] = useState(true);
  const [recentMilkLogs, setRecentMilkLogs] = useState<MilkLog[]>([]);
  const [isLoadingRecentMilk, setIsLoadingRecentMilk] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(DEFAULT_FEEDING_INTERVAL_MINUTES);
  const [selectedTask, setSelectedTask] = useState<DynamicTask | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [tempEditingTask, setTempEditingTask] = useState<DynamicTask | null>(null);

  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const [loadedProfile, loadedTasks, loadedMilk, settings] = await Promise.all([
          getProfile(supabase, membership.familyId),
          listTasks(supabase, membership.familyId),
          listRecentMilkLogs(supabase, membership.familyId),
          getFeedingSettings(supabase, membership.familyId),
        ]);
        if (!isMounted) return;
        setProfile(loadedProfile);
        setTodos(loadedTasks);
        setRecentMilkLogs(loadedMilk);
        setIntervalMinutes(settings.intervalMinutes);
      } catch {
        // 圏外でも画面は出す。出せるところまで出して、残りは空のままにする。
      } finally {
        if (isMounted) {
          setIsLoadingTodos(false);
          setIsLoadingRecentMilk(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const birthDateValue = profile ? getProfileFieldValue(profile, 'birthDate') : '';
  const babyName = profile ? getProfileFieldValue(profile, 'babyName') : '';

  // 日付指定の予定は start_date をそのまま使い、
  // 出生日基準の予定は「子の誕生日 + 生後日数」で解決する。
  const dynamicTodos = useMemo<DynamicTask[]>(
    () =>
      todos.map((todo) => {
        const targetDateObj =
          todo.anchorType === 'absolute'
            ? parseDateString(todo.startDate ?? '')
            : calculateTargetDate(birthDateValue, todo.daysAfterBirth);
        return { ...todo, targetDateObj, targetDate: formatDateString(targetDateObj) };
      }),
    [todos, birthDateValue],
  );

  const ageInDays = useMemo(() => {
    const birth = parseDateString(birthDateValue);
    if (!birth) return 0;
    return Math.floor((today.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
  }, [birthDateValue, today]);

  const ageInMonths = useMemo(() => {
    const birth = parseDateString(birthDateValue);
    if (!birth) return { months: 0, days: 0 };
    let months =
      (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
    let tempDate = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());
    if (today < tempDate) {
      months -= 1;
      tempDate = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());
    }
    const days = Math.floor((today.getTime() - tempDate.getTime()) / (1000 * 60 * 60 * 24));
    return { months, days };
  }, [birthDateValue, today]);

  const nextFeeding = useMemo<NextFeedingInfo>(() => {
    const lastFed = recentMilkLogs[0] ?? null;
    return {
      lastFedAt: lastFed?.time ?? null,
      lastFedTitle: lastFed ? getLogTitle(lastFed) : '',
      intervalMinutes,
      averageIntervalMinutes: averageFeedingIntervalMinutes(recentMilkLogs.map((log) => log.time)),
      isLoading: isLoadingRecentMilk,
    };
  }, [recentMilkLogs, intervalMinutes, isLoadingRecentMilk]);

  const startOfToday = startOfDay(today).getTime();
  const pendingTasks = dynamicTodos.filter((t) => !t.done);

  // 期限切れは古いものほど先頭に来るため、そのまま並べると直近の4件を
  // 食いつぶしてしまう。件数だけ知らせて、中身は予定タブの一覧に任せる。
  const overdueCount = pendingTasks.filter(
    (t) => t.targetDateObj && startOfDay(t.targetDateObj).getTime() < startOfToday,
  ).length;

  // 今日以降の予定を近い順に4件。日付未設定は後ろに回す。
  const upcomingTasks = pendingTasks
    .filter((t) => !t.targetDateObj || startOfDay(t.targetDateObj).getTime() >= startOfToday)
    .sort(
      (a, b) => (a.targetDateObj?.getTime() ?? Infinity) - (b.targetDateObj?.getTime() ?? Infinity),
    )
    .slice(0, 4);

  const toggleTodo = useCallback(
    async (id: string, done: boolean) => {
      setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !done } : t)));
      setSelectedTask((prev) => (prev && prev.id === id ? { ...prev, done: !done } : prev));
      try {
        await updateTaskDone(supabase, id, !done);
      } catch {
        // 送れなければ元に戻す。圏外での予定の書き込みはまだ控えていない。
        setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done } : t)));
        setSelectedTask((prev) => (prev && prev.id === id ? { ...prev, done } : prev));
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
      await updateTask(supabase, updated);
    } catch {
      Alert.alert('保存できませんでした', 'もう一度お試しください。');
    }
  };

  const handleDeleteTask = async (id: string) => {
    const previousTodos = todos;
    setTodos((prev) => prev.filter((t) => t.id !== id));
    setSelectedTask(null);

    try {
      await deleteTask(supabase, id);
    } catch {
      setTodos(previousTodos);
      Alert.alert('削除できませんでした', 'もう一度お試しください。');
    }
  };

  // ママがログイン中(または役割未設定)はパパの連絡先を、パパがログイン中はママの連絡先を出す。
  // 役割はまだこちらで持っていないので、Web版の既定と同じくパパの連絡先を出す。
  const quickActions = profile
    ? [
        { icon: Phone, label: '産院', phone: getProfileFieldValue(profile, 'hospitalPhone') },
        {
          icon: Stethoscope,
          label: '小児科',
          phone: getProfileFieldValue(profile, 'pediatricPhone'),
        },
        {
          icon: Building2,
          label: 'パパ会社',
          phone: getProfileFieldValue(profile, 'papaCompanyPhone'),
        },
        { icon: Heart, label: 'パパ連絡', phone: getProfileFieldValue(profile, 'papaContactPhone') },
      ]
    : [];

  const birthDate = parseDateString(birthDateValue);

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient
          colors={['#3b82f6', '#60a5fa', '#5eead4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroBaby}>
            <Baby size={128} color="rgba(255,255,255,0.2)" />
          </View>
          <View style={styles.heroLabel}>
            <Heart size={14} color={colors.primaryText} fill={colors.primaryText} />
            <Text style={styles.heroLabelText}>
              {babyName ? `${babyName}が生まれてから` : '赤ちゃんが生まれてから'}
            </Text>
          </View>

          <View style={styles.heroAge}>
            {ageInDays < 0 ? (
              <>
                <Text style={styles.heroUnitSmall}>誕生まで あと</Text>
                <Text style={styles.heroNumber}>{Math.abs(ageInDays)}</Text>
                <Text style={styles.heroUnit}>日</Text>
              </>
            ) : ageInMonths.months > 0 ? (
              // 1ヶ月を過ぎたら「◯ヶ月◯日」のほうが月齢の目安として通じるため、
              // こちらを主表示にして、通算の日数は補足に回す。
              <>
                <Text style={styles.heroUnitSmall}>生後</Text>
                <Text style={styles.heroNumberSmall}>{ageInMonths.months}</Text>
                <Text style={styles.heroUnit}>ヶ月</Text>
                <Text style={styles.heroNumberSmall}>{ageInMonths.days}</Text>
                <Text style={styles.heroUnit}>日</Text>
              </>
            ) : (
              <>
                <Text style={styles.heroUnitSmall}>生後</Text>
                <Text style={styles.heroNumber}>{ageInDays}</Text>
                <Text style={styles.heroUnit}>日目</Text>
              </>
            )}
          </View>
          {ageInDays >= 0 && ageInMonths.months > 0 && (
            <Text style={styles.heroSub}>( 生後 {ageInDays}日目 )</Text>
          )}

          <Text style={styles.heroBirth}>
            お誕生日:{' '}
            {birthDate
              ? `${birthDate.getFullYear()}年${birthDate.getMonth() + 1}月${birthDate.getDate()}日`
              : '未設定'}
          </Text>
        </LinearGradient>

        {/* 「次の授乳っていつだっけ」が夫婦のどちらにも起きるので、
            ホームを開いた時点で目に入る位置に置く。タップで記録タブへ移る。 */}
        <NextFeedingCard info={nextFeeding} onOpen={() => router.push('/log')} />

        <View style={styles.quickRow}>
          {quickActions.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => {
                if (item.phone) void Linking.openURL(`tel:${item.phone}`);
                else
                  Alert.alert(
                    `${item.label}の電話番号が未設定です`,
                    '設定タブから登録してください。',
                  );
              }}
              style={styles.quickAction}
            >
              <View style={[styles.quickIcon, !item.phone && styles.quickIconDisabled]}>
                <item.icon size={20} color={colors.navActive} />
              </View>
              <Text style={[styles.quickLabel, !item.phone && styles.quickLabelDisabled]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>直近のスケジュール</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/schedule')}
            style={styles.seeAll}
          >
            <Text style={styles.seeAllText}>すべて見る</Text>
            <ChevronRight size={16} color={colors.navActive} />
          </Pressable>
        </View>

        {overdueCount > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/schedule')}
            style={styles.overdue}
          >
            <View style={styles.overdueLabel}>
              <AlertTriangle size={14} color={colors.alertText} />
              <Text style={styles.overdueText}>期限切れ {overdueCount}件</Text>
            </View>
            <ChevronRight size={16} color={colors.alertText} />
          </Pressable>
        )}

        <View style={styles.taskList}>
          {isLoadingTodos && <Text style={styles.taskEmpty}>読み込み中...</Text>}
          {!isLoadingTodos && upcomingTasks.length === 0 && (
            <Text style={styles.taskEmpty}>直近の予定はありません</Text>
          )}
          {upcomingTasks.map((task, index) => {
            const label = getLabelColors(task.label);
            return (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                onPress={() => openTaskDetail(task)}
                style={[styles.taskRow, index > 0 && styles.taskRowDivided]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={task.done ? '完了を取り消す' : '完了にする'}
                  onPress={() => void toggleTodo(task.id, task.done)}
                  hitSlop={8}
                >
                  {task.done ? (
                    <CheckCircle2 size={24} color={colors.navActive} />
                  ) : (
                    <Circle size={24} color={colors.textFaint} />
                  )}
                </Pressable>

                <View style={styles.flex}>
                  <View style={styles.taskTitleRow}>
                    <Text style={[styles.taskTitle, task.done && styles.taskTitleDone]}>
                      {task.title}
                      {task.remindMinutesBefore !== null && !task.done ? ' ' : ''}
                    </Text>
                    {task.remindMinutesBefore !== null && !task.done && (
                      <BellRing size={12} color={colors.milkProgress} />
                    )}
                    <View
                      style={[
                        styles.taskLabel,
                        { backgroundColor: label.background, borderColor: label.border },
                      ]}
                    >
                      <Text style={[styles.taskLabelText, { color: label.text }]}>{task.label}</Text>
                    </View>
                  </View>

                  <View style={styles.taskMeta}>
                    <View style={styles.taskMetaItem}>
                      <Calendar size={12} color={colors.navActive} />
                      <Text style={styles.taskDate}>{task.targetDate}</Text>
                      {/* 何日後かは予定タブの一覧と同じ表記に揃える。 */}
                      {task.targetDateObj && (
                        <Text style={styles.taskRelative}>
                          {formatRelativeDay(task.targetDateObj, today)}
                        </Text>
                      )}
                    </View>
                    <View style={styles.taskMetaItem}>
                      <Clock size={12} color={colors.textMuted} />
                      <Text style={styles.taskMetaText}>
                        {formatTimeRange(task.startTime, task.endTime)}
                      </Text>
                    </View>
                    {task.place !== '' && (
                      <View style={styles.taskMetaItem}>
                        <MapPin size={12} color={colors.textMuted} />
                        <Text style={styles.taskMetaText} numberOfLines={1}>
                          {task.place}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        {!familyId && !isLoadingTodos && (
          <Text style={styles.notice}>
            まだ家族に属していません。PWA版で家族の登録を済ませてから開いてください。
          </Text>
        )}
      </ScrollView>

      <TaskDetailModal
        selectedTask={selectedTask}
        isEditingTask={isEditingTask}
        tempEditingTask={tempEditingTask}
        // 誕生日が未登録のときだけ「生後日数で指定」を選べるようにする。
        allowBirthRelative={birthDateValue === ''}
        onStartEdit={() => setIsEditingTask(true)}
        onChangeTempEditingTask={setTempEditingTask}
        onSaveEdit={saveTaskEdit}
        onClose={() => setSelectedTask(null)}
        onToggleDone={() => selectedTask && void toggleTodo(selectedTask.id, selectedTask.done)}
        onDelete={() => selectedTask && void handleDeleteTask(selectedTask.id)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },

  hero: { borderRadius: 16, padding: 24, overflow: 'hidden' },
  heroBaby: { position: 'absolute', right: -8, bottom: -8 },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroLabelText: { fontSize: 13, fontWeight: '500', color: colors.primaryText, opacity: 0.9 },
  heroAge: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 8 },
  heroNumber: { fontSize: 56, fontWeight: '700', color: colors.primaryText },
  heroNumberSmall: { fontSize: 44, fontWeight: '700', color: colors.primaryText },
  heroUnit: { fontSize: 18, fontWeight: '500', color: colors.primaryText },
  heroUnitSmall: { fontSize: 13, fontWeight: '500', color: colors.primaryText },
  heroSub: { fontSize: 13, fontWeight: '500', color: colors.primaryText, opacity: 0.9, marginTop: 2 },
  heroBirth: {
    alignSelf: 'flex-start',
    marginTop: 14,
    fontSize: 11,
    color: colors.primaryText,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },

  quickRow: { flexDirection: 'row', gap: 10 },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  quickIcon: {
    backgroundColor: colors.diaperSurface,
    borderRadius: 999,
    padding: 10,
    marginBottom: 6,
  },
  quickIconDisabled: { opacity: 0.6 },
  quickLabel: { fontSize: 11, fontWeight: '500', color: colors.textSubtle },
  quickLabelDisabled: { color: colors.textFaint },

  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  seeAll: { flexDirection: 'row', alignItems: 'center' },
  seeAllText: { fontSize: 13, fontWeight: '500', color: colors.navActive },

  overdue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.alertSurface,
    borderWidth: 1,
    borderColor: colors.alertSurface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  overdueLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  overdueText: { fontSize: 13, fontWeight: '500', color: colors.alertText },

  taskList: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: 'hidden',
  },
  taskEmpty: { fontSize: 13, color: colors.textFaint, textAlign: 'center', padding: 16 },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 },
  taskRowDivided: { borderTopWidth: 1, borderTopColor: colors.background },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  taskTitle: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text },
  taskTitleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  taskLabel: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  taskLabelText: { fontSize: 10, fontWeight: '700' },
  taskMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 4 },
  taskMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  taskDate: { fontSize: 12, fontWeight: '500', color: colors.navActive },
  taskRelative: { fontSize: 12, color: colors.textMuted },
  taskMetaText: { fontSize: 12, color: colors.textMuted, flexShrink: 1 },

  notice: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
});
