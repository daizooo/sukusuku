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
     * - favicon.ico
     * - sw.js (サービスワーカー。ログインへリダイレクトされると登録に失敗するため除外)
     * - 画像ファイル各種
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
