import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, LogOut, UserCog } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { listMembers } from '@/lib/api/members';
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
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // 再読み込みボタン用。値を変えることでeffectを再実行する。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([supabase.auth.getUser(), listMembers(supabase, familyId)])
      .then(([{ data: authData }, members]) => {
        if (cancelled) return;
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

  const handleCopyInviteCode = async () => {
    await Clipboard.setStringAsync(familyId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

          <View>
            <Text style={styles.rowLabel}>家族の招待コード</Text>
            <View style={styles.inviteRow}>
              <Text style={styles.inviteCode}>{familyId}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="招待コードをコピー"
                onPress={() => void handleCopyInviteCode()}
                hitSlop={6}
                style={styles.copyButton}
              >
                {copied ? (
                  <Check size={16} color={colors.navActive} />
                ) : (
                  <Copy size={16} color={colors.navActive} />
                )}
              </Pressable>
            </View>
            <Text style={styles.inviteNote}>
              家族が新しくアプリに参加するときに使います。
            </Text>
          </View>

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
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 16,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  disabled: { opacity: 0.5 },

  loading: { alignItems: 'center', paddingVertical: 24 },
  gap12: { gap: 12 },
  gap16: { gap: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 4,
  },
  rowLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  rowValue: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  rowValueSmall: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.textSubtle, textAlign: 'right' },


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


  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
  },
  inviteCode: { flex: 1, fontSize: 10, color: colors.textSubtle, fontWeight: '500' },
  copyButton: { padding: 6, borderRadius: 8 },
  inviteNote: { fontSize: 10, color: colors.textFaint, marginTop: 6, lineHeight: 15 },

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
