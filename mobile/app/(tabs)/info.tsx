import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Baby, Edit2, ListPlus, Phone, Save, User } from 'lucide-react-native';
import type { ProfileField, UserProfile } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { getProfile, saveProfile } from '@/lib/api/profile';
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
import FieldSection from '@/components/info/FieldSection';
import NotificationSetting from '@/components/info/NotificationSetting';
import FeedingIntervalSetting from '@/components/info/FeedingIntervalSetting';
import TemperatureReminderSetting from '@/components/info/TemperatureReminderSetting';
import AccountSection from '@/components/info/AccountSection';

// 設定タブ。Web版の `src/components/sukusuku/tabs/InfoTab.tsx` を
// React Nativeに置き換えたもの。出す項目・並び・文言は同じにしてある。
//
// 「通知」の枠も同じ位置・同じ文言で、この端末で受け取るかどうかを切り替える。
// 受け取り方だけがWeb Push購読からFCMの登録トークンへ変わっている
// （src/components/info/NotificationSetting.tsx）。
//
// 設定タブは画面全体がスクロールしてよい（ルートの CLAUDE.md の「画面の作り方」の例外）。

const EMPTY_PROFILE: UserProfile = {
  childFields: [],
  familyFields: [],
  emergencyFields: [],
  customFields: [],
};

// UserProfileのうち、ProfileField[]を値に持つキー（＝設定タブで編集可能なセクション）
type ProfileSectionKey = {
  [K in keyof UserProfile]: UserProfile[K] extends ProfileField[] ? K : never;
}[keyof UserProfile];

/**
 * 新しい見出しのid。Web版は `crypto.randomUUID()` を使うが、React Nativeには無い。
 * 使い道は「同じプロフィールの中で他の見出しと重ならないこと」だけなので、
 * 時刻と乱数を並べたもので足りる。
 */
const newFieldId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function InfoScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [tempProfile, setTempProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [feedingSettings, setFeedingSettings] = useState<FeedingSettings>(DEFAULT_FEEDING_SETTINGS);
  const [temperatureReminderSettings, setTemperatureReminderSettings] =
    useState<TemperatureReminderSettings>(DEFAULT_TEMPERATURE_REMINDER_SETTINGS);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const [profile, feeding, temperature] = await Promise.all([
          getProfile(supabase, membership.familyId),
          getFeedingSettings(supabase, membership.familyId),
          getTemperatureReminderSettings(supabase, membership.familyId),
        ]);
        if (!isMounted) return;
        setUserProfile(profile ?? EMPTY_PROFILE);
        setFeedingSettings(feeding);
        setTemperatureReminderSettings(temperature);
      } catch {
        // 圏外でも画面は出す。出せるところまで出して、残りは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const updateField = (
    section: ProfileSectionKey,
    id: string,
    patch: Partial<Pick<ProfileField, 'label' | 'values'>>,
  ) => {
    setTempProfile((prev) => ({
      ...prev,
      [section]: prev[section].map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }));
  };

  const addField = (section: ProfileSectionKey) => {
    setTempProfile((prev) => ({
      ...prev,
      [section]: [...prev[section], { id: newFieldId(), label: '', values: [''] }],
    }));
  };

  const removeField = (section: ProfileSectionKey, id: string) => {
    setTempProfile((prev) => ({
      ...prev,
      [section]: prev[section].filter((field) => field.id !== id),
    }));
  };

  const startEditProfile = () => {
    setTempProfile(userProfile);
    setIsEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    if (!familyId) return;
    const previousProfile = userProfile;
    const updated = tempProfile;

    setUserProfile(updated);
    setIsEditingProfile(false);

    try {
      await saveProfile(supabase, familyId, updated);
    } catch {
      // 失敗時はロールバック
      setUserProfile(previousProfile);
      Alert.alert('保存できませんでした', 'もう一度お試しください。');
    }
  };

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  const shown = isEditingProfile ? tempProfile : userProfile;

  const sections: { title: string; icon: React.ReactNode; key: ProfileSectionKey }[] = [
    { title: 'お子様の情報', icon: <Baby size={18} color={colors.navActive} />, key: 'childFields' },
    { title: 'パパ・ママ情報', icon: <User size={18} color={colors.navActive} />, key: 'familyFields' },
    { title: '緊急連絡先', icon: <Phone size={18} color={colors.navActive} />, key: 'emergencyFields' },
    { title: 'カスタム項目', icon: <ListPlus size={18} color={colors.navActive} />, key: 'customFields' },
  ];

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 見出しは出さず、編集・保存だけを右端に置く。 */}
        <View style={styles.topBar}>
          {!isEditingProfile ? (
            <Pressable accessibilityRole="button" onPress={startEditProfile} style={styles.editButton}>
              <Edit2 size={16} color={colors.navActiveText} />
              <Text style={styles.editText}>編集</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleSaveProfile()}
              style={styles.saveButton}
            >
              <Save size={16} color={colors.primaryText} />
              <Text style={styles.saveText}>保存</Text>
            </Pressable>
          )}
        </View>

        {isLoading && <Text style={styles.message}>読み込み中...</Text>}

        {sections.map(({ title, icon, key }) => (
          <FieldSection
            key={key}
            title={title}
            icon={icon}
            fields={shown[key]}
            isEditing={isEditingProfile}
            onChangeField={(id, patch) => updateField(key, id, patch)}
            onRemoveField={(id) => removeField(key, id)}
            onAddField={() => addField(key)}
          />
        ))}

        {familyId && (
          <>
            <NotificationSetting familyId={familyId} userId={session.user.id} />

            <FeedingIntervalSetting
              familyId={familyId}
              settings={feedingSettings}
              onChange={setFeedingSettings}
            />

            <TemperatureReminderSetting
              familyId={familyId}
              settings={temperatureReminderSettings}
              onChange={setTemperatureReminderSettings}
            />

            <AccountSection familyId={familyId} userId={session.user.id} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 24, paddingBottom: 32 },
  message: { fontSize: 14, color: colors.textFaint, textAlign: 'center' },

  topBar: { flexDirection: 'row', justifyContent: 'flex-end' },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.diaperSurface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editText: { fontSize: 14, fontWeight: '700', color: colors.navActiveText },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.navActive,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  saveText: { fontSize: 14, fontWeight: '700', color: colors.primaryText },
});
