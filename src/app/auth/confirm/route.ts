import type { EmailOtpType } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Supabase Authのメール確認リンク（サインアップ確認・パスワードリセット等）の受け口。
//
// 既定の確認メールテンプレート（{{ .ConfirmationURL }}）はSupabase側の /auth/v1/verify
// を経由し、検証後にこのルートへ code=（PKCE, @supabase/ssrクライアントの既定フロー）付きで
// リダイレクトしてくる。カスタムSMTP設定でテンプレートを編集できる場合は、
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/
// の形式に変更すると token_hash 経由のverifyOtp()フローも利用できる（下記はどちらにも対応）。
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/';

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(next);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect('/login?error=confirm_failed');
}
