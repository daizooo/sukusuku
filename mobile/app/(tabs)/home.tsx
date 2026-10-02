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
  Baby,
  Building2,
  Heart,
  Phone,
  Stethoscope,
} from 'lucide-react-native';
import type { LoginRole, Member, MilkLog, UserProfile } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { useRefreshOnFocus, useRefreshWhileFocused } from '@/lib/screenFocus';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { getProfile } from '@/lib/api/profile';
import { getChildMember } from '@/lib/api/members';
import { listRecentMilkLogs } from '@/lib/api/careLogs';
import { getFeedingSettings } from '@/lib/api/feedingSettings';
import { listFamilyNursingState, type FamilyNursingState } from '@/lib/api/nursingAlarms';
import {
  activePendingNursing,
  DEFAULT_FEEDING_INTERVAL_MINUTES,
  type NextFeedingInfo,
} from '@/lib/feedingSchedule';
import { parseDateString } from '@/lib/dateUtils';
import { getProfileFieldValue } from '@/lib/uiUtils';
import NextFeedingCard from '@/components/NextFeedingCard';

// ホームタブ。タブごとの画面なので、出すものはこの画面で読む
// （プロフィール・直近の授乳・授乳の間隔・いま授乳中かどうか）。
// 「直近のスケジュール」は予定タブの月表示の下へ移した。

/**
 * 「いま授乳中・記録待ち」を読み直す間隔。
 *
 * 授乳の始まり・終わりは、こちらが何もしなくても（パートナーの端末で）変わる。
 * カードの残り時間が分単位なので、1分ごとに読めば表示が食い違わない。
 */
const NURSING_POLL_MS = 60_000;

/**
 * いま家族の誰かが授乳中か（記録待ちか）を読む。
 *
 * 通知をオフにしている端末は印を預けられず、圏外なら読めない。どちらも
 * 「印は無い」として扱えばよい（今までどおり記録だけで目安を出す）ので、
 * 失敗しても画面は止めない。
 */
const loadNursingStates = async (): Promise<FamilyNursingState[]> => {
  try {
    return await listFamilyNursingState(supabase);
  } catch {
    return [];
  }
};

