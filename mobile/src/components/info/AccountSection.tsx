import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, Edit2, LogOut, Save, UserCog } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import {
  listAccountMembers,
  updateMyAccount,
  ROLE_LABEL,
  type AccountMember,
  type FamilyRole,
} from '@/lib/api/account';
import { colors } from '@/lib/theme';

// 設定タブのアカウント情報カード。Web版の
// `src/components/sukusuku/AccountSection.tsx` を置き換えたもの。
//
// 家族参加時に選んだ役割(パパ/ママ)の修正・表示名の変更・招待コードの再確認・
// ログアウトをここから行えるようにする。

interface AccountSectionProps {
  familyId: string;
  userId: string;
}

const ROLES: FamilyRole[] = ['papa', 'mama'];

export default function AccountSection({ familyId, userId }: AccountSectionProps) {
  const [email, setEmail] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [tempRole, setTempRole] = useState<FamilyRole>('papa');
  const [tempName, setTempName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  const [copied, setCopied] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // 再読み込みボタン用。値を変えることでeffectを再実行する。
  const [reloadKey, setReloadKey] = useState(0);

  const me = members.find((member) => member.id === userId) ?? null;
  const partners = members.filter((member) => member.id !== userId);

  useEffect(() => {
    let cancelled = false;
    Promise.all([supabase.auth.getUser(), listAccountMembers(supabase, familyId)])
      .then(([{ data: authData }, familyMembers]) => {
        if (cancelled) return;
        setEmail(authData.user?.email ?? '');
        setMembers(familyMembers);
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
  }, [familyId, reloadKey]);

  const handleRetry = () => {
    setIsLoading(true);
    setLoadError('');
    setReloadKey((key) => key + 1);
  };

  const startEditing = () => {
    setTempRole(me?.role ?? 'papa');
    setTempName(me?.name ?? '');
    setSaveError('');
    setSavedMessage('');
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError('');
    try {
      const updated = await updateMyAccount(supabase, userId, { role: tempRole, name: tempName });
      setMembers((prev) => prev.map((member) => (member.id === userId ? updated : member)));
      setIsEditing(false);
      setSavedMessage('保存しました。');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch {
      setSaveError('保存に失敗しました。時間を置いて再度お試しください。');
    } finally {
      setIsSaving(false);
    }
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
        {!isLoading && !loadError && !isEditing && (
          <Pressable accessibilityRole="button" onPress={startEditing} style={styles.headerButton}>
            <Edit2 size={14} color={colors.navActiveText} />
            <Text style={styles.headerButtonText}>変更</Text>
          </Pressable>
        )}
        {isEditing && (
          <Pressable
            accessibilityRole="button"
            disabled={isSaving}
            onPress={() => void handleSave()}
            style={[styles.headerButtonPrimary, isSaving && styles.disabled]}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primaryText} />
            ) : (
              <Save size={14} color={colors.primaryText} />
            )}
            <Text style={styles.headerButtonPrimaryText}>保存</Text>
          </Pressable>
        )}
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
            <Text style={styles.rowLabel}>メールアドレス</Text>
            <Text style={styles.rowValueSmall}>{email || '未取得'}</Text>
          </View>

          <View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>あなたの役割</Text>
              {!isEditing && (
                <Text style={styles.rowValue}>{me?.role ? ROLE_LABEL[me.role] : '未設定'}</Text>
              )}
            </View>
            {isEditing && (
              <View style={styles.roleRow}>
                {ROLES.map((role) => {
                  const selected = tempRole === role;
                  return (
                    <Pressable
                      key={role}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setTempRole(role)}
                      style={[styles.roleButton, selected && styles.roleButtonSelected]}
                    >
                      <Text style={[styles.roleText, selected && styles.roleTextSelected]}>
                        {ROLE_LABEL[role]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>お名前</Text>
              {!isEditing && <Text style={styles.rowValue}>{me?.name || '未設定'}</Text>}
            </View>
            {isEditing && (
              <TextInput
                style={styles.input}
                value={tempName}
                onChangeText={setTempName}
                placeholder="アプリ内での表示名"
                placeholderTextColor={colors.textFaint}
              />
            )}
          </View>

          {isEditing && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsEditing(false)}
              style={styles.cancel}
            >
              <Text style={styles.cancelText}>変更をやめる</Text>
            </Pressable>
          )}

          {saveError !== '' && <Text style={styles.errorBox}>{saveError}</Text>}
          {savedMessage !== '' && <Text style={styles.savedBox}>{savedMessage}</Text>}

          {partners.length > 0 && (
            <View>
              <Text style={styles.rowLabel}>パートナー</Text>
              <View style={styles.partners}>
                {partners.map((partner) => (
                  <View key={partner.id} style={styles.partner}>
                    <Text style={styles.partnerName}>{partner.name || '名前未設定'}</Text>
                    <View style={styles.partnerRole}>
                      <Text style={styles.partnerRoleText}>
                        {partner.role ? ROLE_LABEL[partner.role] : '役割未設定'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

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
              パートナーがまだ参加していない場合は、このコードを共有してください。
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
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.diaperSurface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headerButtonText: { fontSize: 12, fontWeight: '500', color: colors.navActiveText },
  headerButtonPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.navActive,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  headerButtonPrimaryText: { fontSize: 12, fontWeight: '500', color: colors.primaryText },
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
  rowLabel: { fontSize: 12, color: colors.textMuted },
  rowValue: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  rowValueSmall: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.textSubtle, textAlign: 'right' },

  roleRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  roleButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleButtonSelected: { backgroundColor: colors.navActive, borderColor: colors.navActive },
  roleText: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
  roleTextSelected: { color: colors.primaryText },

  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textSubtle,
    backgroundColor: colors.surface,
  },
  cancel: { alignItems: 'center', paddingVertical: 4 },
  cancelText: { fontSize: 12, color: colors.textFaint },
  errorBox: {
    fontSize: 12,
    color: colors.danger,
    backgroundColor: colors.alertSurface,
    borderRadius: 8,
    padding: 10,
  },
  savedBox: {
    fontSize: 12,
    color: colors.doneText,
    backgroundColor: colors.gradeGoodSurface,
    borderWidth: 1,
    borderColor: colors.gradeGoodBorder,
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

  partners: { gap: 6, marginTop: 6 },
  partner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  partnerName: { fontSize: 12, color: colors.textSubtle },
  partnerRole: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  partnerRoleText: { fontSize: 10, fontWeight: '700', color: colors.labelDefaultText },

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
  inviteCode: { flex: 1, fontSize: 10, color: colors.textSubtle },
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
