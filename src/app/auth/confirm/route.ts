import type { EmailOtpType } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Supabase Authのメール確認リンク（サインアップ確認・パスワードリセット等）の受け口。
// メールテンプレート側のリンクを
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/
// の形式にしておく必要がある（Supabaseダッシュボード Authentication > Emails）。
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/';

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect('/login?error=confirm_failed');
}
