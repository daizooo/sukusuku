'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import {
  Home,
  CalendarDays,
  FileText,
  StickyNote,
  Folder,
  Plus,
} from 'lucide-react';

import type {
  BreastSide,
  CareLog,
  DiaperLog,
  MilkLog,
  PumpedBatch,
  PumpingLog,
  DocumentItem,
  DynamicTask,
  FamilyMember,
  Gift,
  GrowthRecord,
  LoginRole,
  Nursery,
  ScheduleView,
  Task,
  TabId,
  UserProfile,
} from '@/types/app';
import { INITIAL_PROFILE } from '@/lib/seedData';
import { getProfileFieldValue } from '@/lib/uiUtils';
import {
  addDays,
  calculateTargetDate,
  formatDateString,
  isSameDay,
  parseDateString,
  startOfDay,
  startOfWeek,
  toDateString,
} from '@/lib/dateUtils';
import { createClient } from '@/lib/supabase/client';
import {
  deleteTask as deleteTaskApi,
  insertTask,
  listTasks,
  updateTask as updateTaskApi,
  updateTaskDone,
} from '@/lib/api/tasks';
import type { NewCareLogInput } from '@/lib/api/careLogs';
import {
  deleteCareLog,
  insertCareLog,
  listPumpedBatches,
  listCareLogsByDate,
  listCareLogsInRange,
  listRecentMilkLogs,
  updateCareLog as updateCareLogApi,
} from '@/lib/api/careLogs';
import { getNextBreastSide, getLogTitle } from '@/lib/careLogUtils';
import { averageFeedingIntervalMinutes, type NextFeedingInfo } from '@/lib/feedingSchedule';
import {
  DEFAULT_FEEDING_SETTINGS,
  getFeedingSettings,
  type FeedingSettings,
} from '@/lib/api/feedingSettings';
import { useNursingAlarmWatcher } from '@/lib/nursingTimer';
import { useNursingAlarmSync } from '@/lib/nursingAlarmSync';
import { deleteGift, insertGift, listGifts, updateGift as updateGiftApi } from '@/lib/api/gifts';
import { ensureChildId } from '@/lib/api/children';
import {
  deleteGrowthRecord,
  insertGrowthRecord,
  listGrowthRecords,
  updateGrowthRecord as updateGrowthRecordApi,
} from '@/lib/api/growthRecords';
import {
  deleteDocument,
  getDocumentSignedUrl,
  listDocuments,
  uploadDocument,
} from '@/lib/api/documents';
import {
  deleteNursery,
  insertNursery,
  listNurseries,
  seedDefaultNurseries,
  updateNursery as updateNurseryApi,
} from '@/lib/api/nurseries';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import { getProfile, saveProfile } from '@/lib/api/profile';

import HomeTab from './tabs/HomeTab';
import AddTaskModal from './modals/AddTaskModal';
import type { TaskDraft } from './modals/TaskForm';
import TaskDetailModal from './modals/TaskDetailModal';
import type { MilkLogInput } from './modals/MilkLogModal';
import type { DiaperLogInput } from './modals/DiaperLogModal';
import type { PumpingLogInput } from './modals/PumpingLogModal';
import type { GiftDraft } from './modals/GiftFormModal';
import type { GrowthRecordDraft } from './modals/GrowthRecordFormModal';
import type { NurseryDraft } from './modals/NurseryFormModal';

// 起動直後に表示するのはホームタブだけなので、残りのタブは実際に開かれるまで読み込まない。
// 特にLogTabは成長グラフのためにrecharts(単体で約350KB)を持ち込むため、静的importのままだと
// グラフを一度も開かないユーザーにも初期バンドルとしてダウンロード・パースさせてしまう。
// モーダルはタップ直後に開く必要があり、かつ小さいので静的importのまま残す。
const TabFallback = () => (
  <div className="h-full w-full flex items-center justify-center">
    <div className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
  </div>
);

const ScheduleTab = dynamic(() => import('./tabs/ScheduleTab'), { loading: TabFallback });
const LogTab = dynamic(() => import('./tabs/LogTab'), { loading: TabFallback });
const MemoTab = dynamic(() => import('./tabs/MemoTab'), { loading: TabFallback });
const InfoTab = dynamic(() => import('./tabs/InfoTab'), { loading: TabFallback });

const NAV_ITEMS: { id: TabId; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'ホーム' },
  { id: 'schedule', icon: CalendarDays, label: '予定' },
  { id: 'log', icon: FileText, label: '記録' },
  { id: 'memo', icon: StickyNote, label: 'メモ' },
  { id: 'info', icon: Folder, label: '設定' },
];

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

const parseNullableNumber = (value: string): number | null => (value === '' ? null : Number(value));

