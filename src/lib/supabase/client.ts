import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/supabase';

// クライアントコンポーネントから利用するSupabaseクライアント。
// NEXT_PUBLIC_* の値は公開情報（anon key）であり、アクセス制御はRLSで担保する。
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
