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
     * - sw.js (Service Worker。ブラウザが定期的に更新を取りに来るが、その取得は
     *   ページのセッションとは別に走るため、ここで除外しないとログイン画面の
     *   HTMLが返ってきて登録・更新に失敗する)
     * - 画像ファイル各種
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