// 「今日」('YYYY-MM-DD')の取得は useSyncExternalStore 経由にする。
// 時間の経過でしか変わらず、変化を知らせてくれるイベントは存在しないため購読は何もしない。
// これにより、SSR/初回hydrationはサーバーが確定させた値（getServerSnapshot）で揃い、
// hydration後はクライアントのローカル日時（getSnapshot）に切り替わる。
// new Date() を直接 useState/useMemo の初期値にすると、SSR時点とhydration時点で
// 「今日」の評価タイミング・タイムゾーンがずれ得て、描画結果が食い違いhydration
// mismatchになるため、この仕組みで回避する。
const noopSubscribe = () => () => {};
const getClientTodayDateString = (): string => toDateString(new Date());

interface SukusukuAppProps {
  familyId: string;
  userId: string;
  role: LoginRole;
  // サーバー側(page.tsx)で取得済みのタスク。あればhydration後の再取得を省略する。
  // 取得に失敗していた場合はnullで、その場合は従来通りクライアント側で取得する。
  initialTasks: Task[] | null;
  // サーバー側(page.tsx)で確定させた「今日」('YYYY-MM-DD')。todayステートの初期値に使う。
  todayDateString: string;
}

export default function SukusukuApp({ familyId, userId, role, initialTasks, todayDateString }: SukusukuAppProps) {
  // 授乳の経過時間のお知らせ（音・バイブ）。記録タブを開いていなくても鳴らせるよう、
  // アプリ全体で1つだけ見張りを動かす。
  useNursingAlarmWatcher();
  // 画面が消えている・アプリを閉じている間は上の見張りが間引かれて鳴らせないため、
  // 鳴らす時刻をサーバーにも預けておき、その分を通知で鳴らしてもらう。
  useNursingAlarmSync(userId);

  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [todos, setTodos] = useState<Task[]>(initialTasks ?? []);
  const [isLoadingTasks, setIsLoadingTasks] = useState(initialTasks === null);
  const [taskError, setTaskError] = useState('');

  const [logs, setLogs] = useState<CareLog[]>([]);
  // 記録タブで表示中の日（1日区切りで過去に遡れる）
  const [logDate, setLogDate] = useState(() => startOfDay(new Date()));
  // 取得済みの日。表示中の日と一致していなければ読み込み中とみなす
  const [loadedLogDate, setLoadedLogDate] = useState<Date | null>(null);
  const isLoadingLogs = loadedLogDate?.getTime() !== logDate.getTime();
  // 搾乳ストック。飲ませるときにどの搾乳を使うか選べるよう、残量ではなく1パックずつ持つ。
  // 表示中の日だけでは求まらないため、全期間ぶんをまとめて持つ。
  const [pumpedBatches, setPumpedBatches] = useState<PumpedBatch[]>([]);
  // 「次の授乳の目安」に使う直近の授乳。夜中の授乳は前の日の記録になるため、
  // 記録タブの1日分(logs)とは別に、日付にとらわれず新しい順で持つ。
  const [recentMilkLogs, setRecentMilkLogs] = useState<MilkLog[]>([]);
  const [isLoadingRecentMilk, setIsLoadingRecentMilk] = useState(true);
  // 授乳の間隔の設定。家族で共通なので、どちらが変えても同じ目安が出る。
  const [feedingSettings, setFeedingSettings] = useState<FeedingSettings>(DEFAULT_FEEDING_SETTINGS);

  const [gifts, setGifts] = useState<Gift[]>([]);
  const [isLoadingGifts, setIsLoadingGifts] = useState(true);

  const [growthData, setGrowthData] = useState<GrowthRecord[]>([]);
  const [isLoadingGrowth, setIsLoadingGrowth] = useState(true);
  const [childId, setChildId] = useState<string | null>(null);

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);

  const [nurseries, setNurseries] = useState<Nursery[]>([]);
  const [isLoadingNurseries, setIsLoadingNurseries] = useState(true);

  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);

  // --- UI状態 ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<DynamicTask | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [tempEditingTask, setTempEditingTask] = useState<DynamicTask | null>(null);

  // 「今日」は日付が変わらない限り同じ参照を使う（useMemo の依存に安全に渡せるようにするため）。
  // SSR/初回hydrationはサーバーが確定させた todayDateString、hydration後はクライアントの
  // ローカル日時に切り替わる（詳細は noopSubscribe 付近のコメントを参照）。
  const todayDateStringSynced = useSyncExternalStore(noopSubscribe, getClientTodayDateString, () => todayDateString);
  const today = useMemo(
    () => parseDateString(todayDateStringSynced) ?? startOfDay(new Date()),
    [todayDateStringSynced],
  );

  const [newTask, setNewTask] = useState<TaskDraft>(() => emptyTaskDraft(today));

  // --- スケジュール（カレンダー） ---
  // 既定は月表示。日をタップすると日表示へ移り、そこで予定と育児記録を合わせて見る。
  const [scheduleView, setScheduleView] = useState<ScheduleView>('month');
  const [currentCalendarDate, setCurrentCalendarDate] = useState(today);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(today);
  // 週表示・日表示に出す育児記録。記録タブの1日分(logs)とは表示範囲が違うため別に持つ。
  const [scheduleLogs, setScheduleLogs] = useState<CareLog[]>([]);
  const [loadedScheduleLogRange, setLoadedScheduleLogRange] = useState<string | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [tempProfile, setTempProfile] = useState<UserProfile>(userProfile);

  // 家族のタスクをSupabaseから取得
  // サーバー側(page.tsx)で取得済み(initialTasks)なら、hydration後の再取得はスキップする。
  useEffect(() => {
    if (initialTasks !== null) return;
    let cancelled = false;
    listTasks(supabase, familyId)
      .then((data) => {
        if (cancelled) return;
        setTodos(data);
        setTaskError('');
      })
      .catch((err) => {
        console.error('Failed to load tasks:', err);
        if (!cancelled) setTaskError('予定の読み込みに失敗しました。時間を置いて再度お試しください。');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTasks(false);
      });
    return () => {
      cancelled = true;
    };
    // initialTasksはマウント時点の値のみ見る（マウント後に変わることはない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, familyId]);

  // 育児記録をSupabaseから取得（表示中の1日分のみ。日を切り替えるたびに取り直す）
  useEffect(() => {
    let cancelled = false;
    listCareLogsByDate(supabase, familyId, logDate)
      .then((data) => {
        if (!cancelled) setLogs(data);
      })
      .catch((err) => {
        console.error('Failed to load care logs:', err);
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        // 成功・失敗どちらでも「この日は取得済み」にして読み込み表示を終わらせる
        if (!cancelled) setLoadedLogDate(logDate);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId, logDate]);

  // カレンダーの週表示・日表示に出す育児記録。表示中の範囲だけを取りに行く。
  // 月表示は記録を出さないため、月をめくっても問い合わせは起きない。
  const scheduleLogRange = useMemo(() => {
    if (activeTab !== 'schedule') return null;
    if (scheduleView === 'day') {
      const from = startOfDay(selectedScheduleDate);
      return { from, to: addDays(from, 1) };
    }
    if (scheduleView === 'week') {
      const from = startOfWeek(selectedScheduleDate);
      return { from, to: addDays(from, 7) };
    }
    return null;
  }, [activeTab, scheduleView, selectedScheduleDate]);

  // 範囲が変わったときだけ取り直す（週表示で同じ週の中の日を選び直しても再取得しない）。
  // これから来る日には記録が存在しないため、未来だけの範囲は問い合わせない。
  const scheduleLogFrom = scheduleLogRange?.from.getTime() ?? null;
  const scheduleLogTo = scheduleLogRange?.to.getTime() ?? null;
  const needsScheduleLogs = scheduleLogFrom !== null && scheduleLogTo !== null && scheduleLogFrom <= today.getTime();
  // 取得済みの範囲。表示中の範囲と一致していなければ読み込み中とみなす（記録タブと同じ考え方）。
  // 週の初日を日表示で開くと頭の時刻が週表示と同じになるため、終わりも含めて見分ける。
  const scheduleLogRangeKey =
    scheduleLogFrom === null || scheduleLogTo === null ? null : `${scheduleLogFrom}-${scheduleLogTo}`;
  const isScheduleLogsLoaded = loadedScheduleLogRange === scheduleLogRangeKey;
  const visibleScheduleLogs = needsScheduleLogs && isScheduleLogsLoaded ? scheduleLogs : [];
  const isLoadingScheduleLogs = needsScheduleLogs && !isScheduleLogsLoaded;

  useEffect(() => {
    if (!needsScheduleLogs || scheduleLogFrom === null || scheduleLogTo === null || scheduleLogRangeKey === null)
      return;
    let cancelled = false;
    listCareLogsInRange(supabase, familyId, new Date(scheduleLogFrom), new Date(scheduleLogTo))
      .then((data) => {
        if (!cancelled) setScheduleLogs(data);
      })
      .catch((err) => {
        console.error('Failed to load care logs for calendar:', err);
        if (!cancelled) setScheduleLogs([]);
      })
      .finally(() => {
        // 成功・失敗どちらでも「この範囲は取得済み」にして読み込み表示を終わらせる
        if (!cancelled) setLoadedScheduleLogRange(scheduleLogRangeKey);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId, needsScheduleLogs, scheduleLogFrom, scheduleLogTo, scheduleLogRangeKey]);

  // 搾乳ストックを読み込む。記録を触るたびに取り直す。
  const refreshPumpedStock = useCallback(() => {
    listPumpedBatches(supabase, familyId)
      .then(setPumpedBatches)
      .catch((err: unknown) => console.error('Failed to load pumped milk stock:', err));
  }, [supabase, familyId]);

  useEffect(() => {
    refreshPumpedStock();
  }, [refreshPumpedStock]);

  // 直近の授乳を読み込む。記録を触るたびに取り直す。
  const refreshRecentMilkLogs = useCallback(() => {
    listRecentMilkLogs(supabase, familyId)
      .then(setRecentMilkLogs)
      .catch((err: unknown) => console.error('Failed to load recent milk logs:', err))
      .finally(() => setIsLoadingRecentMilk(false));
  }, [supabase, familyId]);

  useEffect(() => {
    refreshRecentMilkLogs();
  }, [refreshRecentMilkLogs]);

  // パートナーの端末で記録された授乳は、この端末では分からないまま古い目安が出続ける。
  // アプリに戻ってきたときに取り直して、夫婦のどちらが見ても同じ目安になるようにする。
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshRecentMilkLogs();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshRecentMilkLogs]);

  // 授乳の間隔の設定を読み込む。未設定の家族は既定値(3時間・通知する)のまま。
  useEffect(() => {
    let cancelled = false;
    getFeedingSettings(supabase, familyId)
      .then((settings) => {
        if (!cancelled) setFeedingSettings(settings);
      })
      .catch((err: unknown) => console.error('Failed to load feeding settings:', err));
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // お祝いをSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    listGifts(supabase, familyId)
      .then((data) => {
        if (!cancelled) setGifts(data);
      })
      .catch((err) => console.error('Failed to load gifts:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingGifts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 成長記録をSupabaseから取得(childレコードを確保してから取得する)
  useEffect(() => {
    let cancelled = false;
    ensureChildId(supabase, familyId)
      .then((id) => {
        if (cancelled) return;
        setChildId(id);
        return listGrowthRecords(supabase, id);
      })
      .then((data) => {
        if (!cancelled && data) setGrowthData(data);
      })
      .catch((err) => console.error('Failed to load growth records:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingGrowth(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 書類箱をSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    listDocuments(supabase, familyId)
      .then((data) => {
        if (!cancelled) setDocuments(data);
      })
      .catch((err) => console.error('Failed to load documents:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingDocuments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 保活メモをSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    listNurseries(supabase, familyId)
      .then((data) => {
        if (!cancelled) setNurseries(data);
      })
      .catch((err) => console.error('Failed to load nurseries:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingNurseries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 家族メンバー(パパ/ママ)の表示名解決用
  useEffect(() => {
    let cancelled = false;
    listFamilyMembers(supabase, familyId)
      .then((data) => {
        if (!cancelled) setFamilyMembers(data);
      })
      .catch((err) => console.error('Failed to load family members:', err));
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 設定タブ(お子様情報・パパママ情報)をSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    getProfile(supabase, familyId)
      .then((profile) => {
        if (cancelled || !profile) return;
        setUserProfile(profile);
      })
      .catch((err) => {
        console.error('Failed to load profile:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 次にどちらの乳首から授乳するか。表示中の日に読み込んだ記録から判断する。
  const nextBreastSide = useMemo<BreastSide | null>(() => getNextBreastSide(logs), [logs]);

  // 「次の授乳の目安」に出す一式。ホームと記録タブで同じものを見せる。
  const nextFeeding = useMemo<NextFeedingInfo>(() => {
    const lastFed = recentMilkLogs[0] ?? null;
    return {
      lastFedAt: lastFed?.time ?? null,
      lastFedTitle: lastFed ? getLogTitle(lastFed) : '',
      intervalMinutes: feedingSettings.intervalMinutes,
      averageIntervalMinutes: averageFeedingIntervalMinutes(recentMilkLogs.map((log) => log.time)),
      isLoading: isLoadingRecentMilk,
    };
  }, [recentMilkLogs, feedingSettings.intervalMinutes, isLoadingRecentMilk]);

  const memberLabel = (id: string | null): string => {
    if (!id) return '不明';
    const member = familyMembers.find((m) => m.id === id);
    if (member?.name) return member.name;
    if (id === userId) return 'あなた';
    return 'パートナー';
  };

  const birthDateValue = getProfileFieldValue(userProfile, 'birthDate');

  const dynamicTodos = useMemo<DynamicTask[]>(() => {
    return todos.map((todo) => {
      // 日付指定の予定は start_date をそのまま使い、
      // 出生日基準の予定は「子の誕生日 + 生後日数」で解決する。
      const targetDateObj =
        todo.anchorType === 'absolute'
          ? parseDateString(todo.startDate ?? '')
          : calculateTargetDate(birthDateValue, todo.daysAfterBirth);
      return {
        ...todo,
        targetDateObj,
        targetDate: formatDateString(targetDateObj),
      };
    });
  }, [todos, birthDateValue]);

  const ageInDays = useMemo(() => {
    const birth = parseDateString(birthDateValue);
    if (!birth) return 0;
    const diffTime = today.getTime() - birth.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }, [birthDateValue, today]);

  const ageInMonths = useMemo(() => {
    const birth = parseDateString(birthDateValue);
    if (!birth) return { months: 0, days: 0 };
    let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
    let tempDate = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());

    if (today < tempDate) {
      months -= 1;
      tempDate = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());
    }
    const days = Math.floor((today.getTime() - tempDate.getTime()) / (1000 * 60 * 60 * 24));
    return { months, days };
  }, [birthDateValue, today]);

  const toggleTodo = async (id: string) => {
    const target = todos.find((t) => t.id === id);
    if (!target) return;
    const nextDone = !target.done;

    // 楽観的更新
    setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, done: nextDone } : todo)));
    setSelectedTask((prev) => (prev && prev.id === id ? { ...prev, done: nextDone } : prev));

    try {
      await updateTaskDone(supabase, id, nextDone);
    } catch (err) {
      console.error('Failed to update task:', err);
      // 失敗時はロールバック
      setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, done: !nextDone } : todo)));
      setSelectedTask((prev) => (prev && prev.id === id ? { ...prev, done: !nextDone } : prev));
    }
  };

  const openTaskDetail = (task: DynamicTask) => {
    setSelectedTask(task);
    setIsEditingTask(false);
    setTempEditingTask(task);
  };

  const closeTaskDetail = () => setSelectedTask(null);

  const saveTaskEdit = async () => {
    if (!tempEditingTask) return;
    const updated = tempEditingTask;

    setTodos((prev) => prev.map((todo) => (todo.id === updated.id ? { ...todo, ...updated } : todo)));
    setSelectedTask(updated);
    setIsEditingTask(false);

    try {
      await updateTaskApi(supabase, updated);
    } catch (err) {
      console.error('Failed to save task:', err);
      alert('保存に失敗しました。もう一度お試しください。');
    }
  };

  const handleDeleteTask = async (id: string) => {
    const previousTodos = todos;
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
    setSelectedTask(null);

    try {
      await deleteTaskApi(supabase, id);
    } catch (err) {
      console.error('Failed to delete task:', err);
      setTodos(previousTodos);
      alert('削除に失敗しました。もう一度お試しください。');
    }
  };

  const handleProfileSave = async () => {
    const previousProfile = userProfile;
    const updated = tempProfile;

    setUserProfile(updated);
    setIsEditingProfile(false);

    try {
      await saveProfile(supabase, familyId, updated);
    } catch (err) {
      console.error('Failed to save profile:', err);
      // 失敗時はロールバック
      setUserProfile(previousProfile);
      alert('保存に失敗しました。もう一度お試しください。');
    }
  };

  const startEditingProfile = () => {
    setTempProfile(userProfile);
    setIsEditingProfile(true);
  };

  const handleAddTask = async () => {
    if (!newTask.title) return;
    const input = { ...newTask };

    setShowAddModal(false);
    setNewTask(emptyTaskDraft(today));

    try {
      const created = await insertTask(supabase, familyId, input);
      setTodos((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to add task:', err);
      alert('予定の追加に失敗しました。もう一度お試しください。');
    }
  };

  // カレンダーで選んでいる日を初期値にして予定を追加する。
  const openAddTaskModal = (date: Date) => {
    setNewTask(emptyTaskDraft(date));
    setShowAddModal(true);
  };

  // カレンダーの日表示から、その日の記録タブへ移る。
  const openLogTabForDate = (date: Date) => {
    setLogDate(startOfDay(date));
    setActiveTab('log');
  };

  // ナビゲーションからタブを切り替える。
  // 記録タブは開くたびに今日を出す（前に遡って見ていた日を引きずると、
  // 気づかないまま過去の日に記録してしまうため）。
  const selectTab = (tab: TabId) => {
    if (tab === 'log') setLogDate(startOfDay(new Date()));
    setActiveTab(tab);
  };

  // --- 育児記録 ---

  // 記録の追加・更新を画面の状態へ反映する。表示中の日以外の記録は一覧から外す。
  const upsertLogInState = useCallback(
    (log: CareLog) => {
      setLogs((prev) => {
        const others = prev.filter((l) => l.id !== log.id);
        if (!isSameDay(log.time, logDate)) return others;
        return [log, ...others].sort((a, b) => b.time.getTime() - a.time.getTime());
      });
      // カレンダー側は別途取得しているため、取得済みの印を落として次に開いたときに取り直させる。
      setLoadedScheduleLogRange(null);
      // 搾乳ストックは全期間の差し引き。編集で「搾乳」から「ミルク」へ変えるなど
      // ストックに関わるかどうかが入れ替わることもあるため、種類を問わず数え直す。
      refreshPumpedStock();
      // 「次の授乳の目安」も、記録の時刻を変えたり過去の日に足したりすると変わる。
      refreshRecentMilkLogs();
    },
    [logDate, refreshPumpedStock, refreshRecentMilkLogs],
  );

  const saveLog = async (log: CareLog | null, input: NewCareLogInput) => {
    if (log) {
      // 種類を切り替えた場合に古い項目が残らないよう、入力内容で作り直す。
      const updated = { ...input, id: log.id, createdBy: log.createdBy } as CareLog;
      upsertLogInState(updated);
      try {
        await updateCareLogApi(supabase, updated);
        // 「次の授乳の目安」は保存後のDBから取り直す。上の楽観的な反映の時点で
        // 読みに行くと、書き込み前の時刻を拾ってしまうため。
        refreshRecentMilkLogs();
      } catch (err) {
        console.error('Failed to update care log:', err);
        alert('記録の更新に失敗しました。もう一度お試しください。');
      }
      return;
    }

    try {
      const created = await insertCareLog(supabase, familyId, userId, input);
      upsertLogInState(created);
    } catch (err) {
      console.error('Failed to add care log:', err);
      alert('記録の追加に失敗しました。もう一度お試しください。');
    }
  };

  const saveMilkLog = (input: MilkLogInput, existing: MilkLog | null) =>
    saveLog(existing, { type: 'milk', ...input });

  const saveDiaperLog = (input: DiaperLogInput, existing: DiaperLog | null) =>
    saveLog(existing, { type: 'diaper', ...input });

  const savePumpingLog = (input: PumpingLogInput, existing: PumpingLog | null) =>
    saveLog(existing, { type: 'pumping', ...input });

  const deleteLog = async (id: string) => {
    const previous = logs;
    setLogs((prev) => prev.filter((l) => l.id !== id));
    setLoadedScheduleLogRange(null);
    try {
      await deleteCareLog(supabase, id);
      refreshPumpedStock();
      refreshRecentMilkLogs();
    } catch (err) {
      console.error('Failed to delete care log:', err);
      setLogs(previous);
      alert('記録の削除に失敗しました。もう一度お試しください。');
    }
  };

  // --- お祝い ---
  const addGift = async (draft: GiftDraft) => {
    try {
      const created = await insertGift(supabase, familyId, draft);
      setGifts((prev) => [created, ...prev]);
    } catch (err) {
      console.error('Failed to add gift:', err);
      alert('お祝いの追加に失敗しました。もう一度お試しください。');
    }
  };

  const updateGiftHandler = async (gift: Gift, draft: GiftDraft) => {
    const updated: Gift = { ...gift, ...draft };
    setGifts((prev) => prev.map((g) => (g.id === gift.id ? updated : g)));
    try {
      await updateGiftApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update gift:', err);
      alert('お祝いの更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteGiftHandler = async (id: string) => {
    const previous = gifts;
    setGifts((prev) => prev.filter((g) => g.id !== id));
    try {
      await deleteGift(supabase, id);
    } catch (err) {
      console.error('Failed to delete gift:', err);
      setGifts(previous);
      alert('お祝いの削除に失敗しました。もう一度お試しください。');
    }
  };

  // --- 成長記録 ---
  const addGrowthRecordHandler = async (draft: GrowthRecordDraft) => {
    try {
      const id = childId ?? (await ensureChildId(supabase, familyId));
      if (!childId) setChildId(id);
      const created = await insertGrowthRecord(supabase, id, {
        monthAge: parseNullableNumber(draft.monthAge),
        height: parseNullableNumber(draft.height),
        weight: parseNullableNumber(draft.weight),
        recordedDate: draft.recordedDate,
      });
      setGrowthData((prev) => [...prev, created].sort((a, b) => a.recordedDate.localeCompare(b.recordedDate)));
    } catch (err) {
      console.error('Failed to add growth record:', err);
      alert('成長記録の追加に失敗しました。もう一度お試しください。');
    }
  };

  const updateGrowthRecordHandler = async (record: GrowthRecord, draft: GrowthRecordDraft) => {
    const updated: GrowthRecord = {
      ...record,
      month: parseNullableNumber(draft.monthAge),
      height: parseNullableNumber(draft.height),
      weight: parseNullableNumber(draft.weight),
      recordedDate: draft.recordedDate,
    };
    setGrowthData((prev) =>
      prev.map((r) => (r.id === record.id ? updated : r)).sort((a, b) => a.recordedDate.localeCompare(b.recordedDate)),
    );
    try {
      await updateGrowthRecordApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update growth record:', err);
      alert('成長記録の更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteGrowthRecordHandler = async (id: string) => {
    const previous = growthData;
    setGrowthData((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteGrowthRecord(supabase, id);
    } catch (err) {
      console.error('Failed to delete growth record:', err);
      setGrowthData(previous);
      alert('成長記録の削除に失敗しました。もう一度お試しください。');
    }
  };

  // --- 書類箱 ---
  const addDocument = async (file: File, title: string) => {
    try {
      const created = await uploadDocument(supabase, familyId, file, title);
      setDocuments((prev) => [created, ...prev]);
    } catch (err) {
      console.error('Failed to upload document:', err);
      alert('書類の追加に失敗しました。もう一度お試しください。');
    }
  };

  const deleteDocumentHandler = async (doc: DocumentItem) => {
    const previous = documents;
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    try {
      await deleteDocument(supabase, doc);
    } catch (err) {
      console.error('Failed to delete document:', err);
      setDocuments(previous);
      alert('書類の削除に失敗しました。もう一度お試しください。');
    }
  };

  const getDocumentUrl = (filePath: string) => getDocumentSignedUrl(supabase, filePath);

  // --- 保活メモ ---
  const addNurseryHandler = async (draft: NurseryDraft) => {
    try {
      const created = await insertNursery(supabase, familyId, draft);
      setNurseries((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to add nursery:', err);
      alert('保育園の追加に失敗しました。もう一度お試しください。');
    }
  };

  const updateNurseryHandler = async (nursery: Nursery, draft: NurseryDraft) => {
    const updated: Nursery = { ...nursery, ...draft };
    setNurseries((prev) => prev.map((n) => (n.id === nursery.id ? updated : n)));
    try {
      await updateNurseryApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update nursery:', err);
      alert('保育園情報の更新に失敗しました。もう一度お試しください。');
    }
  };

  // 保活メモが空のときに、見学候補の保育園をまとめて登録する
  const addDefaultNurseriesHandler = async () => {
    try {
      const created = await seedDefaultNurseries(supabase, familyId);
      setNurseries((prev) => [...prev, ...created]);
    } catch (err) {
      console.error('Failed to add default nurseries:', err);
      alert('見学候補の追加に失敗しました。もう一度お試しください。');
    }
  };

  const deleteNurseryHandler = async (id: string) => {
    const previous = nurseries;
    setNurseries((prev) => prev.filter((n) => n.id !== id));
    try {
      await deleteNursery(supabase, id);
    } catch (err) {
      console.error('Failed to delete nursery:', err);
      setNurseries(previous);
      alert('保育園情報の削除に失敗しました。もう一度お試しください。');
    }
  };

  // スマホ・タブレット・PCのいずれでもビューポート全体を使う（PCで中央の細長いカードにしない）。
  // ただし単に画面幅いっぱいに引き伸ばすと一覧やグリッドの間延びで読みにくくなるため、
  // md(768px)以上ではボトムタブバーの代わりに左サイドナビを常時表示し、各タブ側でも
  // 本文の幅を読みやすい範囲に収めている（記録タブの2カラム表示など、幅を必要とする
  // 画面はタブ側で個別に対応する）。
  return (
    <div className="w-full h-svh relative bg-gray-50 flex font-sans overflow-hidden">
      <nav className="hidden md:flex md:flex-col md:w-56 lg:w-64 flex-none bg-white border-r border-gray-200 px-3 py-6">
        <h1 className="font-bold text-gray-800 tracking-wide text-lg px-3 mb-8">すくすく手帳</h1>
        <div className="flex flex-col space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => selectTab(item.id)}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                activeTab === item.id ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
            >
              <item.icon size={20} className={activeTab === item.id ? 'stroke-[2.5px]' : 'stroke-2'} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* アプリを開いたあとはタブごとの見出しがあるため、アプリ名の見出しは出さない。
          画面の高さをできるだけ本文に使う（各タブは画面全体をスクロールさせない作り）。 */}
      <div className="flex flex-col flex-1 min-w-0 relative pt-[env(safe-area-inset-top)]">
        {taskError && (
          <p className="flex-none bg-red-50 text-red-600 text-xs text-center py-2 px-4 border-b border-red-100">{taskError}</p>
        )}

        <main className="flex-1 overflow-hidden">
          {activeTab === 'home' && (
            <HomeTab
              userProfile={userProfile}
              loginRole={role}
              ageInDays={ageInDays}
              ageInMonths={ageInMonths}
              dynamicTodos={dynamicTodos}
              isLoadingTodos={isLoadingTasks}
              today={today}
              nextFeeding={nextFeeding}
              onOpenLogTab={() => selectTab('log')}
              onToggleTodo={toggleTodo}
              onOpenTask={openTaskDetail}
              onViewAllSchedule={(view) => {
                setActiveTab('schedule');
                if (view) setScheduleView(view);
              }}
            />
          )}
          {activeTab === 'schedule' && (
            <ScheduleTab
              dynamicTodos={dynamicTodos}
              isLoadingTodos={isLoadingTasks}
              today={today}
              birthDate={birthDateValue}
              view={scheduleView}
              onChangeView={setScheduleView}
              selectedDate={selectedScheduleDate}
              onChangeSelectedDate={setSelectedScheduleDate}
              currentCalendarDate={currentCalendarDate}
              onChangeCalendarDate={setCurrentCalendarDate}
              careLogs={visibleScheduleLogs}
              isLoadingCareLogs={isLoadingScheduleLogs}
              onToggleTodo={toggleTodo}
              onOpenTask={openTaskDetail}
              onAddTask={openAddTaskModal}
              onOpenLogTab={openLogTabForDate}
            />
          )}
          {activeTab === 'log' && (
            <LogTab
              logs={logs}
              logDate={logDate}
              today={today}
              onChangeLogDate={setLogDate}
              growthData={growthData}
              isLoadingLogs={isLoadingLogs}
              isLoadingGrowth={isLoadingGrowth}
              memberLabel={memberLabel}
              nextBreastSide={nextBreastSide}
              nextFeeding={nextFeeding}
              pumpedBatches={pumpedBatches}
              onSaveMilkLog={saveMilkLog}
              onSaveDiaperLog={saveDiaperLog}
              onSavePumpingLog={savePumpingLog}
              onDeleteLog={deleteLog}
              onAddGrowthRecord={addGrowthRecordHandler}
              onUpdateGrowthRecord={updateGrowthRecordHandler}
              onDeleteGrowthRecord={deleteGrowthRecordHandler}
            />
          )}
          {activeTab === 'memo' && (
            <MemoTab
              gifts={gifts}
              isLoadingGifts={isLoadingGifts}
              onAddGift={addGift}
              onUpdateGift={updateGiftHandler}
              onDeleteGift={deleteGiftHandler}
              documents={documents}
              isLoadingDocuments={isLoadingDocuments}
              onAddDocument={addDocument}
              onDeleteDocument={deleteDocumentHandler}
              getDocumentUrl={getDocumentUrl}
              nurseries={nurseries}
              isLoadingNurseries={isLoadingNurseries}
              onAddNursery={addNurseryHandler}
              onUpdateNursery={updateNurseryHandler}
              onDeleteNursery={deleteNurseryHandler}
              onAddDefaultNurseries={addDefaultNurseriesHandler}
            />
          )}
          {activeTab === 'info' && (
            <InfoTab
              familyId={familyId}
              userId={userId}
              userProfile={userProfile}
              tempProfile={tempProfile}
              isEditingProfile={isEditingProfile}
              onStartEditProfile={startEditingProfile}
              onChangeTempProfile={setTempProfile}
              onSaveProfile={handleProfileSave}
              feedingSettings={feedingSettings}
              onChangeFeedingSettings={setFeedingSettings}
            />
          )}
        </main>

        {activeTab === 'schedule' && (
          <button
            onClick={() => openAddTaskModal(selectedScheduleDate)}
            className="absolute bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] right-4 md:bottom-8 md:right-8 w-14 h-14 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-blue-600 hover:scale-105 transition-all active:scale-95 z-20"
          >
            <Plus size={28} />
          </button>
        )}

        <nav className="flex-none bg-white border-t border-gray-200 w-full z-30 pb-[env(safe-area-inset-bottom)] md:hidden">
          <div className="flex justify-around items-center h-16 px-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => selectTab(item.id)}
                className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition ${
                  activeTab === item.id ? 'text-blue-500' : 'text-gray-500 hover:text-gray-600'
                }`}
              >
                <item.icon size={22} className={activeTab === item.id ? 'stroke-[2.5px]' : 'stroke-2'} />
                <span className="text-[11px] font-semibold">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      <AddTaskModal
        show={showAddModal}
        newTask={newTask}
        allowBirthRelative={!birthDateValue}
        onChange={setNewTask}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddTask}
      />
      <TaskDetailModal
        selectedTask={selectedTask}
        isEditingTask={isEditingTask}
        tempEditingTask={tempEditingTask}
        allowBirthRelative={!birthDateValue}
        onStartEdit={() => setIsEditingTask(true)}
        onChangeTempEditingTask={setTempEditingTask}
        onSaveEdit={saveTaskEdit}
        onClose={closeTaskDetail}
        onToggleDone={() => selectedTask && toggleTodo(selectedTask.id)}
        onDelete={() => selectedTask && handleDeleteTask(selectedTask.id)}
      />
    </div>
  );
}
