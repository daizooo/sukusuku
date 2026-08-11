import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Server Components / Route Handlers から利用するSupabaseクライアント。
// Cookieベースのセッションを読み書きし、認証状態をサーバー側で解決する。
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Componentからの呼び出し時はCookie書き込みができないため無視する。
            // ミドルウェアでセッションを更新している場合は問題ない。
          }
        },
      },
    },
  );
}
