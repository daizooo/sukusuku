import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Droplet,
  Plus,
  Thermometer,
  Undo2,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type {
  BreastSide,
  CareLog,
  DiaperLog,
  FamilyMember,
  FeedingMethod,
  MilkLog,
  PumpedBatch,
  GrowthRecord,
  PumpingLog,
  TemperatureLog,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import {
  listRecentMilkLogs,
  listRecentTemperatureLogs,
  setPumpedBatchDiscarded,
} from '@/lib/api/careLogs';
import { getChildMember } from '@/lib/api/members';
import { getFeedingSettings } from '@/lib/api/feedingSettings';
import { formatBabyAge } from '@/lib/memberUtils';
import { ensureChildId } from '@/lib/api/children';
import {
  deleteGrowthRecord,
  insertGrowthRecord,
  listGrowthRecords,
  updateGrowthRecord,
} from '@/lib/api/growthRecords';
import type { GrowthRecordDraft } from '@/lib/growthRecordInput';
import {
  formatCelsius,
  formatStopwatch,
  getLatestTemperature,
  getNextBreastSide,
  getSideLabel,
  getTemperatureBaseline,
  summarizeLogs,
} from '@/lib/careLogUtils';
import {
  addDays,
  formatDateWithWeekday,
  formatTimeString,
  isSameDay,
  parseDateString,
  startOfDay,
} from '@/lib/dateUtils';
import { OPEN_LOG_PARAM, parseLogType } from '@/lib/appLinks';
import { useNursingTimer } from '@/lib/nursingTimer';
import { listFamilyNursingState, type FamilyNursingState } from '@/lib/api/nursingAlarms';
import {
  DEFAULT_FEEDING_INTERVAL_MINUTES,
  activePendingNursing,
  resolveLastFeeding,
  type NextFeedingInfo,
} from '@/lib/feedingSchedule';
import { useRefreshOnFocus, useRefreshWhileFocused } from '@/lib/screenFocus';
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation';
import {
  isNursingForegroundServiceAvailable,
  requestNursingNotificationPermission,
} from '@/lib/nursingAlarm';
import {
  countUnsentCareLogs,
  queueDeleteCareLog,
  queueInsertCareLog,
  queueUpdateCareLog,
  readCachedLogsInRange,
  readCachedPumpedBatches,
  syncCareLogsInRange,
} from '@/lib/offline/careLogs';
import BabyBottleIcon from '@/components/ui/BabyBottleIcon';
import NextFeedingCard from '@/components/NextFeedingCard';
import BodyPanel from '@/components/care/BodyPanel';
import LogTimeline from '@/components/log/LogTimeline';
import GrowthRecordFormModal from '@/components/log/GrowthRecordFormModal';
import DiaperLogModal, { type DiaperLogInput } from '@/components/log/DiaperLogModal';
import MilkLogModal, { type MilkLogInput } from '@/components/log/MilkLogModal';
import PumpingLogModal, { type PumpingLogInput } from '@/components/log/PumpingLogModal';
import TemperatureLogModal, {
  type TemperatureLogInput,
} from '@/components/log/TemperatureLogModal';

// 育児タブ（docs/family-app.md §4.2）。もとの記録タブに、ホームの「生後日数」「次の授乳」を
// まとめたもの。上に子の月齢と次の授乳を固定し、その下にその日の記録を出す。
//
// 記録は 授乳・ミルク / 搾乳 / おむつ。体温と身長・体重は「からだ」のボタンから開く画面で
// 記録して振り返る（以前の「成長」の切り替えをここへ寄せた）。保活は設定タブへ移した。
// PWA版の `src/components/sukusuku/tabs/CareTab.tsx` に合わせてある。
//
// 体温は PWA版（src/）にも同じものが入っている（docs/what-to-record.md §4-1・§8）。
//
// 画面の作り方はルートの CLAUDE.md に従い、日付送りと記録ボタンは固定して、
// スクロールはその日の一覧だけに閉じる。

// 「次はどちらから」を決めるために読む直近の授乳の件数。母乳以外（ミルク・搾乳）の
// 記録が続くと母乳の記録まで届かないため、1日ぶんの授乳の回数より多めに取る。
const RECENT_MILK_LIMIT = 30;

/**
 * 「いま授乳中・記録待ち」を読み直す間隔。
 * 授乳の始まり・終わりはパートナーの端末で起きるので、こちらからは待つしかない。
 */
const NURSING_POLL_MS = 60_000;

export default function CareScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const timer = useNursingTimer();

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [logDate, setLogDate] = useState(() => startOfDay(new Date()));
  // 予定タブの日表示から「育児タブで開く」で来たときは、その日を開く
  // （Web版が記録タブの日付を差し替えるのと同じ動き）。
  // お知らせのタップで来たときは、その用件の入力画面を開く（open）。
  const { date: requestedDate, open: requestedOpen } = useLocalSearchParams<{
    date?: string;
    open?: string;
  }>();
  useEffect(() => {
    const picked = requestedDate ? parseDateString(requestedDate) : null;
    if (picked) setLogDate(startOfDay(picked));
  }, [requestedDate]);
  const [logs, setLogs] = useState<CareLog[]>([]);
  const [pumpedBatches, setPumpedBatches] = useState<PumpedBatch[]>([]);
  const [unsentCount, setUnsentCount] = useState(0);
  // 平熱に使う直近の体温。その子自身の記録の平均なので、表示中の日だけでは求まらない。
  const [recentTemperatureLogs, setRecentTemperatureLogs] = useState<TemperatureLog[]>([]);
  // 「次はどちらから」に使う直近の授乳。夜中の授乳は前の日の記録になるため、
  // 表示中の日だけを見ると前回を取りこぼし、おすすめの側が出なくなる。
  const [recentMilkLogs, setRecentMilkLogs] = useState<MilkLog[]>([]);
  // 家族の端末が預けている「いま授乳中・記録待ち」の印。パートナーが授乳を終えて
  // まだ記録していない間、記録だけを見ると1つ前の側が出てしまうため。
  const [nursingStates, setNursingStates] = useState<FamilyNursingState[]>([]);
  // プロフィールに登録された子の名前。体温の入力画面で「◯の平熱」と出すのに使う。
  const [babyName, setBabyName] = useState('');
  // 所属の家族を読み終えたか。familyId が無いままだと下の「その日の記録」の
  // 読み込みは始まらない（isLoading はそちらの状態なので false にならない）ため、
  // 「まだ家族に属していません」を出せるかどうかはこちらで別に持つ。
  const [isLoadingFamily, setIsLoadingFamily] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // 開いている入力画面。log が null なら新規追加、入っていればその記録の編集。
  const [editing, setEditing] = useState<{ log: MilkLog | null } | null>(null);
  const [editingPumping, setEditingPumping] = useState<{ log: PumpingLog | null } | null>(null);
  // 「からだ」（体温・身長・体重の記録と履歴）を開いているか。開いたときは閉じている。
  const [bodyOpen, setBodyOpen] = useState(false);
  // 次の授乳の目安の間隔（設定タブの「通知」で変える）。
  const [intervalMinutes, setIntervalMinutes] = useState(DEFAULT_FEEDING_INTERVAL_MINUTES);
  const [childId, setChildId] = useState<string | null>(null);
  const [growthData, setGrowthData] = useState<GrowthRecord[]>([]);
  const [isLoadingGrowth, setIsLoadingGrowth] = useState(true);
  const [birthDate, setBirthDate] = useState('');
  const [growthModal, setGrowthModal] = useState<{
    mode: 'add' | 'edit';
    record: GrowthRecord | null;
  } | null>(null);
  // 搾乳の入力画面から「飲ませた」に戻したとき、授乳の入力画面で選んでおく種類。
  const [milkModalMethod, setMilkModalMethod] = useState<FeedingMethod | undefined>(undefined);
  const [editingDiaper, setEditingDiaper] = useState<{ log: DiaperLog | null } | null>(null);
  const [editingTemperature, setEditingTemperature] = useState<{
    log: TemperatureLog | null;
  } | null>(null);

  // お知らせをタップして来たときに、その用件の入力画面を開く。
  // 検温のお知らせなら体温、次の授乳の目安なら授乳・ミルク——PWA版がURLの `open` で
  // 同じことをしている（src/lib/appLinks.ts）。
  useEffect(() => {
    const type = parseLogType(requestedOpen);
    if (!type) return;
    // 開いたらパラメータを消す。この画面へ戻るたびに開き直さないため（PWA版と同じ）。
    router.setParams({ [OPEN_LOG_PARAM]: '' });
    if (type === 'milk') setEditing({ log: null });
    else if (type === 'pumping') setEditingPumping({ log: null });
    else if (type === 'diaper') setEditingDiaper({ log: null });
    else setEditingTemperature({ log: null });
  }, [requestedOpen]);

  // グラフの横軸。生後ヶ月が未入力の記録は横軸が空になってしまうため、記録日で代替する。
  const growthChartData = useMemo(
    () =>
      growthData.map((record) => ({
        ...record,
        axisLabel:
          record.month !== null
            ? `${record.month}ヶ月`
            : record.recordedDate.slice(5).replace('-', '/'),
      })),
    [growthData],
  );

  const today = startOfDay(new Date());
  const isToday = isSameDay(logDate, today);
  // 表示している日の範囲。描画のたびに作り直すと読み込みが止まらなくなるので、日が変わったときだけ。
  const range = useMemo(() => ({ from: logDate, to: addDays(logDate, 1) }), [logDate]);

  // 矢印ボタンと同じ操作を、画面上どこでの横スワイプでもできるようにする。
  // 「次の日」ボタンが isToday で disabled なのと同じく、今日より先へはスワイプでも進めない。
  // 「からだ」には日付送りが無いため、記録の一覧を出している間だけ有効にする。
  // 中身（日付とその日の記録のパネル）は指に合わせて横に動く。
  const swipe = useSwipeNavigation({
    onSwipeLeft: isToday ? undefined : () => setLogDate(addDays(logDate, 1)),
    onSwipeRight: () => setLogDate(addDays(logDate, -1)),
    enabled: !bodyOpen,
  });

  // 「からだ」からは、Androidの戻る操作でも記録へ戻る（切り替えの帯を置かないぶん、戻り道を用意する）。
  useFocusEffect(
    useCallback(() => {
      if (!bodyOpen) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setBodyOpen(false);
        return true;
      });
      return () => subscription.remove();
    }, [bodyOpen]),
  );

  // 所属の家族と、記録した人の名前。どちらも1回取れば足りる。
  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted) return;
        setFamilyId(membership.familyId);
        if (!membership.familyId) return;
        const familyMembers = await listFamilyMembers(supabase, membership.familyId);
        if (isMounted) setMembers(familyMembers);
        // 名前・誕生日は設定タブの「家族」の子（docs/family-app.md §3）。
        const [child, feeding] = await Promise.all([
          getChildMember(supabase, membership.familyId),
          getFeedingSettings(supabase, membership.familyId),
        ]);
        if (isMounted && child) {
          setBabyName(child.displayName);
          // 見出しの月齢と、成長曲線の生後ヶ月を自動で埋めるのに使う。
          setBirthDate(child.birthDate);
        }
        if (isMounted) setIntervalMinutes(feeding.intervalMinutes);
        // 成長記録は日付の送りとは関わらないので、ここで1回だけ読む。
        const id = await ensureChildId(supabase, membership.familyId);
        if (!isMounted) return;
        setChildId(id);
        const records = await listGrowthRecords(supabase, id);
        if (isMounted) setGrowthData(records);
      } catch (error) {
        // 圏外でも端末の控えは出せるようにしたいので、ここでは止めない。
        if (isMounted) setErrorMessage(toMessage(error));
      } finally {
        if (isMounted) {
          setIsLoadingGrowth(false);
          setIsLoadingFamily(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  // 子の誕生日・名前と授乳の間隔は設定タブで変わるので、戻ってきたときに読み直す。
  useRefreshOnFocus(() => {
    if (!familyId) return;
    void Promise.all([getChildMember(supabase, familyId), getFeedingSettings(supabase, familyId)])
      .then(([child, feeding]) => {
        if (child) {
          setBabyName(child.displayName);
          setBirthDate(child.birthDate);
        }
        setIntervalMinutes(feeding.intervalMinutes);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  /** 端末の控えを読んで画面を埋める。サーバーの返事を待たずに出せる分。 */
  const showCached = useCallback(async () => {
    if (!familyId) return;
    try {
      const [cachedLogs, cachedBatches, unsent] = await Promise.all([
        readCachedLogsInRange(familyId, range.from, range.to),
        readCachedPumpedBatches(),
        countUnsentCareLogs(familyId),
      ]);
      setLogs(cachedLogs);
      setPumpedBatches(cachedBatches);
      setUnsentCount(unsent);
      // 圏外でも控えが出れば動かせるので、ここまで来たら読み込み中は解く。
      setIsLoading(false);
    } catch {
      // 控えが読めなくても、このあとサーバーから取り直せば画面は出る。
    }
  }, [familyId, range]);

  /** 積み残しを送ってから取り直す。圏外なら控えのまま黙って続ける。 */
  const sync = useCallback(async () => {
    if (!familyId || !userId) return;
    try {
      const result = await syncCareLogsInRange(
        supabase,
        familyId,
        userId,
        range.from,
        range.to,
      );
      setLogs(result.logs);
      setPumpedBatches(result.pumpedBatches);
      setErrorMessage('');
    } catch (error) {
      // 圏外でもここまでで控えは出ているので、止めずに知らせるだけにする。
      setErrorMessage(
        `最新の記録を取り直せませんでした（${toMessage(error)}）。端末に控えた分を表示しています。`,
      );
    } finally {
      setUnsentCount(await countUnsentCareLogs(familyId).catch(() => 0));
      setIsLoading(false);
    }
  }, [familyId, userId, range]);

  useEffect(() => {
    if (!familyId) return;
    setIsLoading(true);
    void showCached().then(sync).catch(() => setIsLoading(false));
  }, [familyId, showCached, sync]);

  // 常駐通知を出す許可は、記録タブを開いた時点でもらっておく（授乳を始めてからでは遅い）。
  useEffect(() => {
    void requestNursingNotificationPermission();
  }, []);

  /** 平熱に使う直近の体温を読み直す。体温を足したり直したりするたびに呼ぶ。 */
  const refreshRecentTemperatureLogs = useCallback(async () => {
    if (!familyId) return;
    try {
      setRecentTemperatureLogs(await listRecentTemperatureLogs(supabase, familyId));
    } catch {
      // 圏外でも他は出せるので、平熱が出ないだけにとどめる。
    }
  }, [familyId]);

  useEffect(() => {
    void refreshRecentTemperatureLogs();
  }, [refreshRecentTemperatureLogs]);

  /** 「次はどちらから」に使う直近の授乳を読み直す。授乳を足したり直したりするたびに呼ぶ。 */
  const refreshRecentMilkLogs = useCallback(async () => {
    if (!familyId) return;
    try {
      setRecentMilkLogs(await listRecentMilkLogs(supabase, familyId, RECENT_MILK_LIMIT));
    } catch {
      // 圏外でも表示中の日の記録からは出せるので、ここでは止めない。
    }
  }, [familyId]);

  useEffect(() => {
    void refreshRecentMilkLogs();
  }, [refreshRecentMilkLogs]);

  /**
   * 「いま授乳中・記録待ち」を読み直す。
   *
   * 通知をオフにしている端末は印を預けられず、圏外なら読めない。どちらも
   * 「印は無い」として扱えばよいので、失敗しても画面は止めない。
   */
  const refreshNursingStates = useCallback(async () => {
    if (!familyId) return;
    try {
      setNursingStates(await listFamilyNursingState(supabase));
    } catch {
      // 印が読めないだけ。記録から出す「次はどちらから」はそのまま出る。
    }
  }, [familyId]);

  useEffect(() => {
    void refreshNursingStates();
  }, [refreshNursingStates]);

  // 授乳の始まり・終わりはパートナーの端末で起きるので、見ている間は読み直す。
  useRefreshWhileFocused(() => {
    void refreshNursingStates();
  }, NURSING_POLL_MS);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void sync().finally(() => setIsRefreshing(false));
  }, [sync]);

  const memberLabel = useCallback(
    (id: string | null): string => {
      if (!id) return '不明';
      const member = members.find((m) => m.id === id);
      if (member?.name) return member.name;
      return id === userId ? 'あなた' : 'パートナー';
    },
    [members, userId],
  );

  // 日付の表記。今年のうちは年を省き、それ以外の年を見ているときだけ年を付ける（PWA版と同じ）。
  const dateLabel =
    logDate.getFullYear() === today.getFullYear()
      ? formatDateWithWeekday(logDate)
      : `${logDate.getFullYear()}年${formatDateWithWeekday(logDate)}`;

  // 日を切り替えた直後は前の日の記録が残っているため、読み込み中は空として扱う（PWA版と同じ）。
  // 端末の控えは読み込みのうちに入るので、圏外でもここで待たされるのは一瞬で済む。
  const visibleLogs = useMemo(() => (isLoading ? [] : logs), [isLoading, logs]);
  const summary = useMemo(() => summarizeLogs(visibleLogs), [visibleLogs]);
  // 表示中の日の記録と、日付にとらわれない直近の授乳を合わせて渡し、
  // その中でいちばん新しい母乳の記録から決める。
  // （表示中の日の記録は保存した時点で入るので、圏外でも直後から新しい側が出る）
  const recordedNextBreastSide = useMemo<BreastSide | null>(
    () => getNextBreastSide([...logs, ...recentMilkLogs]),
    [logs, recentMilkLogs],
  );
  // 記録に入る前の授乳（家族の端末の計測中・記録待ち）。記録だけを見ていると、
  // パートナーが授乳を終えて保存するまでの間、1つ前の側が出てしまう。
  // 自分の端末で測っている分はここには要らない（計測中のバナーが出る）。
  const familyNursing = useMemo(
    () => (timer.hasSession ? null : activePendingNursing(nursingStates, Date.now())),
    [timer.hasSession, nursingStates],
  );
  // 保存が済んだあと印の消え方が遅れても、記録と食い違わないようにする
  // （ホームの「次の授乳の目安」と同じ決め方。feedingSchedule.ts）。
  const lastMilkAt = useMemo(() => {
    const times = [...logs, ...recentMilkLogs]
      .filter((log) => log.type === 'milk')
      .map((log) => log.time.getTime());
    return times.length > 0 ? new Date(Math.max(...times)) : null;
  }, [logs, recentMilkLogs]);
  const lastFeeding = resolveLastFeeding(lastMilkAt, familyNursing);

  // 見出しの「次の授乳」。記録に入る前の授乳（計測中・記録待ち）も前回の授乳として扱う。
  const nextFeeding: NextFeedingInfo = {
    lastFedAt: lastMilkAt,
    pendingNursing: activePendingNursing(nursingStates, Date.now()),
    intervalMinutes,
    isLoading: isLoadingFamily,
  };
  const babyAge = formatBabyAge(birthDate);

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
  // 体温のボタンにはその子の平熱だけを出す。日ごとの平均や最高は出さず、
  // 測ったときに比べる相手になる基準の1つの数に絞る。
  const temperatureBaseline = useMemo(
    () => getTemperatureBaseline(recentTemperatureLogs),
    [recentTemperatureLogs],
  );
  const temperatureSummaryText = temperatureBaseline
    ? `平熱 ${formatCelsius(temperatureBaseline.celsius)}`
    : 'まだ記録なし';
  // 「からだ」のボタンには、体温の平熱と、いちばん新しい体重を並べて出す。
  // 成長記録は日付の古い順に持っているので、後ろから探す。
  const latestWeightKg = useMemo(
    () => [...growthData].reverse().find((record) => record.weight !== null)?.weight ?? null,
    [growthData],
  );
  // 入力画面に出す「前回の体温」。ボタンの平熱とは別に、直前の1件が要る。
  // 「からだ」から開いたときは日が決まっていないので、日をまたいだ直近の1件にする。
  const latestTemperature = useMemo(
    () => getLatestTemperature(bodyOpen ? recentTemperatureLogs : visibleLogs),
    [bodyOpen, recentTemperatureLogs, visibleLogs],
  );

  const handleSave = async (input: MilkLogInput, existing: MilkLog | null) => {
    if (!familyId || !userId) return;
    setEditing(null);
    try {
      if (existing) {
        // 種類を切り替えた場合に古い項目が残らないよう、入力内容で作り直す。
        await queueUpdateCareLog(familyId, {
          type: 'milk',
          ...input,
          id: existing.id,
          createdBy: existing.createdBy,
        });
      } else {
        await queueInsertCareLog(familyId, userId, { type: 'milk', ...input });
        // 記録できた分の計測はもう不要なので片付ける（前面サービスもここで止まる）。
        timer.reset();
      }
      await showCached();
      await sync();
      await refreshRecentMilkLogs();
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  };

  // --- 成長記録 ---

  const addGrowthRecord = async (draft: GrowthRecordDraft) => {
    if (!familyId) return;
    try {
      const id = childId ?? (await ensureChildId(supabase, familyId));
      if (!childId) setChildId(id);
      const created = await insertGrowthRecord(supabase, id, {
        monthAge: draft.monthAge,
        height: draft.height,
        weight: draft.weight,
        recordedDate: draft.recordedDate,
      });
      setGrowthData((prev) =>
        [...prev, created].sort((a, b) => a.recordedDate.localeCompare(b.recordedDate)),
      );
    } catch (error) {
      setErrorMessage(`成長記録を追加できませんでした（${toMessage(error)}）。`);
    }
  };

  const saveGrowthRecord = async (record: GrowthRecord, draft: GrowthRecordDraft) => {
    const updated: GrowthRecord = {
      ...record,
      month: draft.monthAge,
      height: draft.height,
      weight: draft.weight,
      recordedDate: draft.recordedDate,
    };
    const previous = growthData;
    setGrowthData((prev) =>
      prev
        .map((r) => (r.id === record.id ? updated : r))
        .sort((a, b) => a.recordedDate.localeCompare(b.recordedDate)),
    );
    try {
      await updateGrowthRecord(supabase, updated);
    } catch (error) {
      // 失敗したまま新しい値を出し続けると、保存できたと誤解されるため元に戻す。
      setGrowthData(previous);
      setErrorMessage(`成長記録を保存できませんでした（${toMessage(error)}）。`);
    }
  };

  const removeGrowthRecord = async (id: string) => {
    const previous = growthData;
    setGrowthData((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteGrowthRecord(supabase, id);
    } catch (error) {
      setGrowthData(previous);
      setErrorMessage(`成長記録を削除できませんでした（${toMessage(error)}）。`);
    }
  };

  const handleSavePumping = async (input: PumpingLogInput, existing: PumpingLog | null) => {
    if (!familyId || !userId) return;
    setEditingPumping(null);
    try {
      if (existing) {
        await queueUpdateCareLog(familyId, {
          type: 'pumping',
          ...input,
          id: existing.id,
          createdBy: existing.createdBy,
        });
      } else {
        await queueInsertCareLog(familyId, userId, { type: 'pumping', ...input });
      }
      await showCached();
      await sync();
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  };

  /**
   * 授乳の入力画面から、パックを丸ごと捨てる / 取り消す。
   *
   * 相手は表示中の日の記録とは限らない（ストックは日をまたいでたまる）ので、
   * 手元の一覧からは探さず、idを指してその場で書き換える。
   * Web版と同じく、ここだけは端末に控えず直接送る。
   */
  const handleDiscardBatch = async (id: string, discarded: boolean) => {
    // 画面には先に反映し、失敗したら取り直して元に戻す。
    const discardedAt = discarded ? new Date() : null;
    setPumpedBatches((prev) =>
      prev.map((batch) => (batch.id === id ? { ...batch, discardedAt } : batch)),
    );
    try {
      await setPumpedBatchDiscarded(supabase, id, discardedAt);
      await showCached();
      await sync();
    } catch (error) {
      setErrorMessage(toMessage(error));
      await sync();
    }
  };

  const handleSaveDiaper = async (input: DiaperLogInput, existing: DiaperLog | null) => {
    if (!familyId || !userId) return;
    setEditingDiaper(null);
    try {
      if (existing) {
        await queueUpdateCareLog(familyId, {
          type: 'diaper',
          ...input,
          id: existing.id,
          createdBy: existing.createdBy,
        });
      } else {
        await queueInsertCareLog(familyId, userId, { type: 'diaper', ...input });
      }
      await showCached();
      await sync();
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  };

  const handleSaveTemperature = async (
    input: TemperatureLogInput,
    existing: TemperatureLog | null,
  ) => {
    if (!familyId || !userId) return;
    setEditingTemperature(null);
    try {
      if (existing) {
        await queueUpdateCareLog(familyId, {
          type: 'temperature',
          ...input,
          id: existing.id,
          createdBy: existing.createdBy,
        });
      } else {
        await queueInsertCareLog(familyId, userId, { type: 'temperature', ...input });
      }
      await showCached();
      await sync();
      await refreshRecentTemperatureLogs();
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  };

  const handleDelete = async (log: CareLog) => {
    if (!familyId) return;
    setEditing(null);
    setEditingPumping(null);
    setEditingDiaper(null);
    setEditingTemperature(null);
    try {
      await queueDeleteCareLog(familyId, log.id);
      await showCached();
      await sync();
      if (log.type === 'milk') await refreshRecentMilkLogs();
      if (log.type === 'temperature') await refreshRecentTemperatureLogs();
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  };

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.screen} {...swipe.handlers}>
      {!bodyOpen && (
        <>
      {/* グループ1: 生後日数と次の授乳の目安を琥珀色の1枚に。固定し、スクロールは下のパネルの中だけにする。 */}
      <View style={styles.careHeader}>
        <NextFeedingCard
          info={nextFeeding}
          babyAge={babyAge}
          onOpen={() => setEditing({ log: null })}
        />
      </View>
        </>
      )}

      {bodyOpen ? (
        <BodyPanel
          temperatureLogs={recentTemperatureLogs}
          growthData={growthData}
          growthChartData={growthChartData}
          isLoadingGrowth={isLoadingGrowth}
          memberLabel={memberLabel}
          onBack={() => setBodyOpen(false)}
          onAddTemperature={() => setEditingTemperature({ log: null })}
          onEditTemperature={(log) => setEditingTemperature({ log })}
          onAddGrowth={() => setGrowthModal({ mode: 'add', record: null })}
          onEditGrowth={(record) => setGrowthModal({ mode: 'edit', record })}
        />
      ) : (
      <>
      {/* グループ2: 日付・記録ボタン・その日の記録を、スレート色の1枚のパネルにまとめる。 */}
      <Animated.View style={[styles.dayPanel, swipe.style]}>
      {/* 日付送り。タブを開いた時点では常に今日なので、「今日」は今日以外を見ているときだけ出す。 */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="前の日"
          onPress={() => setLogDate(addDays(logDate, -1))}
          style={styles.arrow}
        >
          <ChevronLeft size={20} color={colors.textSubtle} />
        </Pressable>

        <View style={styles.dateGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="日付を選ぶ"
            onPress={() =>
              DateTimePickerAndroid.open({
                value: logDate,
                mode: 'date',
                maximumDate: today,
                onChange: (_event, picked) => picked && setLogDate(startOfDay(picked)),
              })
            }
            hitSlop={8}
            style={styles.dateButton}
          >
            <Text style={styles.date}>{dateLabel}</Text>
          </Pressable>
          {/* 端末の日付ピッカーで任意の日へ飛べることを示す印。PWA版と同じ位置。 */}
          <CalendarDays size={16} color={colors.textFaint} />

          {!isToday && (
            // 「今日」だけだと、表示中の日付のラベルに見えて紛らわしいので、戻る操作だと分かる文言にする。
            <Pressable accessibilityRole="button" onPress={() => setLogDate(today)} style={styles.todayButton}>
              <Undo2 size={12} color={colors.navActiveText} />
              <Text style={styles.todayText}>今日へ戻る</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="次の日"
          disabled={isToday}
          onPress={() => setLogDate(addDays(logDate, 1))}
          style={[styles.arrow, isToday && styles.arrowDisabled]}
        >
          <ChevronRight size={20} color={colors.textSubtle} />
        </Pressable>
      </View>

      {!familyId ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            {isLoadingFamily
              ? '読み込み中...'
              : 'まだ家族に属していません。PWA版で家族の登録を済ませてから開いてください。'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.fixed}>
            {/* 計測中の授乳。アプリを開いた人が最初に気づけるよう一番上に出す。 */}
            {timer.hasSession && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing({ log: null })}
                style={styles.nursingBanner}
              >
                <View style={styles.flex}>
                  <Text style={styles.nursingTitle}>
                    {timer.runningPhase === 'burp'
                      ? 'ゲップの時間を計測中'
                      : timer.runningPhase
                        ? `授乳中（${getSideLabel(timer.runningPhase)}）`
                        : '授乳の計測中'}
                  </Text>
                  {/* 出すのは記録に入る合計。何セット目かは、続きから測るときの目印になる。 */}
                  <Text style={styles.nursingTime}>
                    {timer.setNumber}セット目・左 {formatStopwatch(timer.total.left)} / 右{' '}
                    {formatStopwatch(timer.total.right)}
                  </Text>
                </View>
                <Text style={styles.nursingOpen}>開く</Text>
              </Pressable>
            )}

            {/* 記録ボタン。その日のようすを同じボタンに載せ、「見る」と「記録する」を1つに
                まとめている。授乳・おむつ・からだの3つ。搾乳は授乳の中（入力画面の「搾った」）へ
                寄せたので、ここには出さない。 */}
            <View style={styles.recordRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing({ log: null })}
                style={styles.recordButton}
              >
                <Plus size={12} color={colors.borderStrong} style={styles.recordPlus} />
                <View style={styles.recordTitleRow}>
                  <BabyBottleIcon size={17} color={colors.milk} />
                  <Text style={styles.recordTitle}>授乳</Text>
                </View>
                {/* 量・分数は出さず、その日の回数だけを出す（おむつと同じ並び）。 */}
                <Text style={styles.recordValue}>計{summary.milk.count}回</Text>
                {nursingBy && (
                  <Text style={styles.recordHint}>{memberLabel(nursingBy)}が授乳中</Text>
                )}
                {!nursingBy && nextBreastSide && !timer.hasSession && (
                  <Text style={styles.recordHint}>次は{getSideLabel(nextBreastSide)}から</Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => setEditingDiaper({ log: null })}
                style={styles.recordButton}
              >
                <Plus size={12} color={colors.borderStrong} style={styles.recordPlus} />
                <View style={styles.recordTitleRow}>
                  <Droplet size={17} color={colors.diaper} />
                  <Text style={styles.recordTitle}>おむつ</Text>
                </View>
                {/* おしっことうんちは見たいことが別（水分が足りているか／お通じ）なので、
                    合わせた回数ではなくそれぞれの回数を出す。「両方」の記録は両方に数える。 */}
                <Text style={styles.recordValue}>おしっこ {summary.diaper.peeCount}回</Text>
                <Text style={styles.recordValue}>うんち {summary.diaper.poopCount}回</Text>
              </Pressable>

              {/* からだ（体温・身長・体重）。押すと、記録と履歴をまとめた画面を開く。
                  体温はその子の平熱だけ、体重はいちばん新しい値だけを出す。 */}
              <Pressable
                accessibilityRole="button"
                onPress={() => setBodyOpen(true)}
                style={styles.recordButton}
              >
                <ChevronRight size={12} color={colors.borderStrong} style={styles.recordPlus} />
                <View style={styles.recordTitleRow}>
                  <Thermometer size={17} color={colors.temperature} />
                  <Text style={styles.recordTitle}>からだ</Text>
                </View>
                <Text style={styles.recordValue}>{temperatureSummaryText}</Text>
                <Text style={styles.recordValue}>
                  {latestWeightKg !== null ? `体重 ${latestWeightKg}kg` : '体重 -'}
                </Text>
              </Pressable>
            </View>

            {!isToday && (
              <Text style={styles.pastDayNote}>
                過去の日を表示中です。記録を追加すると{dateLabel}に登録されます。
              </Text>
            )}

            {unsentCount > 0 && (
              <Text style={styles.unsent}>
                まだ送れていない記録が{unsentCount}件あります。電波が戻れば自動で送られます。
              </Text>
            )}
            {errorMessage !== '' && <Text style={styles.error}>{errorMessage}</Text>}
          </View>

          {/* スクロールするのはこの一覧だけ。 */}
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
            }
          >
            <Text style={styles.listHeading}>
              {dateLabel}の記録 {visibleLogs.length}件
            </Text>
            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={styles.listLoading} />
            ) : visibleLogs.length === 0 ? (
              <Text style={styles.empty}>この日の記録はありません</Text>
            ) : (
              <LogTimeline
                logs={visibleLogs}
                memberLabel={memberLabel}
                onSelect={(log) => {
                  if (log.type === 'milk') setEditing({ log });
                  else if (log.type === 'pumping') setEditingPumping({ log });
                  else if (log.type === 'diaper') setEditingDiaper({ log });
                  else if (log.type === 'temperature') setEditingTemperature({ log });
                }}
              />
            )}
            {!isNursingForegroundServiceAvailable() && (
              <Text style={styles.phaseNote}>
                いまは前面サービスの入っていないビルドで動いているため、
                お知らせはアプリを開いている間の振動だけになります。
              </Text>
            )}
          </ScrollView>
        </>
      )}
      </Animated.View>
      </>
      )}

      <MilkLogModal
        show={editing !== null}
        log={editing?.log ?? null}
        baseDate={logDate}
        nextSide={nextBreastSide}
        timer={timer}
        pumpedBatches={pumpedBatches}
        onDiscardBatch={(id, discarded) => void handleDiscardBatch(id, discarded)}
        initialMethod={milkModalMethod}
        onSwitchToPumping={() => {
          setEditing(null);
          setEditingPumping({ log: null });
        }}
        onClose={() => setEditing(null)}
        onSubmit={(input) => void handleSave(input, editing?.log ?? null)}
        onDelete={() => editing?.log && void handleDelete(editing.log)}
      />

      <PumpingLogModal
        show={editingPumping !== null}
        log={editingPumping?.log ?? null}
        baseDate={logDate}
        pumpedBatches={pumpedBatches}
        onSwitchToFeeding={(method) => {
          // 搾乳の入力画面で選び直した種類のまま、授乳の入力画面へ戻す。
          setMilkModalMethod(method);
          setEditingPumping(null);
          setEditing({ log: null });
        }}
        onClose={() => setEditingPumping(null)}
        onSubmit={(input) => void handleSavePumping(input, editingPumping?.log ?? null)}
        onDelete={() => editingPumping?.log && void handleDelete(editingPumping.log)}
      />

      <DiaperLogModal
        show={editingDiaper !== null}
        log={editingDiaper?.log ?? null}
        baseDate={logDate}
        onClose={() => setEditingDiaper(null)}
        onSubmit={(input) => void handleSaveDiaper(input, editingDiaper?.log ?? null)}
        onDelete={() => editingDiaper?.log && void handleDelete(editingDiaper.log)}
      />

      <GrowthRecordFormModal
        // 対象が変わるたびに作り直して、初期値を計算し直す。
        key={`growth-${growthModal ? `${growthModal.mode}-${growthModal.record?.id ?? 'new'}` : 'none'}`}
        mode={growthModal?.mode ?? null}
        record={growthModal?.record ?? null}
        birthDate={birthDate}
        onClose={() => setGrowthModal(null)}
        onSubmit={(draft) => {
          if (growthModal?.mode === 'edit' && growthModal.record) {
            void saveGrowthRecord(growthModal.record, draft);
          } else {
            void addGrowthRecord(draft);
          }
          setGrowthModal(null);
        }}
        onDelete={(id) => {
          void removeGrowthRecord(id);
          setGrowthModal(null);
        }}
      />

      <TemperatureLogModal
        show={editingTemperature !== null}
        log={editingTemperature?.log ?? null}
        // 「からだ」から足すときは、いま見ている日ではなく今日に登録する。
        baseDate={bodyOpen ? today : logDate}
        previous={latestTemperature}
        baseline={temperatureBaseline}
        babyName={babyName || undefined}
        onClose={() => setEditingTemperature(null)}
        onSubmit={(input) =>
          void handleSaveTemperature(input, editingTemperature?.log ?? null)
        }
        onDelete={() => editingTemperature?.log && void handleDelete(editingTemperature.log)}
      />
    </SafeAreaView>
  );
}

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '読み込みに失敗しました';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centeredText: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },

  // グループ1（生後日数＋次の授乳）。グループ2のパネルと同じ左右の余白・角丸にそろえる。
  careHeader: { paddingHorizontal: 12, paddingTop: 12 },

  // グループ2（日付以下）。画面の地より少し濃いスレート色の1枚にして、上の琥珀色の
  // カードと見分ける。中の白いボタン・カードが浮いて見える。
  dayPanel: {
    flex: 1,
    marginHorizontal: 12,
    marginVertical: 12,
    backgroundColor: colors.listSurface,
    borderRadius: 20,
    overflow: 'hidden',
  },
  // 日付送り。パネルの見出しとして、枠は付けず矢印だけを白い丸にする。
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  arrowDisabled: { opacity: 0.3 },
  dateGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dateButton: { paddingVertical: 4 },
  date: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1, fontVariant: ['tabular-nums'] },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.diaperSurface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  todayText: { fontSize: 12, fontWeight: '700', color: colors.navActiveText },

  fixed: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 8 },
  nursingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.milkSurface,
    borderWidth: 1,
    borderColor: colors.milkBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  nursingTitle: { fontSize: 12, fontWeight: '700', color: colors.milkText },
  nursingTime: { fontSize: 11, color: colors.milk, marginTop: 2, fontWeight: '500', fontVariant: ['tabular-nums'] },
  nursingOpen: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryText,
    backgroundColor: colors.milk,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: 'hidden',
  },

  // 記録ボタン。授乳・おむつ・体温を横に3つ並べる（PWA版と同じ並び）。
  recordRow: { flexDirection: 'row', gap: 8 },
  recordButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  recordPlus: { position: 'absolute', top: 6, right: 6 },
  recordTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recordTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  recordValue: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  recordHint: { fontSize: 10, fontWeight: '700', color: colors.milkText, marginTop: 1 },

  pastDayNote: { fontSize: 11, color: colors.textMuted, lineHeight: 17, fontWeight: '500' },
  unsent: { fontSize: 11, color: colors.milkText, fontWeight: '500' },
  error: { fontSize: 11, color: colors.danger },

  list: { paddingBottom: 16, gap: 4 },
  listHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 16,
  },
  listLoading: { marginTop: 24 },
  empty: { fontSize: 13, color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  phaseNote: { fontSize: 11, color: colors.textFaint, lineHeight: 17, marginTop: 12, paddingHorizontal: 16 },
});
