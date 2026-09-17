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
  DiaperLog,
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
import { listRecentTemperatureLogs } from '@/lib/api/careLogs';
import { getProfile } from '@/lib/api/profile';
import { getProfileFieldValue } from '@/lib/uiUtils';
import {
  formatCelsius,
  formatStopwatch,
  getLatestTemperature,
  getNextBreastSide,
  getSideLabel,
  getTemperatureBaseline,
  pumpedStockMl,
  summarizeLogs,
} from '@/lib/careLogUtils';
import {
  addDays,
  formatDateWithWeekday,
  formatTimeString,
  isSameDay,
  startOfDay,
} from '@/lib/dateUtils';
import { useNursingTimer } from '@/lib/nursingTimer';
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
import DiaperLogModal, { type DiaperLogInput } from '@/components/log/DiaperLogModal';
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
  // 平熱に使う直近の体温。その子自身の記録の平均なので、表示中の日だけでは求まらない。
  const [recentTemperatureLogs, setRecentTemperatureLogs] = useState<TemperatureLog[]>([]);
  // プロフィールに登録された子の名前。体温の入力画面で「◯の平熱」と出すのに使う。
  const [babyName, setBabyName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // 開いている入力画面。log が null なら新規追加、入っていればその記録の編集。
  const [editing, setEditing] = useState<{ log: MilkLog | null } | null>(null);
  const [editingDiaper, setEditingDiaper] = useState<{ log: DiaperLog | null } | null>(null);
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
        const profile = await getProfile(supabase, membership.familyId);
        if (isMounted && profile) setBabyName(getProfileFieldValue(profile, 'babyName'));
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
  // 体温のボタンにはその子の平熱だけを出す。日ごとの平均や最高は出さず、
  // 測ったときに比べる相手になる基準の1つの数に絞る。
  const temperatureBaseline = useMemo(
    () => getTemperatureBaseline(recentTemperatureLogs),
    [recentTemperatureLogs],
  );
  const temperatureSummaryText = temperatureBaseline
    ? `平熱 ${formatCelsius(temperatureBaseline.celsius)}`
    : 'まだ記録なし';
  // 入力画面に出す「前回の体温」。ボタンの平熱とは別に、直前の1件が要る。
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
    setEditingDiaper(null);
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
                まとめている。授乳・おむつ・体温の3つ。搾乳は授乳の中（入力画面の「搾った」）へ
                寄せたので、ここには出さず、代わりに授乳のボタンにいまの搾乳ストックを出す。 */}
            <View style={styles.recordRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing({ log: null })}
                style={styles.recordButton}
              >
                <Text style={styles.recordTitle}>授乳</Text>
                {/* その日の回数・量・分数は出さない（判断に使うのは体重とおしっこの回数）。
                    代わりに、次の授乳で使える搾乳ストックの残りを出す。表示中の日だけでは
                    求まらないため、日付の送りとは関わらず常に今の残りになる。 */}
                <Text style={styles.stockValue}>ストック・{pumpedStockMl(pumpedBatches)}ml</Text>
                {nextBreastSide && !timer.hasSession && (
                  <Text style={styles.recordHint}>次は{getSideLabel(nextBreastSide)}から</Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => setEditingDiaper({ log: null })}
                style={styles.recordButton}
              >
                <Text style={styles.recordTitle}>おむつ</Text>
                {/* おしっことうんちは見たいことが別（水分が足りているか／お通じ）なので、
                    合わせた回数ではなくそれぞれの回数を出す。「両方」の記録は両方に数える。 */}
                <Text style={styles.recordValue}>おしっこ {summary.diaper.peeCount}回</Text>
                <Text style={styles.recordValue}>うんち {summary.diaper.poopCount}回</Text>
              </Pressable>

              {/* 体温はその子の平熱だけを出す。日ごとの平均や最高は出さない。 */}
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditingTemperature({ log: null })}
                style={styles.recordButton}
              >
                <Text style={styles.recordTitle}>体温</Text>
                <Text style={styles.recordValue}>{temperatureSummaryText}</Text>
              </Pressable>
            </View>

            {!isToday && (
              <Text style={styles.pastDayNote}>
                過去の日を表示中です。記録を追加すると{formatDateWithWeekday(logDate)}に
                登録されます。
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
                  else if (log.type === 'diaper') setEditingDiaper({ log });
                  else if (log.type === 'temperature') setEditingTemperature({ log });
                }}
              />
            )}
            <Text style={styles.phaseNote}>
              いまは授乳・おむつ・体温をこちらで扱います。搾乳ストックを足すのと、
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

      <DiaperLogModal
        show={editingDiaper !== null}
        log={editingDiaper?.log ?? null}
        baseDate={logDate}
        onClose={() => setEditingDiaper(null)}
        onSubmit={(input) => void handleSaveDiaper(input, editingDiaper?.log ?? null)}
        onDelete={() => editingDiaper?.log && void handleDelete(editingDiaper.log)}
      />

      <TemperatureLogModal
        show={editingTemperature !== null}
        log={editingTemperature?.log ?? null}
        baseDate={logDate}
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
  nursingTime: { fontSize: 11, color: colors.milk, marginTop: 2 },
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
  recordTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  recordValue: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  recordHint: { fontSize: 10, fontWeight: '700', color: colors.milkText, marginTop: 1 },
  stockValue: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.pumpingText,
    marginTop: 2,
    textAlign: 'center',
  },

  pastDayNote: { fontSize: 11, color: colors.textMuted, lineHeight: 17 },
  unsent: { fontSize: 11, color: colors.milkText },
  error: { fontSize: 11, color: colors.danger },

  list: { paddingHorizontal: 12, paddingBottom: 24, gap: 8 },
  listHeading: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  listLoading: { marginTop: 24 },
  empty: { fontSize: 13, color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  phaseNote: { fontSize: 11, color: colors.textFaint, lineHeight: 17, marginTop: 12 },
});
