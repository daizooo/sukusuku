'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { Baby, CalendarDays, ListTodo, Plus, Settings, Wallet } from 'lucide-react';

import type {
  BreastSide,
  CareLog,
  DiaperLog,
  MilkLog,
  PumpedBatch,
  PumpingLog,
  TemperatureLog,
  DynamicTask,
  FamilyMember,
  GrowthRecord,
  ListBoard,
  ListGroup,
  ListItem,
  LogType,
  Member,
  Nursery,
  Participant,
  ScheduleView,
  Task,
  TabId,
} from '@/types/app';
import {
  addDays,
  calculateTargetDate,
  formatDateString,
  isSameDay,
  parseDateString,
  startOfDay,
  toDateString,
} from '@/lib/dateUtils';
import { createClient } from '@/lib/supabase/client';
import { OPEN_LOG_PARAM, TAB_PARAM } from '@/lib/appLinks';
import { onNavPop, syncNav } from '@/lib/browserHistory';
import {
  deleteTask as deleteTaskApi,
  insertTask,
  listTasks,
  updateTask as updateTaskApi,
  updateTaskDone,
  updateTaskDoneDates,
} from '@/lib/api/tasks';
import { toggledDoneDates } from '@/lib/scheduleExpand';
import type { NewCareLogInput } from '@/lib/api/careLogs';
import {
  deleteCareLog,
  insertCareLog,
  listPumpedBatches,
  listCareLogsByDate,
  listCareLogsInRange,
  listRecentMilkLogs,
  listRecentTemperatureLogs,
  setPumpedBatchDiscarded,
  updateCareLog as updateCareLogApi,
} from '@/lib/api/careLogs';
import { getNextBreastSide } from '@/lib/careLogUtils';
import {
  activePendingNursing,
  resolveLastFeeding,
  type NextFeedingInfo,
} from '@/lib/feedingSchedule';
import { listFamilyNursingState, type FamilyNursingState } from '@/lib/api/nursingAlarms';
import {
  DEFAULT_FEEDING_SETTINGS,
  getFeedingSettings,
  type FeedingSettings,
} from '@/lib/api/feedingSettings';
import {
  DEFAULT_TEMPERATURE_REMINDER_SETTINGS,
  getTemperatureReminderSettings,
  type TemperatureReminderSettings,
} from '@/lib/api/temperatureReminderSettings';
import { useHasNursingSession, useNursingAlarmWatcher } from '@/lib/nursingTimer';
import { ensureChildId } from '@/lib/api/children';
import {
  deleteGrowthRecord,
  insertGrowthRecord,
  listGrowthRecords,
  updateGrowthRecord as updateGrowthRecordApi,
} from '@/lib/api/growthRecords';
import {
  deleteNursery,
  insertNursery,
  listNurseries,
  seedDefaultNurseries,
  updateNursery as updateNurseryApi,
} from '@/lib/api/nurseries';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import { listMembers } from '@/lib/api/members';
import { myParticipantName, setFamilyRoster, useFamilyRoster } from '@/lib/familyRoster';
import { formatBabyAge } from '@/lib/memberUtils';
import {
  deleteDoneItems,
  deleteGroup as deleteGroupApi,
  deleteItem as deleteItemApi,
  deleteList as deleteListApi,
  insertGroup,
  insertItem,
  updateGroupName,
  insertList,
  loadLists,
  moveUngroupedItems,
  seedDefaultLists,
  updateItemTitle as updateItemTitleApi,
  updateItemDone,
  updateList as updateListApi,
  updateGroupPositions,
  updateItemPositions,
  updateListPinned,
  updateListPositions,
} from '@/lib/api/lists';

import AddTaskModal from './modals/AddTaskModal';
import type { TaskDraft } from './modals/TaskForm';
import TaskDetailModal from './modals/TaskDetailModal';
import type { MilkLogInput } from './modals/MilkLogModal';
import type { DiaperLogInput } from './modals/DiaperLogModal';
import type { PumpingLogInput } from './modals/PumpingLogModal';
import type { TemperatureLogInput } from './modals/TemperatureLogModal';
import type { GrowthRecordDraft } from '@/lib/growthRecordInput';
import type { NurseryDraft } from './modals/NurseryFormModal';
import type { ListDraft } from './modals/ListEditorModal';
import { FamilySyncProvider, useFamilyRefresh } from '@/lib/familySync';

// 起動直後に表示するのは最初のタブだけなので、残りのタブは実際に開かれるまで読み込まない。
// 特にCareTabは成長グラフのためにrecharts(単体で約350KB)を持ち込むため、静的importのままだと
// グラフを一度も開かないユーザーにも初期バンドルとしてダウンロード・パースさせてしまう。
// モーダルはタップ直後に開く必要があり、かつ小さいので静的importのまま残す。
const TabFallback = () => (
  <div className="h-full w-full flex items-center justify-center">
    <div className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
  </div>
);

const ScheduleTab = dynamic(() => import('./tabs/ScheduleTab'), { loading: TabFallback });
const CareTab = dynamic(() => import('./tabs/CareTab'), { loading: TabFallback });
const ListTab = dynamic(() => import('./tabs/ListTab'), { loading: TabFallback });
const HokatsuTab = dynamic(() => import('./tabs/HokatsuTab'), { loading: TabFallback });
const InfoTab = dynamic(() => import('./tabs/InfoTab'), { loading: TabFallback });
const MoneyTab = dynamic(() => import('./tabs/MoneyTab'), { loading: TabFallback });

// 予定・リスト・育児・家計・設定の5つ（docs/family-app.md §4.1・docs/kakei.md §2）。mobile版の app/(tabs)/_layout.tsx と同じ。
// 暮らしタブは2026-10-10に廃止した（防災備蓄はリストタブから、福引チャンスは家計タブから開く。docs/home.md §2）。
const NAV_ITEMS: { id: TabId; icon: typeof Baby; label: string }[] = [
  { id: 'schedule', icon: CalendarDays, label: '予定' },
  { id: 'list', icon: ListTodo, label: 'リスト' },
  { id: 'care', icon: Baby, label: '育児' },
  { id: 'money', icon: Wallet, label: '家計' },
  { id: 'info', icon: Settings, label: '設定' },
];

