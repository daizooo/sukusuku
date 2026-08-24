import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// ログイン状態をアプリ全体で1つだけ持つ。
//
// Web版は毎回の表示でサーバーがセッションを検証していた(src/app/page.tsx)。
// ネイティブでは端末に保存されたセッションを起動時に1度読み、
// 以降は onAuthStateChange の通知で追いかける（往復を待たない）。

interface SessionState {
  session: Session | null;
  /** 端末に保存されたセッションを読み終わるまで true。 */
  isLoading: boolean;
}

const SessionContext = createContext<SessionState>({ session: null, isLoading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      setIsLoading(false);
    });

    // ログイン・ログアウト・トークン更新のすべてがここに流れてくる。
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ session, isLoading }), [session, isLoading]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = (): SessionState => useContext(SessionContext);
