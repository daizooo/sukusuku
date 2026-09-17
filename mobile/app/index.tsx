import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type {
  BreastSide,
  CareLog,
  FamilyMember,
  MilkLog,
  PumpedBatch,
  TemperatureLog,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import {
  formatCelsius,
  formatStopwatch,
  getLatestTemperature,
  getNextBreastSide,
  getNursingPhaseLabel,
  getSideLabel,
  isFever,
  pumpedStockMl,
  stockPumpedBatches,
  summarizeLogs,
} from '@/lib/careLogUtils';
import {
  addDays,
  formatDateWithWeekday,
  formatTimeString,
  isSameDay,
  startOfDay,
} from '@/lib/dateUtils';
import { nursingMinutes, useNursingTimer } from '@/lib/nursingTimer';
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
import LogTimeline from '@/components/log/LogTimeline';
import MilkLogModal, { type MilkLogInput } from '@/components/log/MilkLogModal';
import TemperatureLogModal, {
  type TemperatureLogInput,
} from '@/components/log/TemperatureLogModal';

// 記録タブ（フェーズ1）。授乳まわりと体温をネイティブで回せるようにしたもの。
// おむつ・搾乳の入力と他のタブはフェーズ2で作るので、それまでは凍結したPWA版で見る
// （docs/native-app-rewrite.md §7）。
//
// 体温は PWA版（src/）にも同じものが入っている（docs/what-to-record.md §4-1・§8）。
//
// 画面の作り方はルートの CLAUDE.md に従い、日付送りと記録ボタンは固定して、
// スクロールはその日の一覧だけに閉じる。

export default function LogScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const timer = useNursingTimer();

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [logDate, setLogDate] = useState(() => startOfDay(new Date()));
  const [logs, setLogs] = useState<CareLog[]>([]);
  const [pumpedBatches, setPumpedBatches] = useState<PumpedBatch[]>([]);
  const [unsentCount, setUnsentCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // 開いている入力画面。log が null なら新規追加、入っていればその記録の編集。
  const [editing, setEditing] = useState<{ log: MilkLog | null } | null>(null);
  const [editingTemperature, setEditingTemperature] = useState<{
    log: TemperatureLog | null;
  } | null>(null);

  const today = startOfDay(new Date());
  const isToday = isSameDay(logDate, today);
  // 表示している日の範囲。描画のたびに作り直すと読み込みが止まらなくなるので、日が変わったときだけ。
  const range = useMemo(() => ({ from: logDate, to: addDays(logDate, 1) }), [logDate]);

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
      } catch (error) {
        // 圏外でも端末の控えは出せるようにしたいので、ここでは止めない。
        if (isMounted) setErrorMessage(toMessage(error));
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

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

  const summary = useMemo(() => summarizeLogs(logs), [logs]);
  const nextBreastSide = useMemo<BreastSide | null>(() => getNextBreastSide(logs), [logs]);
  // 表示中の日でいちばん新しい体温。ボタンに出すのと、次に測るときの初期値に使う。
  const latestTemperature = useMemo(() => getLatestTemperature(logs), [logs]);

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
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  };

  const handleDelete = async (log: CareLog) => {
    if (!familyId) return;
    setEditing(null);
    setEditingTemperature(null);
    try {
      await queueDeleteCareLog(familyId, log.id);
      await showCached();
      await sync();
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
    <SafeAreaView style={styles.screen}>
      {/* 日付送り。タブを開いた時点では常に今日なので、「今日」は今日以外を見ているときだけ出す。 */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="前の日"
          onPress={() => setLogDate(addDays(logDate, -1))}
          hitSlop={8}
          style={styles.arrow}
        >
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>

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
          style={styles.dateButton}
        >
          <Text style={styles.date}>{formatDateWithWeekday(logDate)}</Text>
        </Pressable>

        {!isToday && (
          <Pressable accessibilityRole="button" onPress={() => setLogDate(today)} hitSlop={8}>
            <Text style={styles.todayButton}>今日</Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="次の日"
          disabled={isToday}
          onPress={() => setLogDate(addDays(logDate, 1))}
          hitSlop={8}
          style={[styles.arrow, isToday && styles.arrowDisabled]}
        >
          <Text style={styles.arrowText}>›</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => void supabase.auth.signOut()}
          hitSlop={8}
        >
          <Text style={styles.signOut}>ログアウト</Text>
        </Pressable>
      </View>

      {!familyId ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            {isLoading
              ? '読み込み中...'
              : 'まだ家族に属していません。PWA版で家族の登録を済ませてから開いてください。'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.fixed}>
            {/* 計測中の授乳。開いた人が最初に気づけるよう一番上に出す。 */}
            {timer.hasSession && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing({ log: null })}
                style={styles.nursingBanner}
              >
                <View style={styles.flex}>
                  {/* 止まっているときは、測り終えて記録がまだなのか、途中で止めたのかを
                      区別しない。どちらも「開いて記録する」ことに変わりがないため。 */}
                  <Text style={styles.nursingTitle}>
                    {timer.runningPhase
                      ? `授乳中（${getNursingPhaseLabel(timer.runningPhase)}）・${timer.setNumber}セット目`
                      : '授乳の記録がまだです'}
                  </Text>
                  {timer.runningPhase && (
                    <Text style={styles.nursingTime}>
                      {getNursingPhaseLabel(timer.runningPhase)}{' '}
                      {formatStopwatch(timer.elapsed[timer.runningPhase])}
                    </Text>
                  )}
                  {/* 一覧に並ぶ記録と同じ単位（分）で、いま保存したらどうなるかを出す。 */}
                  <Text style={styles.nursingTotal}>
                    記録は 左{nursingMinutes(timer.total.left)}分・右
                    {nursingMinutes(timer.total.right)}分
                  </Text>
                </View>
                <Text style={styles.nursingOpen}>開く</Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => setEditing({ log: null })}
              style={styles.recordButton}
            >
              <Text style={styles.recordButtonTitle}>授乳・ミルクを記録</Text>
              <Text style={styles.recordButtonSummary}>
                {timer.hasSession ? '計測中' : milkSummaryText(summary)}
              </Text>
              {nextBreastSide && !timer.hasSession && (
                <Text style={styles.recordButtonHint}>
                  次は{getSideLabel(nextBreastSide)}から
                </Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setEditingTemperature({ log: null })}
              style={styles.temperatureRow}
            >
              <Text style={styles.temperatureLabel}>体温を記録</Text>
              <Text
                style={[
                  styles.temperatureValue,
                  latestTemperature && isFever(latestTemperature.celsius) && styles.temperatureFever,
                ]}
              >
                {temperatureSummaryText(latestTemperature, summary)}
              </Text>
            </Pressable>

            <View style={styles.stockRow}>
              <Text style={styles.stockLabel}>搾乳ストック</Text>
              <Text style={styles.stockValue}>
                {stockPumpedBatches(pumpedBatches).length}パック・
                {pumpedStockMl(pumpedBatches)}ml
              </Text>
            </View>

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
              {formatDateWithWeekday(logDate)}の記録 {logs.length}件
            </Text>
            {isLoading && logs.length === 0 ? (
              <ActivityIndicator color={colors.primary} style={styles.listLoading} />
            ) : logs.length === 0 ? (
              <Text style={styles.empty}>この日の記録はありません</Text>
            ) : (
              <LogTimeline
                logs={logs}
                memberLabel={memberLabel}
                onSelect={(log) => {
                  if (log.type === 'milk') setEditing({ log });
                  else if (log.type === 'temperature') setEditingTemperature({ log });
                }}
              />
            )}
            <Text style={styles.phaseNote}>
              フェーズ1では授乳まわりと体温をこちらで扱います。おむつ・搾乳の記録と、
              ホーム / 予定 / メモ / 情報 の各タブはPWA版で見てください。
              {!isNursingForegroundServiceAvailable() &&
                '\nいまは前面サービスの入っていないビルドで動いているため、' +
                  'お知らせはアプリを開いている間の振動だけになります。'}
            </Text>
          </ScrollView>
        </>
      )}

      <MilkLogModal
        show={editing !== null}
        log={editing?.log ?? null}
        baseDate={logDate}
        nextSide={nextBreastSide}
        timer={timer}
        pumpedBatches={pumpedBatches}
        onClose={() => setEditing(null)}
        onSubmit={(input) => void handleSave(input, editing?.log ?? null)}
        onDelete={() => editing?.log && void handleDelete(editing.log)}
      />

      <TemperatureLogModal
        show={editingTemperature !== null}
        log={editingTemperature?.log ?? null}
        baseDate={logDate}
        previous={latestTemperature}
        onClose={() => setEditingTemperature(null)}
        onSubmit={(input) =>
          void handleSaveTemperature(input, editingTemperature?.log ?? null)
        }
        onDelete={() => editingTemperature?.log && void handleDelete(editingTemperature.log)}
      />
    </SafeAreaView>
  );
}

/** 記録ボタンに出すその日の合計。回数を主、量・時間を従にして1行に収める。 */
const milkSummaryText = (summary: ReturnType<typeof summarizeLogs>): string =>
  [
    `${summary.milk.count}回`,
    ...(summary.milk.ml > 0 ? [`${summary.milk.ml}ml`] : []),
    ...(summary.milk.breastMinutes > 0 ? [`${summary.milk.breastMinutes}分`] : []),
  ].join('・');

/** 体温の行に出すその日のようす。最新の値を主、回数と最高体温を従にする。 */
const temperatureSummaryText = (
  latest: TemperatureLog | null,
  summary: ReturnType<typeof summarizeLogs>,
): string => {
  if (!latest) return 'この日はまだ';
  const max = summary.temperature.maxCelsius;
  return [
    formatCelsius(latest.celsius),
    `${summary.temperature.count}回`,
    // 熱が下がったあとでも、その日いちばん高かったところが分かるようにする。
    ...(max !== null && max > latest.celsius ? [`最高 ${formatCelsius(max)}`] : []),
  ].join('・');
};

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '読み込みに失敗しました';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centeredText: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  arrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  arrowDisabled: { opacity: 0.3 },
  arrowText: { fontSize: 24, color: colors.textMuted, lineHeight: 26 },
  dateButton: { paddingVertical: 4 },
  date: { fontSize: 15, fontWeight: '700', color: colors.text },
  todayButton: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.diaperText,
    backgroundColor: colors.diaperSurface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  signOut: { marginLeft: 'auto', fontSize: 12, color: colors.textMuted },

  fixed: { padding: 12, gap: 8 },
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
  nursingTime: { fontSize: 12, color: colors.milk, marginTop: 2 },
  nursingTotal: { fontSize: 11, color: colors.milkText, marginTop: 1 },
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
  recordButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  recordButtonTitle: { fontSize: 15, fontWeight: '700', color: colors.milk },
  recordButtonSummary: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  recordButtonHint: { fontSize: 11, fontWeight: '700', color: colors.milkText, marginTop: 2 },
  temperatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.temperatureSurface,
    borderWidth: 1,
    borderColor: colors.temperatureBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  temperatureLabel: { fontSize: 12, fontWeight: '700', color: colors.temperatureText },
  temperatureValue: { fontSize: 13, fontWeight: '700', color: colors.temperatureText },
  temperatureFever: { color: colors.alertText },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.pumpingSurface,
    borderWidth: 1,
    borderColor: colors.pumpingBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  stockLabel: { fontSize: 12, fontWeight: '700', color: colors.pumpingText },
  stockValue: { fontSize: 13, fontWeight: '700', color: colors.pumpingText },
  unsent: { fontSize: 11, color: colors.milkText },
  error: { fontSize: 11, color: colors.danger },

  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 8 },
  listHeading: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  listLoading: { marginTop: 24 },
  empty: { fontSize: 13, color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  phaseNote: { fontSize: 11, color: colors.textFaint, lineHeight: 17, marginTop: 12 },
});
