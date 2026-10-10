import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { LogOut, UserCog } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { listMembers } from '@/lib/api/members';
import {
  getMyStartTab,
  START_TAB_LABEL,
  START_TABS,
  updateMyStartTab,
  type StartTab,
} from '@/lib/api/me';
import { colors } from '@/lib/theme';

// 設定タブのアカウント情報カード。Web版は `src/components/sukusuku/AccountSection.tsx`。
//
// お名前は「家族」の自分の行の名（フルネームの名前部分）をそのまま出す。
// 名前を直すのは「家族」の編集画面だけにして、アカウントと家族の情報を一致させる
// （docs/family-app.md §4.3）。役割・パートナーの表示は持たない。

interface AccountSectionProps {
  familyId: string;
  userId: string;
}

export default function AccountSection({ familyId, userId }: AccountSectionProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  // アプリを開いたときに最初に出すタブ（1人ずつ。docs/family-app.md §3.4）。
  const [startTab, setStartTab] = useState<StartTab>('schedule');
  const [saveError, setSaveError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);
  // 再読み込みボタン用。値を変えることでeffectを再実行する。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.auth.getUser(),
      listMembers(supabase, familyId),
      getMyStartTab(supabase, userId),
    ])
      .then(([{ data: authData }, members, tab]) => {
        if (cancelled) return;
        setStartTab(tab);
        const me = members.find((member) => member.userId === userId);
        setEmail(authData.user?.email ?? '');
        setName(me ? me.givenName || me.displayName : '');
        setLoadError('');
      })
      .catch(() => {
        if (!cancelled) setLoadError('アカウント情報の読み込みに失敗しました。');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [familyId, userId, reloadKey]);

  const handleRetry = () => {
    setIsLoading(true);
    setLoadError('');
    setReloadKey((key) => key + 1);
  };

  const changeStartTab = async (tab: StartTab) => {
    const previous = startTab;
    setStartTab(tab);
    setSaveError('');
    try {
      await updateMyStartTab(supabase, userId, tab);
    } catch {
      setStartTab(previous);
      setSaveError('保存できませんでした。もう一度お試しください。');
    }
  };

  const handleSignOut = () => {
    Alert.alert('ログアウトしますか？', undefined, [
      { text: 'やめる', style: 'cancel' },
      {
        text: 'ログアウト',
        style: 'destructive',
        onPress: () => {
          setIsSigningOut(true);
          void supabase.auth.signOut().catch(() => setIsSigningOut(false));
        },
      },
    ]);
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <UserCog size={18} color={colors.navActive} />
          <Text style={styles.sectionTitle}>アカウント</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.navActive} />
        </View>
      ) : loadError ? (
        <View style={styles.gap12}>
          <Text style={styles.errorBox}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={handleRetry} style={styles.retry}>
            <Text style={styles.retryText}>再読み込み</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.gap16}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>お名前</Text>
            <Text style={styles.rowValue}>{name || '未設定'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>メールアドレス</Text>
            <Text style={styles.rowValueSmall}>{email || '未取得'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>最初に開くタブ</Text>
            <View style={styles.tabOptions}>
              {START_TABS.map((tab) => {
                const selected = startTab === tab;
                return (
                  <Pressable
                    key={tab}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => void changeStartTab(tab)}
                    style={[styles.tabOption, selected && styles.tabOptionSelected]}
                  >
                    <Text style={[styles.tabOptionText, selected && styles.tabOptionTextSelected]}>
                      {START_TAB_LABEL[tab]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {saveError !== '' && <Text style={styles.errorBox}>{saveError}</Text>}

          <Pressable
            accessibilityRole="button"
            disabled={isSigningOut}
            onPress={handleSignOut}
            style={[styles.signOut, isSigningOut && styles.disabled]}
          >
            {isSigningOut ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <LogOut size={14} color={colors.textMuted} />
            )}
            <Text style={styles.signOutText}>ログアウト</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 6,
    marginBottom: 10,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  disabled: { opacity: 0.5 },

  loading: { alignItems: 'center', paddingVertical: 24 },
  gap12: { gap: 8 },
  gap16: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 3,
  },
  rowLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  rowValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowValueSmall: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'right' },


  errorBox: {
    fontSize: 12,
    color: colors.danger,
    backgroundColor: colors.alertSurface,
    borderRadius: 8,
    padding: 10,
  },
  retry: {
    alignItems: 'center',
    backgroundColor: colors.diaperSurface,
    borderRadius: 8,
    paddingVertical: 8,
  },
  retryText: { fontSize: 12, color: colors.navActiveText },


  // 5つ並ぶと狭い端末では入りきらないので、折り返して右へ寄せる。
  tabOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
    flexShrink: 1,
    marginLeft: 8,
  },
  tabOption: {
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: colors.neutralSurface,
  },
  tabOptionSelected: { backgroundColor: colors.navActive },
  tabOptionText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  tabOptionTextSelected: { color: colors.primaryText },

  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
  },
  signOutText: { fontSize: 12, color: colors.textMuted },
});
