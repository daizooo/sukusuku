import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// ネイティブ側のSupabaseクライアント。
// Web版(src/lib/supabase/client.ts)はCookieにセッションを置いてサーバー側でも読めるように
// していたが、ネイティブにはサーバー側が無いのでセッションは端末(AsyncStorage)に保存する。
// これにより2回目以降の起動は「もうログイン済み」の状態から始まる。
//
// EXPO_PUBLIC_* はビルド時にJSへ埋め込まれる。anon keyは公開情報で、
// アクセス制御はWeb版と同じくRLS(family_id)で担保する。

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// 未設定のまま起動すると createClient が投げるだけで理由が分からないため、先に止める。
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY が未設定です。' +
      'mobile/.env.local.example を .env.local としてコピーし、値を入れてから起動してください。',
  );
}

export type SupabaseDb = SupabaseClient<Database>;

export const supabase: SupabaseDb = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // URLからセッションを拾うのはWebのOAuthリダイレクト用。ネイティブでは要らない。
    detectSessionInUrl: false,
    // サインアップ確認メールのリンクは `?code=` を付けてアプリへ戻ってくる（PKCE）。
    // 既定の implicit だと `#access_token=…` の断片で戻るため、ディープリンクでは拾えない
    // （mobile/app/auth/confirm.tsx が受けて exchangeCodeForSession する）。
    flowType: 'pkce',
    lock: processLock,
  },
});

// アプリが前面にある間だけトークンを自動更新する。
// 背面で回し続けるとバッテリーを使うだけなので止める。
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