// 「次はどちらから」を決めるために読む直近の授乳の件数。母乳以外（ミルク・搾乳）の
// 記録が続くと母乳の記録まで届かないため、1日ぶんの授乳の回数より多めに取る。
const RECENT_MILK_LIMIT = 30;

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
  isPrivate: false,
  recurrence: null,
  timing: '',
});

// 保存に失敗したとき、Supabaseが返した理由まで画面に出す。
// 「失敗しました」だけだと、入力のどこが悪いのか利用者にも開発者にも分からないため。
const describeError = (err: unknown): string => {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string' && message !== '') return `\n（${message}）`;
  }
  return '';
};

// 「今日」('YYYY-MM-DD')の取得は useSyncExternalStore 経由にする。
// これにより、SSR/初回hydrationはサーバーが確定させた値（getServerSnapshot）で揃い、
// hydration後はクライアントのローカル日時（getSnapshot）に切り替わる。
// new Date() を直接 useState/useMemo の初期値にすると、SSR時点とhydration時点で
// 「今日」の評価タイミング・タイムゾーンがずれ得て、描画結果が食い違いhydration
// mismatchになるため、この仕組みで回避する。
//
// 「今日」は時間の経過でしか変わらず、変化を知らせてくれるイベントは存在しない。
// そのため次の0:00にタイマーを張り、自分で日付の変わり目を知らせる。
// （夜中の授乳で使うアプリなので、開いたまま日付をまたぐことがふつうにある。
//  知らせずにいると前の日を「今日」として出し続け、その日付で記録してしまう。）
const subscribeTodayDateString = (onStoreChange: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleNextMidnight = () => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // 0:00ちょうどだとまだ前の日と判定されることがあるため、少し過ぎてから見る。
    timer = setTimeout(() => {
      onStoreChange();
      scheduleNextMidnight();
    }, nextMidnight.getTime() - now.getTime() + 1000);
  };
  scheduleNextMidnight();
  // 画面が消えている・アプリを閉じている間はタイマーが間引かれて動かないため、
  // 戻ってきたときにも確かめる。
  const handleWakeUp = () => {
    if (document.visibilityState !== 'visible') return;
    onStoreChange();
    if (timer !== undefined) clearTimeout(timer);
    scheduleNextMidnight();
  };
  document.addEventListener('visibilitychange', handleWakeUp);
  window.addEventListener('focus', handleWakeUp);
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener('visibilitychange', handleWakeUp);
    window.removeEventListener('focus', handleWakeUp);
  };
};
const getClientTodayDateString = (): string => toDateString(new Date());

interface SukusukuAppProps {
  familyId: string;
  userId: string;
  // サーバー側(page.tsx)で取得済みのタスク。あればhydration後の再取得を省略する。
  // 取得に失敗していた場合はnullで、その場合は従来通りクライアント側で取得する。
  initialTasks: Task[] | null;
  // サーバー側(page.tsx)で確定させた「今日」('YYYY-MM-DD')。todayステートの初期値に使う。
  todayDateString: string;
  // URLから決めた、最初に開くタブ。画面を更新しても見ていたタブのまま戻ってこられるようにする。
  initialTab: TabId;
  // URLから決めた、最初に開く記録の入力画面。通知のタップから直接開くのに使う。
  initialLogType: LogType | null;
}

// 他の端末での変更を各画面へ届ける台帳係（lib/familySync.tsx）を、アプリ全体の外側に1つだけ置く。
export default function SukusukuApp(props: SukusukuAppProps) {
  const supabase = useMemo(() => createClient(), []);
  return (
    <FamilySyncProvider supabase={supabase} familyId={props.familyId}>
      <SukusukuAppContent {...props} />
    </FamilySyncProvider>
  );
}

