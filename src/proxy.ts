import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 以下を除く全パスに適用:
     * - _next/static, _next/image (静的ファイル)
     * - favicon.ico, manifest.webmanifest
     *   (未ログイン状態でも取得できる必要がある。特にmanifest.webmanifestは
     *   ホーム画面追加時にブラウザが認証状態と無関係に取得するため、
     *   ここで除外しないとログイン画面へリダイレクトされてしまい
     *   PWAとして認識されなくなる)
     * - 画像ファイル各種
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