export default function HomeScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;
  const router = useRouter();

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [loginRole, setLoginRole] = useState<LoginRole>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // 生後日数を出す子。誕生日・名前は設定タブの「家族」で変える（docs/family-app.md §3）。
  const [child, setChild] = useState<Member | null>(null);
  const [isLoadingFamily, setIsLoadingFamily] = useState(true);
  const [recentMilkLogs, setRecentMilkLogs] = useState<MilkLog[]>([]);
  const [isLoadingRecentMilk, setIsLoadingRecentMilk] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(DEFAULT_FEEDING_INTERVAL_MINUTES);
  const [nursingStates, setNursingStates] = useState<FamilyNursingState[]>([]);

  const today = useMemo(() => new Date(), []);

  /**
   * このタブに出すものを読む。
   *
   * 授乳は記録タブ、子の生年月日と授乳の間隔は設定タブでも変わるので、
   * ホームへ戻ってきたときにも同じものを読み直す（useRefreshOnFocus）。
   */
  const loadFamilyData = useCallback(async (id: string) => {
    const [loadedProfile, loadedChild, loadedMilk, settings, nursing] = await Promise.all([
      getProfile(supabase, id),
      getChildMember(supabase, id),
      listRecentMilkLogs(supabase, id),
      getFeedingSettings(supabase, id),
      loadNursingStates(),
    ]);
    return { loadedProfile, loadedChild, loadedMilk, settings, nursing };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        setLoginRole(membership.role);
        const { loadedProfile, loadedChild, loadedMilk, settings, nursing } =
          await loadFamilyData(membership.familyId);
        if (!isMounted) return;
        setProfile(loadedProfile);
        setChild(loadedChild);
        setRecentMilkLogs(loadedMilk);
        setIntervalMinutes(settings.intervalMinutes);
        setNursingStates(nursing);
      } catch {
        // 圏外でも画面は出す。出せるところまで出して、残りは空のままにする。
      } finally {
        if (isMounted) {
          setIsLoadingFamily(false);
          setIsLoadingRecentMilk(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId, loadFamilyData]);

  // 他のタブで変えた分に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  useRefreshOnFocus(() => {
    if (!familyId) return;
    void loadFamilyData(familyId)
      .then(({ loadedProfile, loadedChild, loadedMilk, settings, nursing }) => {
        setProfile(loadedProfile);
        setChild(loadedChild);
        setRecentMilkLogs(loadedMilk);
        setIntervalMinutes(settings.intervalMinutes);
        setNursingStates(nursing);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  // 授乳中かどうかは、こちらが何もしなくても変わる。ホームを開いたままでも
  // 「いま授乳中」「記録待ち」に追いつけるよう、見ている間だけ短い間隔で読み直す。
  // 読むのは印だけ（授乳中・記録待ちの端末が無ければ0件で返る軽い問い合わせ）。
  useRefreshWhileFocused(() => {
    if (!familyId) return;
    void loadNursingStates().then(setNursingStates);
  }, NURSING_POLL_MS);

  const birthDateValue = child?.birthDate ?? '';
  const babyName = child?.displayName ?? '';

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

  const nextFeeding = useMemo<NextFeedingInfo>(
    () => ({
      lastFedAt: recentMilkLogs[0]?.time ?? null,
      // 母乳は測り終えて保存するまで記録に入らない。その隙間も前回の授乳として扱う。
      pendingNursing: activePendingNursing(nursingStates, Date.now()),
      intervalMinutes,
      isLoading: isLoadingRecentMilk,
    }),
    [recentMilkLogs, nursingStates, intervalMinutes, isLoadingRecentMilk],
  );

  // ママがログイン中(または役割未設定)はパパの連絡先を、パパがログイン中はママの連絡先を出す。
  // 役割はまだこちらで持っていないので、Web版の既定と同じくパパの連絡先を出す。
  // ママがログイン中(または役割未設定)はパパの連絡先を、パパがログイン中はママの連絡先を出す
  // （PWA版 src/components/sukusuku/tabs/HomeTab.tsx と同じ）。
  const showPapaContact = loginRole !== 'papa';
  const quickActions = profile
    ? [
        {
          icon: Phone,
          label: '産院',
          phone: getProfileFieldValue(profile, 'hospitalPhone'),
          surface: colors.quickHospitalSurface,
          tint: colors.quickHospitalIcon,
        },
        {
          icon: Stethoscope,
          label: '小児科',
          phone: getProfileFieldValue(profile, 'pediatricPhone'),
          surface: colors.quickPediatricSurface,
          tint: colors.quickPediatricIcon,
        },
        {
          icon: Building2,
          label: showPapaContact ? 'パパ会社' : 'ママ会社',
          phone: getProfileFieldValue(
            profile,
            showPapaContact ? 'papaCompanyPhone' : 'mamaCompanyPhone',
          ),
          surface: colors.quickCompanySurface,
          tint: colors.quickCompanyIcon,
        },
        {
          icon: Heart,
          label: showPapaContact ? 'パパ連絡' : 'ママ連絡',
          phone: getProfileFieldValue(
            profile,
            showPapaContact ? 'papaContactPhone' : 'mamaContactPhone',
          ),
          surface: colors.quickContactSurface,
          tint: colors.quickContactIcon,
        },
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
              <View
                style={[
                  styles.quickIcon,
                  { backgroundColor: item.surface },
                  !item.phone && styles.quickIconDisabled,
                ]}
              >
                <item.icon size={20} color={item.tint} />
              </View>
              <Text style={[styles.quickLabel, !item.phone && styles.quickLabelDisabled]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {!familyId && !isLoadingFamily && (
          <Text style={styles.notice}>
            まだ家族に属していません。PWA版で家族の登録を済ませてから開いてください。
          </Text>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 16, paddingBottom: 32 },

  hero: { borderRadius: 16, padding: 24, overflow: 'hidden' },
  heroBaby: { position: 'absolute', right: -8, bottom: -8 },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroLabelText: { fontSize: 13, fontWeight: '500', color: colors.primaryText, opacity: 0.9 },
  heroAge: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 8 },
  heroNumber: { fontSize: 56, fontWeight: '700', color: colors.primaryText, fontVariant: ['tabular-nums'] },
  heroNumberSmall: { fontSize: 44, fontWeight: '700', color: colors.primaryText, fontVariant: ['tabular-nums'] },
  heroUnit: { fontSize: 18, fontWeight: '500', color: colors.primaryText },
  heroUnitSmall: { fontSize: 13, fontWeight: '500', color: colors.primaryText },
  heroSub: { fontSize: 13, fontWeight: '500', color: colors.primaryText, opacity: 0.9, marginTop: 2, fontVariant: ['tabular-nums'] },
  heroBirth: {
    alignSelf: 'flex-start',
    marginTop: 14,
    fontSize: 11,
    fontWeight: '500',
    color: colors.primaryText,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
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
    borderRadius: 999,
    padding: 10,
    marginBottom: 6,
  },
  quickIconDisabled: { opacity: 0.6 },
  quickLabel: { fontSize: 11, fontWeight: '500', color: colors.textSubtle },
  quickLabelDisabled: { color: colors.textFaint },

  notice: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
});