function SukusukuAppContent({
  familyId,
  userId,
  initialTasks,
  todayDateString,
  initialTab,
  initialLogType,
}: SukusukuAppProps) {
  // 授乳の経過時間のお知らせ（音・バイブ）。記録タブを開いていなくても鳴らせるよう、
  // アプリ全体で1つだけ見張りを動かす。
  useNursingAlarmWatcher();
  // 記録前の授乳が残っているか。授乳のお知らせを消してよいかの判断に使う。
  const hasNursingSession = useHasNursingSession();

  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  // 通知から開いたときに1度だけ開く入力画面。開いたら空にして、
  // タブを行き来するたびに開き直さないようにする。
  const [pendingLogType, setPendingLogType] = useState<LogType | null>(initialLogType);
  const clearPendingLogType = useCallback(() => setPendingLogType(null), []);
  const [todos, setTodos] = useState<Task[]>(initialTasks ?? []);
  const [isLoadingTasks, setIsLoadingTasks] = useState(initialTasks === null);
  const [taskError, setTaskError] = useState('');

  const [logs, setLogs] = useState<CareLog[]>([]);
  // 記録タブで表示中の日（1日区切りで過去に遡れる）
  // SSRとhydrationで食い違わないよう、サーバーが確定させた「今日」から始める。
  // 端末のローカル日時とずれていた場合や日付が変わった場合は、下の useEffect で追従する。
  const [logDate, setLogDate] = useState(() => parseDateString(todayDateString) ?? startOfDay(new Date()));
  // 取得済みの日。表示中の日と一致していなければ読み込み中とみなす
  const [loadedLogDate, setLoadedLogDate] = useState<Date | null>(null);
  const isLoadingLogs = loadedLogDate?.getTime() !== logDate.getTime();
  // 搾乳ストック。飲ませるときにどの搾乳を使うか選べるよう、残量ではなく1パックずつ持つ。
  // 表示中の日だけでは求まらないため、全期間ぶんをまとめて持つ。
  const [pumpedBatches, setPumpedBatches] = useState<PumpedBatch[]>([]);
  // 「次の授乳の目安」に使う直近の授乳。夜中の授乳は前の日の記録になるため、
  // 記録タブの1日分(logs)とは別に、日付にとらわれず新しい順で持つ。
  const [recentMilkLogs, setRecentMilkLogs] = useState<MilkLog[]>([]);
  // 家族の端末が預けている「いま授乳中・記録待ち」の印。パートナーが授乳を終えて
  // まだ記録していない間、記録だけを見ると前回の授乳が1つ前のままになってしまうため。
  // 古さの判断（置き去りの印を信じない）は、読んだ時刻を基準にする。
  const [nursing, setNursing] = useState<{ states: FamilyNursingState[]; readAt: number }>({
    states: [],
    readAt: 0,
  });
  const [isLoadingRecentMilk, setIsLoadingRecentMilk] = useState(true);
  // 平熱に使う直近の体温。その子自身の記録の平均なので、表示中の日だけでは求まらない。
  const [recentTemperatureLogs, setRecentTemperatureLogs] = useState<TemperatureLog[]>([]);
  // 授乳の間隔の設定。家族で共通なので、どちらが変えても同じ目安が出る。
  const [feedingSettings, setFeedingSettings] = useState<FeedingSettings>(DEFAULT_FEEDING_SETTINGS);
  // 検温のお知らせの設定。こちらも家族で共通なので、どちらが変えても同じ時刻に届く。
  const [temperatureReminderSettings, setTemperatureReminderSettings] =
    useState<TemperatureReminderSettings>(DEFAULT_TEMPERATURE_REMINDER_SETTINGS);


  const [growthData, setGrowthData] = useState<GrowthRecord[]>([]);
  const [isLoadingGrowth, setIsLoadingGrowth] = useState(true);
  const [childId, setChildId] = useState<string | null>(null);


  const [nurseries, setNurseries] = useState<Nursery[]>([]);
  const [isLoadingNurseries, setIsLoadingNurseries] = useState(true);

  // リスト(買い出し・やりたいこと・やること)。リストもグループも項目も多くないため、
  // リストを切り替えるたびに取り直さず、まとめて持って画面側で絞る。
  const [lists, setLists] = useState<ListBoard[]>([]);
  const [listGroups, setListGroups] = useState<ListGroup[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [isLoadingLists, setIsLoadingLists] = useState(true);

  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);

  // --- UI状態 ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<DynamicTask | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [tempEditingTask, setTempEditingTask] = useState<DynamicTask | null>(null);

  // 「今日」は日付が変わらない限り同じ参照を使う（useMemo の依存に安全に渡せるようにするため）。
  // SSR/初回hydrationはサーバーが確定させた todayDateString、hydration後はクライアントの
  // ローカル日時に切り替わる（詳細は subscribeTodayDateString 付近のコメントを参照）。
  const todayDateStringSynced = useSyncExternalStore(
    subscribeTodayDateString,
    getClientTodayDateString,
    () => todayDateString,
  );
  const today = useMemo(
    () => parseDateString(todayDateStringSynced) ?? startOfDay(new Date()),
    [todayDateStringSynced],
  );

  // 日付が変わったら、今日を見ていた記録タブも新しい今日へ送る。
  // （前の日のまま置いていくと、夜中の記録が前の日に付いてしまう。
  //  遡って過去の日を見ているときは、そのまま見ていられるよう動かさない。）
  const previousTodayRef = useRef(today);
  useEffect(() => {
    const previousToday = previousTodayRef.current;
    if (previousToday.getTime() === today.getTime()) return;
    previousTodayRef.current = today;
    setLogDate((current) => (isSameDay(current, previousToday) ? today : current));
  }, [today]);

  // ログイン中の役割から、新しい予定の主体・参加者の初期値を決める（パパ→大造 / ママ→いづみ）。
  // 家族メンバー（予定の参加者の名前と色。lib/familyRoster.ts）。
  const roster = useFamilyRoster();
  // ログインしている人の表示名。新規の予定・タスクの主体の初期値に使う。
  const ownerFromRole: Participant | null = myParticipantName(userId, roster);
  const [newTask, setNewTask] = useState<TaskDraft>(() => emptyTaskDraft(today, ownerFromRole));

  // --- スケジュール（カレンダー） ---
  // 既定は月表示。日をタップすると日表示へ移り、そこで予定と育児記録を合わせて見る。
  const [scheduleView, setScheduleView] = useState<ScheduleView>('month');
  const [currentCalendarDate, setCurrentCalendarDate] = useState(today);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(today);
  // 日表示に出す育児記録。記録タブの1日分(logs)とは表示範囲が違うため別に持つ。
  const [scheduleLogs, setScheduleLogs] = useState<CareLog[]>([]);
  const [loadedScheduleLogRange, setLoadedScheduleLogRange] = useState<string | null>(null);

  // 生後日数・出生日基準の予定に使う子。名前・誕生日は設定タブの「家族」で変える
  // （docs/family-app.md §3）。
  const childMember: Member | null = roster.find((member) => member.relation === 'child') ?? null;

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

  // 予定を取り直す。パートナーが済ませた分を拾うため、アプリに戻ったときに呼ぶ。
  const refreshTasks = useCallback(() => {
    listTasks(supabase, familyId)
      .then((data) => {
        setTodos(data);
        setTaskError('');
      })
      .catch((err: unknown) => console.error('Failed to load tasks:', err));
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

  // カレンダーの日表示に出す育児記録。表示中の範囲だけを取りに行く。
  // 月表示・週表示は記録を出さないため、めくっても問い合わせは起きない。
  const scheduleLogRange = useMemo(() => {
    if (activeTab !== 'schedule') return null;
    if (scheduleView === 'day') {
      const from = startOfDay(selectedScheduleDate);
      return { from, to: addDays(from, 1) };
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
    listRecentMilkLogs(supabase, familyId, RECENT_MILK_LIMIT)
      .then(setRecentMilkLogs)
      .catch((err: unknown) => console.error('Failed to load recent milk logs:', err))
      .finally(() => setIsLoadingRecentMilk(false));
  }, [supabase, familyId]);

  useEffect(() => {
    refreshRecentMilkLogs();
  }, [refreshRecentMilkLogs]);

  // 「いま授乳中・記録待ち」を読み直す。
  // 通知をオフにしている端末は印を預けられず、圏外なら読めない。どちらも「印は無い」
  // として扱えばよい（今までどおり記録だけで目安を出す）ので、失敗しても画面は止めない。
  const refreshNursingStates = useCallback(() => {
    listFamilyNursingState(supabase)
      .then((states) => setNursing({ states, readAt: Date.now() }))
      .catch(() => {
        // 印が読めないだけ。
      });
  }, [supabase]);

  useEffect(() => {
    refreshNursingStates();
  }, [refreshNursingStates]);

  // 授乳の始まり・終わりはパートナーの端末で起きるので、こちらが何もしなくても変わる。
  // 授乳中の印を出す育児タブを見ている間だけ、1分ごとに印だけ読み直す。
  useEffect(() => {
    if (activeTab !== 'care') return;
    const timerId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshNursingStates();
    }, 60_000);
    return () => window.clearInterval(timerId);
  }, [activeTab, refreshNursingStates]);

  // 平熱に使う直近の体温を読み込む。体温を足したり直したりするたびに取り直す。
  const refreshRecentTemperatureLogs = useCallback(() => {
    listRecentTemperatureLogs(supabase, familyId)
      .then(setRecentTemperatureLogs)
      .catch((err: unknown) => console.error('Failed to load recent temperature logs:', err));
  }, [supabase, familyId]);

  useEffect(() => {
    refreshRecentTemperatureLogs();
  }, [refreshRecentTemperatureLogs]);

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

  // 検温のお知らせの設定を読み込む。未設定の家族は既定値(朝6時・夕18時・お知らせする)のまま。
  useEffect(() => {
    let cancelled = false;
    getTemperatureReminderSettings(supabase, familyId)
      .then((settings) => {
        if (!cancelled) setTemperatureReminderSettings(settings);
      })
      .catch((err: unknown) =>
        console.error('Failed to load temperature reminder settings:', err),
      );
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

  // リストをSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    loadLists(supabase, familyId)
      .then((snapshot) => {
        if (cancelled) return;
        setLists(snapshot.lists);
        setListGroups(snapshot.groups);
        setListItems(snapshot.items);
      })
      .catch((err) => console.error('Failed to load lists:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingLists(false);
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

  useEffect(() => {
    let cancelled = false;
    listMembers(supabase, familyId)
      .then((members) => {
        if (!cancelled) setFamilyRoster(members);
      })
      .catch((err) => {
        console.error('Failed to load family members:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 他の端末（パートナー）での変更に追いつかせる（lib/familySync.tsx）。
  // 読み込みごとに、その画面が読む表を宣言する。その表が変わったときだけ、その分を読み直す。
  // 読み込み中の表示には戻さず、届いたら差し替える。失敗したら前の表示のまま。
  // 取り直しの間に日付やタブを切り替えたときは、届いた分を捨てる。
  const viewRef = useRef({ logDate, scheduleLogRangeKey });
  useEffect(() => {
    viewRef.current = { logDate, scheduleLogRangeKey };
  });

  // 記録: 表示中の日・カレンダーの日表示・搾乳ストック・直近の授乳（次の授乳の目安）・体温。
  useFamilyRefresh(['care_logs'], () => {
    listCareLogsByDate(supabase, familyId, logDate)
      .then((data) => {
        if (isSameDay(viewRef.current.logDate, logDate)) setLogs(data);
      })
      .catch((err: unknown) => console.error('Failed to refresh care logs:', err));
    if (needsScheduleLogs && scheduleLogFrom !== null && scheduleLogTo !== null) {
      listCareLogsInRange(supabase, familyId, new Date(scheduleLogFrom), new Date(scheduleLogTo))
        .then((data) => {
          if (viewRef.current.scheduleLogRangeKey === scheduleLogRangeKey) setScheduleLogs(data);
        })
        .catch((err: unknown) => console.error('Failed to refresh care logs for calendar:', err));
    }
    refreshPumpedStock();
    refreshRecentMilkLogs();
    refreshRecentTemperatureLogs();
  });
  // 「いま授乳中・記録待ち」の印（パートナーが授乳を始めた・終えた）。
  useFamilyRefresh(['nursing_alarms'], refreshNursingStates);
  // 予定（済んだお知らせを消す closeSettledNotifications にも使う）。
  useFamilyRefresh(['tasks'], refreshTasks);
  useFamilyRefresh(['lists', 'list_groups', 'list_items'], () => {
    loadLists(supabase, familyId)
      .then((snapshot) => {
        setLists(snapshot.lists);
        setListGroups(snapshot.groups);
        setListItems(snapshot.items);
      })
      .catch((err: unknown) => console.error('Failed to refresh lists:', err));
  });
  // 家族メンバー（表示名・子の名前と誕生日）。
  useFamilyRefresh(['family_members', 'families', 'children'], () => {
    listFamilyMembers(supabase, familyId)
      .then(setFamilyMembers)
      .catch((err: unknown) => console.error('Failed to refresh family members:', err));
    listMembers(supabase, familyId)
      .then(setFamilyRoster)
      .catch((err: unknown) => console.error('Failed to refresh family roster:', err));
  });
  useFamilyRefresh(['feeding_settings'], () => {
    getFeedingSettings(supabase, familyId)
      .then(setFeedingSettings)
      .catch((err: unknown) => console.error('Failed to refresh feeding settings:', err));
  });
  useFamilyRefresh(['temperature_reminder_settings'], () => {
    getTemperatureReminderSettings(supabase, familyId)
      .then(setTemperatureReminderSettings)
      .catch((err: unknown) =>
        console.error('Failed to refresh temperature reminder settings:', err),
      );
  });
  useFamilyRefresh(['growth_records', 'children'], () => {
    if (!childId) return;
    listGrowthRecords(supabase, childId)
      .then(setGrowthData)
      .catch((err: unknown) => console.error('Failed to refresh growth records:', err));
  });
  useFamilyRefresh(['nurseries'], () => {
    listNurseries(supabase, familyId)
      .then(setNurseries)
      .catch((err: unknown) => console.error('Failed to refresh nurseries:', err));
  });

  // 次にどちらの乳首から授乳するか。夜中の授乳は前の日の記録になるため、表示中の日の
  // 記録だけでは前回を取りこぼし、おすすめの側が出なくなる。日付にとらわれない直近の授乳も
  // 合わせて渡し、その中でいちばん新しい母乳の記録から決める。
  // （表示中の日の記録は保存した時点で入るので、圏外でも直後から新しい側が出る）
  const recordedNextBreastSide = useMemo<BreastSide | null>(
    () => getNextBreastSide([...logs, ...recentMilkLogs]),
    [logs, recentMilkLogs],
  );
  // 記録に入る前の授乳（家族の端末の計測中・記録待ち）。記録だけを見ていると、
  // パートナーが授乳を終えて保存するまでの間、1つ前の側が出てしまう。
  // 自分の端末で測っている分はここには要らない（計測中のバナーが出る）。
  const familyNursing = useMemo(
    () => (hasNursingSession ? null : activePendingNursing(nursing.states, nursing.readAt)),
    [hasNursingSession, nursing],
  );
  // 保存が済んだあと印の消え方が遅れても、記録と食い違わないようにする
  // （ホームの「次の授乳の目安」と同じ決め方。lib/feedingSchedule.ts）。
  const lastMilkAt = useMemo(() => {
    const times = [...logs, ...recentMilkLogs]
      .filter((log) => log.type === 'milk')
      .map((log) => log.time.getTime());
    return times.length > 0 ? new Date(Math.max(...times)) : null;
  }, [logs, recentMilkLogs]);
  const lastFeeding = resolveLastFeeding(lastMilkAt, familyNursing);
  // 相手がまだ飲ませている最中は、次の側ではなくそれを出す（終わってから決まるため）。
  const nursingBy = lastFeeding.isNursing ? (familyNursing?.userId ?? null) : null;
  // 測り終えて記録がまだなら、その最後に飲ませた側の逆がおすすめ。
  // （計測中の区切りにはゲップも入るが、記録待ちの印に入るのは左右だけ）
  const pendingLastSide =
    lastFeeding.isPendingRecord && familyNursing && familyNursing.side !== 'burp'
      ? familyNursing.side
      : null;
  const nextBreastSide: BreastSide | null = pendingLastSide
    ? pendingLastSide === 'left'
      ? 'right'
      : 'left'
    : recordedNextBreastSide;

  // 「次の授乳の目安」に出す一式。育児タブの見出しに出す。
  const nextFeeding = useMemo<NextFeedingInfo>(
    () => ({
      lastFedAt: recentMilkLogs[0]?.time ?? null,
      // 母乳は測り終えて保存するまで記録に入らない。その隙間も前回の授乳として扱う。
      pendingNursing: activePendingNursing(nursing.states, nursing.readAt),
      intervalMinutes: feedingSettings.intervalMinutes,
      isLoading: isLoadingRecentMilk,
    }),
    [recentMilkLogs, nursing, feedingSettings.intervalMinutes, isLoadingRecentMilk],
  );

  const memberLabel = (id: string | null): string => {
    if (!id) return '不明';
    const member = familyMembers.find((m) => m.id === id);
    if (member?.name) return member.name;
    if (id === userId) return 'あなた';
    return 'パートナー';
  };

  const birthDateValue = childMember?.birthDate ?? '';

  const dynamicTodos = useMemo<DynamicTask[]>(() => {
    return todos.map((todo) => {
      // 日付指定の予定は start_date をそのまま使い、
      // 出生日基準の予定は「子の誕生日 + 生後日数」で解決する。
      const targetDateObj =
        todo.anchorType === 'absolute'
          ? parseDateString(todo.startDate ?? '')
          : calculateTargetDate(birthDateValue, todo.daysAfterBirth);
      // 繰り返す予定はここでは1件のまま（元の予定）。表示する範囲ごとに ScheduleTab で回へ展開する。
      return {
        ...todo,
        targetDateObj,
        targetDate: formatDateString(targetDateObj),
        occurrenceDate: targetDateObj ? toDateString(targetDateObj) : null,
        occurrenceKey: todo.id,
      };
    });
  }, [todos, birthDateValue]);

  // 育児タブの見出しに出す子の月齢（「生後123日目（4ヶ月2日）」）。
  const babyAge = useMemo(() => formatBabyAge(birthDateValue, today), [birthDateValue, today]);

  // 完了の切り替え。繰り返す予定は、押した1回だけを完了にする（done_dates）。
  // 繰り返さない予定は、予定そのものの完了（is_done）。
  const toggleTodo = async (task: DynamicTask) => {
    const target = todos.find((t) => t.id === task.id);
    if (!target) return;

    if (target.recurrence && task.occurrenceDate) {
      const date = task.occurrenceDate;
      const previousDates = target.doneDates;
      const nextDates = toggledDoneDates(previousDates, date);
      const nextDone = nextDates.includes(date);

      // 楽観的更新
      setTodos((prev) => prev.map((todo) => (todo.id === task.id ? { ...todo, doneDates: nextDates } : todo)));
      setSelectedTask((prev) =>
        prev && prev.occurrenceKey === task.occurrenceKey ? { ...prev, done: nextDone, doneDates: nextDates } : prev,
      );

      try {
        await updateTaskDoneDates(supabase, task.id, nextDates);
      } catch (err) {
        console.error('Failed to update task:', err);
        // 失敗時はロールバック
        setTodos((prev) =>
          prev.map((todo) => (todo.id === task.id ? { ...todo, doneDates: previousDates } : todo)),
        );
        setSelectedTask((prev) =>
          prev && prev.occurrenceKey === task.occurrenceKey
            ? { ...prev, done: !nextDone, doneDates: previousDates }
            : prev,
        );
      }
      return;
    }

    const id = task.id;
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

    // 編集の対象は展開した1回ぶんだが、保存されるのは元の予定（全部の回に効く）。
    // 完了の状態は編集では変えないので、元の予定の値を残す。
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === updated.id
          ? { ...todo, ...updated, doneDates: todo.doneDates, done: updated.recurrence ? false : updated.done }
          : todo,
      ),
    );
    // 繰り返す予定は、日付や繰り返しを直すとこの回が無くなることがあるので詳細も閉じる。
    setSelectedTask(updated.recurrence ? null : updated);
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

  const handleAddTask = async () => {
    if (!newTask.title) return;
    const input = { ...newTask };

    setShowAddModal(false);
    setNewTask(emptyTaskDraft(today, ownerFromRole));

    try {
      const created = await insertTask(supabase, familyId, input, userId);
      setTodos((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to add task:', err);
      alert('予定の追加に失敗しました。もう一度お試しください。');
    }
  };

  // カレンダーで選んでいる日を初期値にして予定を追加する。
  const openAddTaskModal = (date: Date) => {
    setNewTask(emptyTaskDraft(date, ownerFromRole));
    setShowAddModal(true);
  };

  // カレンダーの日表示から、その日の記録タブへ移る。
  const openLogTabForDate = (date: Date) => {
    setLogDate(startOfDay(date));
    setActiveTab('care');
  };

  // ナビゲーションからタブを切り替える。
  // 記録タブは開くたびに今日を出す（前に遡って見ていた日を引きずると、
  // 気づかないまま過去の日に記録してしまうため）。
  const selectTab = (tab: TabId) => {
    if (tab === 'care') setLogDate(startOfDay(new Date()));
    setActiveTab(tab);
  };

  // 開いているタブと予定タブの面を、ブラウザの履歴とURLへ書き戻す。
  // - 履歴: 切り替えるたびに1つ積む。戻る操作（スマホの戻るボタンを含む）で1つ前の
  //   タブ・面へ戻れるようにするため。最初のタブまで戻ると、アプリを閉じる操作になる
  // - URL: 画面を更新したときに、見ていたタブのまま戻ってこられるようにするため
  //   （URLに残っていないと毎回最初のタブに戻ってしまう）
  // 通知から開くための open は、入力画面を開いたら消す（更新のたびに開き直さないため）。
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set(TAB_PARAM, activeTab);
    if (!pendingLogType) url.searchParams.delete(OPEN_LOG_PARAM);
    syncNav({ tab: activeTab, view: scheduleView }, url);
  }, [activeTab, scheduleView, pendingLogType]);

  // 戻る・進む操作で履歴のタブ・面が変わったときに、画面をそれに合わせる。
  useEffect(
    () =>
      onNavPop(({ tab, view }) => {
        setActiveTab(tab as TabId);
        setScheduleView(view as ScheduleView);
      }),
    [],
  );

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
      // 平熱も、体温を足したり直したりすれば動く。
      refreshRecentTemperatureLogs();
    },
    [logDate, refreshPumpedStock, refreshRecentMilkLogs, refreshRecentTemperatureLogs],
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

  const saveTemperatureLog = (input: TemperatureLogInput, existing: TemperatureLog | null) =>
    saveLog(existing, { type: 'temperature', ...input });

  /**
   * 搾乳ストックの1パックを丸ごと捨てる / 捨てたのを取り消す。
   *
   * 搾った記録は残したまま印だけを付け外しするので、記録の保存とは別の道を通る。
   * 一覧に出ていない日の搾乳も捨てられるよう、記録そのものは読み込まずidだけで書き換える。
   */
  const discardPumpedBatch = async (id: string, discarded: boolean) => {
    const discardedAt = discarded ? new Date() : null;
    try {
      await setPumpedBatchDiscarded(supabase, id, discardedAt);
      // 表示中の日にその搾乳があれば、カードの「破棄」も入れ替える。
      setLogs((prev) =>
        prev.map((log) =>
          log.id === id && log.type === 'pumping'
            ? { ...log, discardedAt: discardedAt ?? undefined }
            : log,
        ),
      );
      setLoadedScheduleLogRange(null);
      refreshPumpedStock();
    } catch (err) {
      console.error('Failed to update pumped milk stock:', err);
      alert('搾乳ストックの更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteLog = async (id: string) => {
    const previous = logs;
    setLogs((prev) => prev.filter((l) => l.id !== id));
    setLoadedScheduleLogRange(null);
    try {
      await deleteCareLog(supabase, id);
      refreshPumpedStock();
      refreshRecentMilkLogs();
      refreshRecentTemperatureLogs();
    } catch (err) {
      console.error('Failed to delete care log:', err);
      setLogs(previous);
      alert('記録の削除に失敗しました。もう一度お試しください。');
    }
  };

  // --- 成長記録 ---
  const addGrowthRecordHandler = async (draft: GrowthRecordDraft) => {
    try {
      const id = childId ?? (await ensureChildId(supabase, familyId));
      if (!childId) setChildId(id);
      const created = await insertGrowthRecord(supabase, id, {
        monthAge: draft.monthAge,
        height: draft.height,
        weight: draft.weight,
        recordedDate: draft.recordedDate,
      });
      setGrowthData((prev) => [...prev, created].sort((a, b) => a.recordedDate.localeCompare(b.recordedDate)));
    } catch (err) {
      console.error('Failed to add growth record:', err);
      alert(`成長記録の追加に失敗しました。もう一度お試しください。${describeError(err)}`);
    }
  };

  const updateGrowthRecordHandler = async (record: GrowthRecord, draft: GrowthRecordDraft) => {
    const updated: GrowthRecord = {
      ...record,
      month: draft.monthAge,
      height: draft.height,
      weight: draft.weight,
      recordedDate: draft.recordedDate,
    };
    const previous = growthData;
    setGrowthData((prev) =>
      prev.map((r) => (r.id === record.id ? updated : r)).sort((a, b) => a.recordedDate.localeCompare(b.recordedDate)),
    );
    try {
      await updateGrowthRecordApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update growth record:', err);
      // 失敗したまま新しい値を表示し続けると、保存できたと誤解されるため元に戻す
      setGrowthData(previous);
      alert(`成長記録の更新に失敗しました。もう一度お試しください。${describeError(err)}`);
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
      alert(`成長記録の削除に失敗しました。もう一度お試しください。${describeError(err)}`);
    }
  };

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

  // --- リスト ---
  // 打ち込んだ直後に画面へ出し、保存に失敗したら元へ戻す（買い出し中に入力が引っかからないように）。
  const addListHandler = async (draft: ListDraft): Promise<ListBoard | null> => {
    try {
      const created = await insertList(
        supabase,
        familyId,
        {
          name: draft.name,
          groupLabel: draft.groupLabel,
          position: lists.length,
          isPrivate: draft.isPrivate,
        },
        userId,
      );
      setLists((prev) => [...prev, created]);
      return created;
    } catch (err) {
      console.error('Failed to add list:', err);
      alert('リストの追加に失敗しました。もう一度お試しください。');
      return null;
    }
  };

  const updateListHandler = async (list: ListBoard, draft: ListDraft) => {
    const previous = lists;
    const updated: ListBoard = {
      ...list,
      ...draft,
      // 共有設定が入る前に作られたリストは作成者を持たない。そのまま「自分だけ」に
      // すると誰にも見えなくなるため、切り替えた本人を作成者として入れる。
      createdBy: list.createdBy ?? (draft.isPrivate ? userId : null),
    };
    setLists((prev) => prev.map((l) => (l.id === list.id ? updated : l)));
    try {
      await updateListApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update list:', err);
      setLists(previous);
      alert('リストの更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteListHandler = async (id: string) => {
    const previous = { lists, groups: listGroups, items: listItems };
    // DB側は外部キーの連鎖削除で消えるが、画面はすぐ消したいので手元でも外す。
    setLists((prev) => prev.filter((l) => l.id !== id));
    setListGroups((prev) => prev.filter((g) => g.listId !== id));
    setListItems((prev) => prev.filter((i) => i.listId !== id));
    try {
      await deleteListApi(supabase, id);
    } catch (err) {
      console.error('Failed to delete list:', err);
      setLists(previous.lists);
      setListGroups(previous.groups);
      setListItems(previous.items);
      alert('リストの削除に失敗しました。もう一度お試しください。');
    }
  };

  // 一覧の先頭に固定するかを切り替える（Google Keepのピン止め）。
  const toggleListPinHandler = async (list: ListBoard) => {
    const pinned = !list.pinned;
    setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, pinned } : l)));
    try {
      await updateListPinned(supabase, list.id, pinned);
    } catch (err) {
      console.error('Failed to update list pin:', err);
      setLists((prev) => prev.map((l) => (l.id === list.id ? list : l)));
      alert('固定の切り替えに失敗しました。もう一度お試しください。');
    }
  };

  /** 並べ替えの反映。渡された順を position として手元にも当てる。 */
  function applyPositions<T extends { id: string; position: number }>(rows: T[], orderedIds: string[]): T[] {
    const positions = new Map(orderedIds.map((id, index) => [id, index]));
    return rows.map((row) => {
      const position = positions.get(row.id);
      return position === undefined ? row : { ...row, position };
    });
  }

  const reorderListsHandler = async (orderedIds: string[]) => {
    const previous = lists;
    setLists((prev) => applyPositions(prev, orderedIds));
    try {
      await updateListPositions(supabase, orderedIds);
    } catch (err) {
      console.error('Failed to reorder lists:', err);
      setLists(previous);
      alert('並べ替えの保存に失敗しました。もう一度お試しください。');
    }
  };

  const reorderGroupsHandler = async (orderedIds: string[]) => {
    const previous = listGroups;
    setListGroups((prev) => applyPositions(prev, orderedIds));
    try {
      await updateGroupPositions(supabase, orderedIds);
    } catch (err) {
      console.error('Failed to reorder list groups:', err);
      setListGroups(previous);
      alert('並べ替えの保存に失敗しました。もう一度お試しください。');
    }
  };

  const reorderItemsHandler = async (orderedIds: string[]) => {
    const previous = listItems;
    setListItems((prev) => applyPositions(prev, orderedIds));
    try {
      await updateItemPositions(supabase, orderedIds);
    } catch (err) {
      console.error('Failed to reorder list items:', err);
      setListItems(previous);
      alert('並べ替えの保存に失敗しました。もう一度お試しください。');
    }
  };

  const addGroupHandler = async (listId: string, name: string) => {
    const position = listGroups.filter((g) => g.listId === listId).length;
    try {
      const created = await insertGroup(supabase, { listId, name, position });
      setListGroups((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to add list group:', err);
      alert('追加に失敗しました。もう一度お試しください。');
    }
  };

  const renameGroupHandler = async (id: string, name: string) => {
    const previous = listGroups;
    setListGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
    try {
      await updateGroupName(supabase, id, name);
    } catch (err) {
      console.error('Failed to rename list group:', err);
      setListGroups(previous);
      alert('名前の変更に失敗しました。もう一度お試しください。');
    }
  };

  // 未分類に名前を付ける。未分類はグループの行を持たないので、その名前のグループを
  // 末尾（未分類が出ていた位置）に作り、未分類の項目をそこへ移す。
  const nameUngroupedHandler = async (listId: string, name: string) => {
    const position = listGroups.filter((g) => g.listId === listId).length;
    let created: ListGroup;
    try {
      created = await insertGroup(supabase, { listId, name, position });
    } catch (err) {
      console.error('Failed to add list group:', err);
      alert('名前の変更に失敗しました。もう一度お試しください。');
      return;
    }
    setListGroups((prev) => [...prev, created]);
    const previousItems = listItems;
    setListItems((prev) =>
      prev.map((i) => (i.listId === listId && i.groupId === null ? { ...i, groupId: created.id } : i)),
    );
    try {
      await moveUngroupedItems(supabase, listId, created.id);
    } catch (err) {
      // グループはできているので残し、項目だけ未分類へ戻す。
      console.error('Failed to move ungrouped items:', err);
      setListItems(previousItems);
      alert('項目の移動に失敗しました。もう一度お試しください。');
    }
  };

  // グループを消しても中の項目は消さず、未分類へ落とす（買い忘れを生まないため）。
  const deleteGroupHandler = async (id: string) => {
    const previous = { groups: listGroups, items: listItems };
    setListGroups((prev) => prev.filter((g) => g.id !== id));
    setListItems((prev) => prev.map((i) => (i.groupId === id ? { ...i, groupId: null } : i)));
    try {
      await deleteGroupApi(supabase, id);
    } catch (err) {
      console.error('Failed to delete list group:', err);
      setListGroups(previous.groups);
      setListItems(previous.items);
      alert('削除に失敗しました。もう一度お試しください。');
    }
  };

  const addItemHandler = async (listId: string, groupId: string | null, title: string) => {
    const position = listItems.filter((i) => i.listId === listId).length;
    try {
      const created = await insertItem(supabase, { listId, groupId, title, position });
      setListItems((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to add list item:', err);
      alert('項目の追加に失敗しました。もう一度お試しください。');
    }
  };

  const toggleItemHandler = async (id: string) => {
    const target = listItems.find((i) => i.id === id);
    if (!target) return;
    const done = !target.done;
    // 完了した時刻も持つ。完了した項目は消さずに残すため（docs/lists.md §2）。
    const doneAt = done ? new Date() : null;
    setListItems((prev) => prev.map((i) => (i.id === id ? { ...i, done, doneAt } : i)));
    try {
      await updateItemDone(supabase, id, done, doneAt);
    } catch (err) {
      console.error('Failed to toggle list item:', err);
      setListItems((prev) => prev.map((i) => (i.id === id ? target : i)));
    }
  };

  const renameItemHandler = async (item: ListItem, title: string) => {
    setListItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, title } : i)));
    try {
      await updateItemTitleApi(supabase, item.id, title);
    } catch (err) {
      console.error('Failed to update list item:', err);
      setListItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      alert('項目の更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteItemHandler = async (id: string) => {
    const previous = listItems;
    setListItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await deleteItemApi(supabase, id);
    } catch (err) {
      console.error('Failed to delete list item:', err);
      setListItems(previous);
      alert('項目の削除に失敗しました。もう一度お試しください。');
    }
  };

  const clearDoneItemsHandler = async (listId: string) => {
    const previous = listItems;
    setListItems((prev) => prev.filter((i) => !(i.listId === listId && i.done)));
    try {
      await deleteDoneItems(supabase, listId);
    } catch (err) {
      console.error('Failed to clear done list items:', err);
      setListItems(previous);
      alert('削除に失敗しました。もう一度お試しください。');
    }
  };

  // リストが空のときに、いつも使う3つ(買い出し・やりたいこと・やること)をまとめて作る
  const addDefaultListsHandler = async () => {
    try {
      const created = await seedDefaultLists(supabase, familyId, userId);
      setLists((prev) => [...prev, ...created]);
    } catch (err) {
      console.error('Failed to add default lists:', err);
      alert('リストの追加に失敗しました。もう一度お試しください。');
    }
  };

  // スマホ・タブレット・PCのいずれでもビューポート全体を使う（PCで中央の細長いカードにしない）。
  // ただし単に画面幅いっぱいに引き伸ばすと一覧やグリッドの間延びで読みにくくなるため、
  // 各タブ側で本文の幅を読みやすい範囲に収めている（記録タブの2カラム表示など、幅を
  // 必要とする画面はタブ側で個別に対応する）。
  // ナビゲーションは desktop（幅1024px以上 かつ マウス操作）のときだけ左サイドナビにし、
  // スマホとタブレットは同じボトムタブバーで揃える。タブレットは幅だけ見ると md/lg に
  // 該当してしまうため、幅ではなくポインタ種別を含む desktop 変種で切り替えている。
  return (
    <div className="w-full h-svh relative bg-gray-50 flex font-sans overflow-hidden">
      <nav className="hidden desktop:flex desktop:flex-col desktop:w-64 flex-none bg-white border-r border-gray-200 px-3 py-6">
        <h1 className="font-bold text-gray-800 tracking-wide text-lg px-3 mb-8">かぞく手帳</h1>
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
          {activeTab === 'list' && (
            <ListTab
              familyId={familyId}
              lists={lists}
              groups={listGroups}
              items={listItems}
              isLoading={isLoadingLists}
              onAddList={addListHandler}
              onUpdateList={updateListHandler}
              onDeleteList={deleteListHandler}
              onAddGroup={addGroupHandler}
              onRenameGroup={renameGroupHandler}
              onDeleteGroup={deleteGroupHandler}
              onNameUngrouped={nameUngroupedHandler}
              onAddItem={addItemHandler}
              onToggleItem={toggleItemHandler}
              onRenameItem={renameItemHandler}
              onDeleteItem={deleteItemHandler}
              onClearDone={clearDoneItemsHandler}
              onAddDefaultLists={addDefaultListsHandler}
              onToggleListPin={toggleListPinHandler}
              onReorderLists={reorderListsHandler}
              onReorderGroups={reorderGroupsHandler}
              onReorderItems={reorderItemsHandler}
            />
          )}
          {activeTab === 'care' && (
            <CareTab
              babyAge={babyAge}
              nextFeeding={nextFeeding}
              logs={logs}
              logDate={logDate}
              initialLogType={pendingLogType}
              onOpenInitialLogType={clearPendingLogType}
              today={today}
              onChangeLogDate={setLogDate}
              birthDate={birthDateValue}
              growthData={growthData}
              isLoadingLogs={isLoadingLogs}
              isLoadingGrowth={isLoadingGrowth}
              memberLabel={memberLabel}
              nextBreastSide={nextBreastSide}
              nursingBy={nursingBy}
              pumpedBatches={pumpedBatches}
              onDiscardPumpedBatch={discardPumpedBatch}
              onSaveMilkLog={saveMilkLog}
              onSaveDiaperLog={saveDiaperLog}
              onSavePumpingLog={savePumpingLog}
              onSaveTemperatureLog={saveTemperatureLog}
              recentTemperatureLogs={recentTemperatureLogs}
              babyName={childMember?.displayName ?? ''}
              onDeleteLog={deleteLog}
              onAddGrowthRecord={addGrowthRecordHandler}
              onUpdateGrowthRecord={updateGrowthRecordHandler}
              onDeleteGrowthRecord={deleteGrowthRecordHandler}
            />
          )}
          {activeTab === 'money' && <MoneyTab familyId={familyId} userId={userId} />}
          {activeTab === 'info' && (
            <InfoTab
              familyId={familyId}
              userId={userId}
              feedingSettings={feedingSettings}
              onChangeFeedingSettings={setFeedingSettings}
              temperatureReminderSettings={temperatureReminderSettings}
              onChangeTemperatureReminderSettings={setTemperatureReminderSettings}
              hokatsuPanel={
                <HokatsuTab
                  nurseries={nurseries}
                  isLoadingNurseries={isLoadingNurseries}
                  onAddNursery={addNurseryHandler}
                  onUpdateNursery={updateNurseryHandler}
                  onDeleteNursery={deleteNurseryHandler}
                  onAddDefaultNurseries={addDefaultNurseriesHandler}
                />
              }
            />
          )}
        </main>

        {/* 月表示では、右下のボタンが「直近のスケジュール」の一覧に重なって隠してしまうため、
            追加ボタンをその見出しの中に置く（UpcomingTasks）。それ以外の表示ではここに置く。 */}
        {activeTab === 'schedule' && scheduleView !== 'month' && (
          <button
            aria-label="予定を追加"
            onClick={() => openAddTaskModal(selectedScheduleDate)}
            className="absolute bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] right-4 desktop:bottom-8 desktop:right-8 w-14 h-14 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-blue-600 hover:scale-105 transition-all active:scale-95 z-20"
          >
            <Plus size={28} />
          </button>
        )}

        <nav className="flex-none bg-white border-t border-gray-200 w-full z-30 pb-[env(safe-area-inset-bottom)] desktop:hidden">
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
        onChange={setNewTask}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddTask}
      />
      <TaskDetailModal
        selectedTask={selectedTask}
        isEditingTask={isEditingTask}
        tempEditingTask={tempEditingTask}
        onStartEdit={() => setIsEditingTask(true)}
        onChangeTempEditingTask={setTempEditingTask}
        onSaveEdit={saveTaskEdit}
        onClose={closeTaskDetail}
        onToggleDone={() => selectedTask && toggleTodo(selectedTask)}
        onDelete={() => selectedTask && handleDeleteTask(selectedTask.id)}
      />
    </div>
  );
}
