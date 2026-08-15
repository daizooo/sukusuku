'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  SleepLog,
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
  findActiveSleepCareLog,
  insertCareLog,
  listCareLogsByDate,
  listCareLogsInRange,
  updateCareLog as updateCareLogApi,
} from '@/lib/api/careLogs';
import { getNextBreastSide, isActiveSleepLog } from '@/lib/careLogUtils';
import {
  clearPendingWake,
  clearSleepNotification,
  requestSleepNotificationPermission,
  showSleepNotification,
  subscribeToWake,
  takePendingWake,
} from '@/lib/sleepNotification';
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
  updateNursery as updateNurseryApi,
} from '@/lib/api/nurseries';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import { getProfile, saveProfile } from '@/lib/api/profile';

import HomeTab from './tabs/HomeTab';
import ScheduleTab from './tabs/ScheduleTab';
import LogTab from './tabs/LogTab';
import MemoTab from './tabs/MemoTab';
import InfoTab from './tabs/InfoTab';
import AddTaskModal from './modals/AddTaskModal';
import type { TaskDraft } from './modals/TaskForm';
import TaskDetailModal from './modals/TaskDetailModal';
import type { MilkLogInput } from './modals/MilkLogModal';
import type { DiaperLogInput } from './modals/DiaperLogModal';
import type { ManualSleepInput } from './modals/SleepLogModal';
import type { GiftDraft } from './modals/GiftFormModal';
import type { GrowthRecordDraft } from './modals/GrowthRecordFormModal';
import type { NurseryDraft } from './modals/NurseryFormModal';

const NAV_ITEMS: { id: TabId; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'ホーム' },
  { id: 'schedule', icon: CalendarDays, label: '予定' },
  { id: 'log', icon: FileText, label: '記録' },
  { id: 'memo', icon: StickyNote, label: 'メモ' },
  { id: 'info', icon: Folder, label: '設定' },
];

const emptyTaskDraft = (date: Date): TaskDraft => ({
  title: '',
  category: '手続き',
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
  belongings: '',
});

const parseNullableNumber = (value: string): number | null => (value === '' ? null : Number(value));

interface SukusukuAppProps {
  familyId: string;
  userId: string;
  role: LoginRole;
}

