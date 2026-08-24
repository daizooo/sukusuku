import { useCallback, useEffect, useState } from 'react';
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
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { listCareLogsByDate, listRecentMilkLogs } from '@/lib/api/careLogs';
import { getFeedingSettings } from '@/lib/api/feedingSettings';
import { getLogTimeText, getLogTitle, summarizeLogs } from '@/lib/careLogUtils';
import { formatDateWithWeekday, formatTimeString } from '@/lib/dateUtils';
import {
  averageFeedingIntervalMinutes,
  formatMinutesText,
  nextFeedingSchedule,
  type FeedingSchedule,
} from '@/lib/feedingSchedule';
import type { CareLog } from '@/types/app';

// フェーズ0の到達点＝「実機で自分のデータが1つ読める」ことを確かめる画面。
//
// ログイン（端末に保存されたセッション）→ 所属の家族（RLSのfamily_id）→ 記録の取得
// → 移植した計算（次の授乳の目安・その日の合計）まで、土台がひととおり通っているかを
// 1画面で見られるようにしている。タブや記録の追加はフェーズ1以降で作る。

interface HomeData {
  logs: CareLog[];
  schedule: FeedingSchedule | null;
  lastFedTitle: string;
  intervalMinutes: number;
  averageIntervalMinutes: number | null;
}

export default function HomeScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [data, setData] = useState<HomeData | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async () => {
    if (!userId) return;
    setErrorMessage('');
    try {
      const membership = await getMyMembership(supabase, userId);
      setFamilyId(membership.familyId);
      if (!membership.familyId) {
        setData(null);
        return;
      }

      const today = new Date();
      // 記録・設定はどちらも family_id だけで引けるので、待ち時間を重ねない。
      const [logs, recentMilkLogs, settings] = await Promise.all([
        listCareLogsByDate(supabase, membership.familyId, today),
        listRecentMilkLogs(supabase, membership.familyId),
        getFeedingSettings(supabase, membership.familyId),
      ]);

      const lastFed = recentMilkLogs[0] ?? null;
      setData({
        logs,
        schedule: nextFeedingSchedule(
          lastFed?.time ?? null,
          settings.intervalMinutes,
          Date.now(),
        ),
        lastFedTitle: lastFed ? getLogTitle(lastFed) : '',
        intervalMinutes: settings.intervalMinutes,
        averageIntervalMinutes: averageFeedingIntervalMinutes(
          recentMilkLogs.map((log) => log.time),
        ),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '読み込みに失敗しました');
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setIsLoading(true);
    void load().finally(() => setIsLoading(false));
  }, [userId, load]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void load().finally(() => setIsRefreshing(false));
  }, [load]);

  if (isSessionLoading) return <CenteredMessage isLoading />;
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* 見出し・日付は固定し、スクロールは下の一覧だけに閉じる（CLAUDE.md の画面の作り方） */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerDate}>{formatDateWithWeekday(new Date())}</Text>
          <Text style={styles.headerEmail}>{session.user.email}</Text>
        </View>
        <Pressable onPress={() => void supabase.auth.signOut()} hitSlop={8}>
          <Text style={styles.signOut}>ログアウト</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <CenteredMessage isLoading />
      ) : errorMessage !== '' ? (
        <CenteredMessage text={errorMessage} onRetry={handleRefresh} />
      ) : !familyId ? (
        <CenteredMessage text="まだ家族に属していません。Web版で家族の登録を済ませてから開いてください。" />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        >
          <NextFeedingCard data={data} />
          <TodayLogsCard logs={data?.logs ?? []} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function NextFeedingCard({ data }: { data: HomeData | null }) {
  const schedule = data?.schedule ?? null;

  return (
    <View style={[styles.card, styles.accentCard]}>
      <Text style={styles.cardTitle}>次の授乳の目安</Text>
      {!schedule ? (
        <Text style={styles.muted}>まだ授乳の記録がありません</Text>
      ) : (
        <>
          <Text style={styles.dueTime}>{formatTimeString(schedule.dueAt)}</Text>
          <Text style={styles.muted}>
            {schedule.isOverdue
              ? `目安を${formatMinutesText(schedule.overdueMinutes)}過ぎています`
              : `あと${formatMinutesText(schedule.remainingMinutes)}`}
          </Text>
          <Text style={styles.mutedSmall}>
            前回 {formatTimeString(schedule.lastFedAt)}
            {data?.lastFedTitle ? `（${data.lastFedTitle}）` : ''} ／ 設定{' '}
            {formatMinutesText(data?.intervalMinutes ?? 0)}
            {data?.averageIntervalMinutes
              ? ` ／ 最近の平均 ${formatMinutesText(data.averageIntervalMinutes)}`
              : ''}
          </Text>
        </>
      )}
    </View>
  );
}

function TodayLogsCard({ logs }: { logs: CareLog[] }) {
  const summary = summarizeLogs(logs);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>今日の記録</Text>
      <Text style={styles.mutedSmall}>
        ミルク {summary.milk.count}回 ／ おむつ {summary.diaper.count}回 ／ 搾乳{' '}
        {summary.pumping.count}回
      </Text>

      {logs.length === 0 ? (
        <Text style={styles.muted}>今日の記録はまだありません</Text>
      ) : (
        <View style={styles.logList}>
          {logs.map((log) => (
            <View key={log.id} style={styles.logRow}>
              <Text style={styles.logTime}>{getLogTimeText(log)}</Text>
              <Text style={styles.logTitle}>{getLogTitle(log)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function CenteredMessage({
  isLoading,
  text,
  onRetry,
}: {
  isLoading?: boolean;
  text?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.centered}>
      {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {text ? <Text style={styles.centeredText}>{text}</Text> : null}
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.retry}>再読み込み</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerDate: { fontSize: 16, fontWeight: '700', color: colors.text },
  headerEmail: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  signOut: { fontSize: 13, color: colors.textMuted },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
  },
  accentCard: { backgroundColor: colors.accentSurface },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  dueTime: { fontSize: 32, fontWeight: '700', color: colors.primary, marginTop: 2 },
  muted: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  mutedSmall: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  logList: { marginTop: 8, gap: 2 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  logTime: { fontSize: 13, color: colors.textMuted, width: 48 },
  logTitle: { fontSize: 14, color: colors.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centeredText: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  retry: { fontSize: 13, color: colors.primary },
});
