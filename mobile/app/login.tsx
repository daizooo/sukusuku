import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { confirmRedirectUrl } from '@/lib/authLinks';
import { colors } from '@/lib/theme';

// ログインと新規登録。PWA版(src/app/login/page.tsx)と同じ作りにしてある
// ——同じ切り替え・同じ並び・同じ文言で、使うAPIも signInWithPassword / signUp と同じ。
//
// 新規登録の確認メールの受け口だけが違う。PWA版はVercelのURL(`/auth/confirm`)へ戻すが、
// ネイティブ版はアプリのスキームへ戻す（mobile/src/lib/authLinks.ts）。
// これでVercelを畳んだあとも登録ができる（docs/native-app-rewrite.md §7の条件C）。

type Mode = 'signin' | 'signup';

export default function LoginScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  // 確認リンクから戻ってきたときの結果。app/auth/confirm.tsx が付けてくる。
  const { message, error } = useLocalSearchParams<{ message?: string; error?: string }>();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  if (isSessionLoading) return <LoadingScreen />;
  if (session) return <Redirect href="/" />;

  const handleSubmit = async () => {
    setErrorMessage('');
    setInfoMessage('');
    setIsSubmitting(true);
    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        // 成功すれば onAuthStateChange が session を入れ、この画面は Redirect で閉じる。
        if (signInError) setErrorMessage(signInError.message);
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: confirmRedirectUrl() },
      });
      if (signUpError) {
        setErrorMessage(signUpError.message);
        return;
      }
      // 確認が要らない設定なら、その場でログイン状態になる（Redirect で閉じる）。
      if (!data.session) {
        setInfoMessage(
          '確認メールを送信しました。メール内のリンクから登録を完了してください。別の端末やメールアプリ内のブラウザでリンクを開いた場合は、確認後にこの画面からログインしてください。',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = email.trim() !== '' && password !== '' && !isSubmitting;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>かぞく手帳</Text>
          <Text style={styles.subtitle}>家族の予定・リスト・育児をひとつに</Text>

          <ConfirmResultBanner message={message} error={error} />

          <View style={styles.modeSwitch}>
            <ModeButton
              label="ログイン"
              isActive={mode === 'signin'}
              onPress={() => setMode('signin')}
            />
            <ModeButton
              label="新規登録"
              isActive={mode === 'signup'}
              onPress={() => setMode('signup')}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>メールアドレス</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>パスワード</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              secureTextEntry
              placeholder="6文字以上"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={() => {
                if (canSubmit) void handleSubmit();
              }}
            />

            {errorMessage !== '' && <Text style={styles.error}>{errorMessage}</Text>}
            {infoMessage !== '' && <Text style={styles.info}>{infoMessage}</Text>}

            <Pressable
              style={[styles.button, !canSubmit && styles.buttonDisabled]}
              disabled={!canSubmit}
              onPress={() => void handleSubmit()}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.buttonText}>{mode === 'signin' ? 'ログイン' : '登録する'}</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * 確認リンクを開いたあとの案内。文言はPWA版の ConfirmResultBanner と同じ。
 *
 * `email_confirmed` はエラーではない。メールの確認は済んでいるが、その端末では
 * そのままログイン状態にできなかったときに出る（app/auth/confirm.tsx）。
 */
function ConfirmResultBanner({ message, error }: { message?: string; error?: string }) {
  if (message === 'email_confirmed') {
    return (
      <Text style={[styles.banner, styles.bannerInfo]}>
        メールアドレスの確認が完了しました。登録したメールアドレスとパスワードでログインしてください。
      </Text>
    );
  }

  if (error === 'confirm_failed') {
    return (
      <Text style={[styles.banner, styles.bannerError]}>
        確認リンクが無効か、有効期限切れです。すでに確認済みの場合はそのままログインできます。
      </Text>
    );
  }

  return null;
}

function ModeButton({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.modeButton, isActive && styles.modeButtonActive]} onPress={onPress}>
      <Text style={[styles.modeButtonText, isActive && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function LoadingScreen() {
  return (
    <SafeAreaView style={[styles.safeArea, styles.center]}>
      <ActivityIndicator color={colors.primary} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: 16 },
  banner: {
    fontSize: 12,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    lineHeight: 18,
  },
  bannerInfo: {
    color: colors.doneText,
    backgroundColor: colors.gradeGoodSurface,
    borderColor: colors.doneSurface,
  },
  bannerError: {
    color: colors.danger,
    backgroundColor: colors.dangerSurface,
    borderColor: colors.alertSurface,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.neutralSurface,
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  modeButton: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  modeButtonActive: { backgroundColor: colors.surface },
  modeButtonText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  modeButtonTextActive: { color: colors.navActiveText },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 6,
  },
  label: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { fontSize: 12, color: colors.danger, marginTop: 10 },
  info: { fontSize: 12, color: colors.navActiveText, marginTop: 10, lineHeight: 18 },
  button: {
    marginTop: 20,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
});
