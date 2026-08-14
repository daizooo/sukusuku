import type { EmailOtpType } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// オープンリダイレクト防止のため、next は自サイト内の絶対パスのみ許可する。
const safeNextPath = (value: string | null): string => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
};

// Supabase Authのメール確認リンク（サインアップ確認・パスワードリセット等）の受け口。
//
// 既定の確認メールテンプレート（{{ .ConfirmationURL }}）はSupabase側の /auth/v1/verify
// を経由し、検証後にこのルートへ code=（PKCE, @supabase/ssrクライアントの既定フロー）付きで
// リダイレクトしてくる。カスタムSMTP設定でテンプレートを編集できる場合は、
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/
// の形式に変更すると token_hash 経由のverifyOtp()フローも利用できる（下記はどちらにも対応）。
// token_hash 形式はPKCEのcode_verifierに依存しないため、登録した端末と別の端末で
// メールを開いてもその場でログイン状態になる。
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = safeNextPath(searchParams.get('next'));
  // 検証そのものに失敗した場合、Supabaseの /auth/v1/verify は
  // error / error_code / error_description を付けてリダイレクトしてくる。
  const verifyError = searchParams.get('error_code') ?? searchParams.get('error');

  if (verifyError) {
    // リンクが本当に無効・期限切れ・使用済みのケース。
    redirect('/login?error=confirm_failed');
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(next);
    }
    // ここに到達する主なケースは「メールの検証はSupabase側で既に完了しているが、
    // PKCEのcode_verifierがこのブラウザに存在しない」状況（登録した端末と別の
    // ブラウザ・メールアプリ内ブラウザでリンクを開いた場合など）。
    // アカウント自体は有効になっているので、エラーではなくログインを促す。
    console.error('Failed to exchange auth code for session:', error.message);
    redirect('/login?message=email_confirmed');
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
    console.error('Failed to verify email OTP:', error.message);
  }

  redirect('/login?error=confirm_failed');
}
