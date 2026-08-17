import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Middlewareでセッション(Cookie)を都度リフレッシュする。
// Server Component単体ではCookieの書き込みができないため、ここで行う。
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims()を呼ぶことで期限切れセッションのリフレッシュが走る（getSession()だけでは走らない）。
  // getUser()と違い、JWTが非対称鍵(ECC/RSA)で署名されている場合はWebCrypto APIと
  // キャッシュ済みJWKSによるローカル検証で完結し、Authサーバーへのネットワーク往復が
  // 発生しない。全リクエストが通るミドルウェアではこの差が大きい。
  // (このプロジェクトの署名鍵はES256=ECDSA P-256のため該当する)
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login');
  const isApiRoute = request.nextUrl.pathname.startsWith('/api');
  // メール確認リンク(/auth/confirm)は未ログイン状態でアクセスしてセッションを
  // 確立するためのルートなので、未ログインリダイレクトの対象から除外する。
  const isAuthCallbackRoute = request.nextUrl.pathname.startsWith('/auth/');

  if (!userId && !isAuthRoute && !isApiRoute && !isAuthCallbackRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (userId && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
