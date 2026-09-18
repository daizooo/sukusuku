import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { confirmActionOf, type ConfirmAction } from '@/lib/authLinks';
import { colors } from '@/lib/theme';

// サインアップ確認メールのリンク（`sukusuku://auth/confirm?…`）を開いたときの画面。
//
// PWA版は同じことをVercel側のルートでやっていて、画面は出さずに振り分けるだけだった
// （src/app/auth/confirm/route.ts）。ネイティブには振り分けるだけの場所が無いので
// 画面にしてあるが、**行き着く先はPWA版と同じ3つ**にそろえてある。
//
//   ホーム   … 確認できてログイン状態になった
//   ログイン … 確認は済んでいるがこの端末ではログインできなかった（案内を出す）
//   ログイン … リンクが無効・期限切れ（エラーを出す）

/** 確かめた結果。PWA版が `/` と `/login?message=…` `/login?error=…` へ分けるのと同じ。 */
type ConfirmResult = 'signed-in' | 'email_confirmed' | 'confirm_failed';

const runConfirm = async (action: ConfirmAction): Promise<ConfirmResult> => {
  if (action.kind === 'exchange') {
    const { error } = await supabase.auth.exchangeCodeForSession(action.code);
    if (!error) return 'signed-in';
    // メールの確認そのものはSupabase側で済んでいるが、PKCEの控え(code_verifier)が
    // この端末に無い状況（別の端末で登録した・アプリを入れ直した等）。
    // アカウントは有効になっているので、エラーではなくログインを促す。
    console.error('Failed to exchange auth code for session:', error.message);
    return 'email_confirmed';
  }

  if (action.kind === 'verify') {
    const { error } = await supabase.auth.verifyOtp({
      type: action.type,
      token_hash: action.tokenHash,
    });
    if (!error) return 'signed-in';
    console.error('Failed to verify email OTP:', error.message);
  }

  return 'confirm_failed';
};

export default function ConfirmScreen() {
  const params = useLocalSearchParams();
  // 開いた時点のパラメータだけを見る。確かめている間に再描画されても、もう一度は走らせない。
  const [action] = useState<ConfirmAction>(() => confirmActionOf(params));

  useEffect(() => {
    let isMounted = true;

    void runConfirm(action).then((result) => {
      if (!isMounted) return;
      if (result === 'signed-in') {
        // 入口(app/index.tsx)がホームタブへ移す。PWA版が `/` へ戻すのと同じ。
        router.replace('/');
        return;
      }
      router.replace({
        pathname: '/login',
        params:
          result === 'email_confirmed'
            ? { message: 'email_confirmed' }
            : { error: 'confirm_failed' },
      });
    });

    return () => {
      isMounted = false;
    };
  }, [action]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.text}>メールアドレスを確認しています…</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  text: { fontSize: 13, color: colors.textMuted },
});