export default function SukusukuApp({ familyId, userId, role }: SukusukuAppProps) {
  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [todos, setTodos] = useState<Task[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [taskError, setTaskError] = useState('');

  const [logs, setLogs] = useState<CareLog[]>([]);
  // 記録タブで表示中の日（1日区切りで過去に遡れる）
  const [logDate, setLogDate] = useState(() => startOfDay(new Date()));
  // 取得済みの日。表示中の日と一致していなければ読み込み中とみなす
  const [loadedLogDate, setLoadedLogDate] = useState<Date | null>(null);
  const isLoadingLogs = loadedLogDate?.getTime() !== logDate.getTime();
  // 計測中の睡眠。どの日を表示していても出したいので、日別の一覧とは別に持つ。
  const [activeSleep, setActiveSleep] = useState<SleepLog | null>(null);
  // 通知からの起床は購読を張り替えずに最新の処理を呼びたいので、ref 経由で参照する
  const endSleepRef = useRef<(endedAt: Date) => void>(() => {});

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

  // 「今日」は日付が変わらない限り同じ参照を使う（useMemo の依存に安全に渡せるようにするため）
  const today = useMemo(() => startOfDay(new Date()), []);

  const [newTask, setNewTask] = useState<TaskDraft>(() => emptyTaskDraft(today));

  // --- スケジュール（カレンダー） ---
  // 既定は月表示。日をタップすると日表示へ移り、そこで予定と育児記録を合わせて見る。
  const [scheduleView, setScheduleView] = useState<ScheduleView>('month');
  const [currentCalendarDate, setCurrentCalendarDate] = useState(today);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(today);
  // 週表示・日表示に出す育児記録。記録タブの1日分(logs)とは表示範囲が違うため別に持つ。
  const [scheduleLogs, setScheduleLogs] = useState<CareLog[]>([]);
  const [loadedScheduleLogFrom, setLoadedScheduleLogFrom] = useState<number | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [tempProfile, setTempProfile] = useState<UserProfile>(userProfile);

  // 家族のタスクをSupabaseから取得
  useEffect(() => {
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
  const isScheduleLogsLoaded = loadedScheduleLogFrom === scheduleLogFrom;
  const visibleScheduleLogs = needsScheduleLogs && isScheduleLogsLoaded ? scheduleLogs : [];
  const isLoadingScheduleLogs = needsScheduleLogs && !isScheduleLogsLoaded;

  useEffect(() => {
    if (!needsScheduleLogs || scheduleLogFrom === null || scheduleLogTo === null) return;
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
        if (!cancelled) setLoadedScheduleLogFrom(scheduleLogFrom);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId, needsScheduleLogs, scheduleLogFrom, scheduleLogTo]);

  // 計測中の睡眠を読み込む。アプリを閉じている間に通知の「起きた」が押されていたら、その時刻で確定させる。
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const [active, pendingWake] = await Promise.all([
          findActiveSleepCareLog(supabase, familyId),
          takePendingWake(),
        ]);
        if (cancelled) return;

        const sleep = active && active.type === 'sleep' ? active : null;
        if (!sleep) {
          // 記録が残っていないのに通知だけ残っている場合は片付ける。
          if (pendingWake) void clearSleepNotification();
          return;
        }

        // 計測開始より前の古い控えは捨てる。
        if (pendingWake && pendingWake.getTime() >= sleep.startedAt.getTime()) {
          const updated: SleepLog = { ...sleep, endedAt: pendingWake };
          setLogs((prev) => prev.map((log) => (log.id === updated.id ? updated : log)));
          void clearSleepNotification();
          await updateCareLogApi(supabase, updated);
          return;
        }

        setActiveSleep(sleep);
      } catch (err) {
        console.error('Failed to restore active sleep log:', err);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // アプリを開いたまま通知の「起きた」が押された場合。
  useEffect(() => subscribeToWake((endedAt) => void endSleepRef.current(endedAt)), []);

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

  // --- 育児記録 ---

  // 記録の追加・更新を画面の状態へ反映する。表示中の日以外の記録は一覧から外す。
  const upsertLogInState = useCallback(
    (log: CareLog) => {
      setLogs((prev) => {
        const others = prev.filter((l) => l.id !== log.id);
        if (!isSameDay(log.time, logDate)) return others;
        return [log, ...others].sort((a, b) => b.time.getTime() - a.time.getTime());
      });
      // 計測中の睡眠は日をまたいで表示するため、一覧とは別に持つ。
      setActiveSleep((prev) => (isActiveSleepLog(log) ? log : prev?.id === log.id ? null : prev));
      // カレンダー側は別途取得しているため、取得済みの印を落として次に開いたときに取り直させる。
      setLoadedScheduleLogFrom(null);
    },
    [logDate],
  );

  const saveLog = async (log: CareLog | null, input: NewCareLogInput) => {
    if (log) {
      // 種類を切り替えた場合に古い項目が残らないよう、入力内容で作り直す。
      const updated = { ...input, id: log.id, createdBy: log.createdBy } as CareLog;
      upsertLogInState(updated);
      try {
        await updateCareLogApi(supabase, updated);
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

  const saveSleepLog = ({ startedAt, endedAt, note }: ManualSleepInput, existing: SleepLog | null) =>
    saveLog(existing, { type: 'sleep', time: startedAt, startedAt, endedAt, note });

  const deleteLog = async (id: string) => {
    const previous = logs;
    setLogs((prev) => prev.filter((l) => l.id !== id));
    setActiveSleep((prev) => (prev?.id === id ? null : prev));
    setLoadedScheduleLogFrom(null);
    try {
      await deleteCareLog(supabase, id);
    } catch (err) {
      console.error('Failed to delete care log:', err);
      setLogs(previous);
      alert('記録の削除に失敗しました。もう一度お試しください。');
    }
  };

  /** ねんね計測の開始。通知欄にも出して、アプリを開かずに終了できるようにする。 */
  const startSleep = async () => {
    const startedAt = new Date();
    try {
      const created = await insertCareLog(supabase, familyId, userId, {
        type: 'sleep',
        time: startedAt,
        startedAt,
        endedAt: null,
        note: '',
      });
      upsertLogInState(created);
    } catch (err) {
      console.error('Failed to start sleep log:', err);
      alert('記録の追加に失敗しました。もう一度お試しください。');
      return;
    }

    // 通知が使えない・許可されない場合も計測はそのまま続けられる。
    if (await requestSleepNotificationPermission()) {
      await showSleepNotification(startedAt);
    }
  };

  /** 起床。アプリ内のバー・入力画面・通知のいずれからでもここに来る。 */
  const endSleep = useCallback(
    async (endedAt: Date) => {
      if (!activeSleep) return;
      const target = activeSleep;

      const updated: SleepLog = { ...target, endedAt };
      upsertLogInState(updated);
      void clearSleepNotification();
      // 通知側に控えが残っていると、次の計測を古い時刻で終わらせてしまうため消しておく。
      void clearPendingWake();

      try {
        await updateCareLogApi(supabase, updated);
      } catch (err) {
        console.error('Failed to end sleep log:', err);
        alert('記録の更新に失敗しました。もう一度お試しください。');
      }
    },
    [activeSleep, supabase, upsertLogInState],
  );

  useEffect(() => {
    endSleepRef.current = (endedAt: Date) => void endSleep(endedAt);
  }, [endSleep]);


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
    <div className="w-full h-dvh relative bg-gray-50 flex font-sans overflow-hidden">
      <nav className="hidden md:flex md:flex-col md:w-56 lg:w-64 flex-none bg-white border-r border-gray-200 px-3 py-6">
        <h1 className="font-bold text-gray-800 tracking-wide text-lg px-3 mb-8">すくすく手帳</h1>
        <div className="flex flex-col space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
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
              activeSleep={activeSleep}
              nextBreastSide={nextBreastSide}
              onSaveMilkLog={saveMilkLog}
              onSaveDiaperLog={saveDiaperLog}
              onSaveSleepLog={saveSleepLog}
              onDeleteLog={deleteLog}
              onStartSleep={startSleep}
              onEndSleep={() => void endSleep(new Date())}
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
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition ${
                  activeTab === item.id ? 'text-blue-500' : 'text-gray-400 hover:text-gray-500'
                }`}
              >
                <item.icon size={22} className={activeTab === item.id ? 'stroke-[2.5px]' : 'stroke-2'} />
                <span className="text-[9px] font-medium">{item.label}</span>
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
