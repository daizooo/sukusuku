import { createBrowserClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// クライアントコンポーネントから利用するSupabaseクライアント。
// NEXT_PUBLIC_* の値は公開情報（anon key）であり、アクセス制御はRLSで担保する。
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// パスワード再設定メールの送信専用クライアント。
//
// @supabase/ssrのcreateBrowserClientはCookie保存の都合でflowTypeを常にpkceへ
// 固定してしまう。PKCEだと「メールを送ったブラウザ」にしか無いcode_verifierが
// 要るため、スマホのメールアプリ内ブラウザ等、送信時と別のブラウザでリンクを
// 開くと失敗する（本番で実際に発生: PKCE code verifier not found in storage）。
// 送信リクエストだけ暗黙的フロー(#access_token=…)のクライアントで行うと、
// 戻ってくるリンクは自己完結したトークンになり、どの端末・ブラウザで開いても
// 通せる。このクライアント自身のセッションは使わないので永続化もしない。
export function createPasswordResetRequestClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: 'implicit', persistSession: false, detectSessionInUrl: false } },
  );
}
