'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogOut, UserCog } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { listMembers } from '@/lib/api/members';
import {
  getMyStartTab,
  START_TAB_LABEL,
  START_TABS,
  updateMyStartTab,
  type StartTab,
} from '@/lib/api/me';

interface AccountSectionProps {
  familyId: string;
  userId: string;
}

// 「設定」タブ内のアカウント情報カード。mobile版は `mobile/src/components/info/AccountSection.tsx`。
//
// お名前は「家族」の自分の行の名（フルネームの名前部分）をそのまま出す。
// 名前を直すのは「家族」の編集画面だけにして、アカウントと家族の情報を一致させる
// （docs/family-app.md §4.3）。役割・パートナーの表示は持たない。
export default function AccountSection({ familyId, userId }: AccountSectionProps) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  // アプリを開いたときに最初に出すタブ（1人ずつ。docs/family-app.md §3.4）。
  const [startTab, setStartTab] = useState<StartTab>('schedule');
  const [saveError, setSaveError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);
  // 再読み込みボタン用。値を変えることでeffectを再実行する。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    Promise.all([supabase.auth.getUser(), listMembers(supabase, familyId), getMyStartTab(supabase, userId)])
      .then(([{ data: authData }, members, tab]) => {
        if (cancelled) return;
        setStartTab(tab);
        const me = members.find((member) => member.userId === userId);
        setEmail(authData.user?.email ?? '');
        setName(me ? me.givenName || me.displayName : '');
        setLoadError('');
      })
      .catch((err) => {
        console.error('Failed to load account info:', err);
        if (!cancelled) setLoadError('アカウント情報の読み込みに失敗しました。');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [familyId, userId, reloadKey]);

  const handleRetry = () => {
    setIsLoading(true);
    setLoadError('');
    setReloadKey((key) => key + 1);
  };

  const changeStartTab = async (tab: StartTab) => {
    const previous = startTab;
    setStartTab(tab);
    setSaveError('');
    try {
      await updateMyStartTab(createClient(), userId, tab);
    } catch (err) {
      console.error('Failed to save start tab:', err);
      setStartTab(previous);
      setSaveError('保存できませんでした。もう一度お試しください。');
    }
  };

  const handleSignOut = async () => {
    if (!window.confirm('ログアウトしますか？')) return;
    setIsSigningOut(true);
    try {
      await createClient().auth.signOut();
      router.push('/login');
      router.refresh();
    } catch (err) {
      console.error('Failed to sign out:', err);
      setIsSigningOut(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4 border-b pb-2">
        <h3 className="font-bold text-gray-800 flex items-center">
          <UserCog size={18} className="mr-2 text-blue-500" /> アカウント
        </h3>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={20} className="animate-spin text-blue-500" />
        </div>
      ) : loadError ? (
        <div className="space-y-3">
          <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2.5">{loadError}</p>
          <button onClick={handleRetry} className="w-full text-xs text-blue-600 bg-blue-50 rounded-lg py-2 hover:bg-blue-100">
            再読み込み
          </button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex justify-between items-center py-1">
            <span className="text-gray-500 text-xs">お名前</span>
            <span className="font-medium text-gray-700">{name || '未設定'}</span>
          </div>

          <div className="flex justify-between items-center py-1">
            <span className="text-gray-500 text-xs">メールアドレス</span>
            <span className="font-medium text-gray-700 text-xs break-all text-right ml-2">{email || '未取得'}</span>
          </div>

          <div className="flex justify-between items-center gap-2 py-1">
            <span className="text-gray-500 text-xs">最初に開くタブ</span>
            <div className="flex flex-wrap justify-end gap-1">
              {START_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={startTab === tab}
                  onClick={() => void changeStartTab(tab)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                    startTab === tab ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {START_TAB_LABEL[tab]}
                </button>
              ))}
            </div>
          </div>
          {saveError && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2.5">{saveError}</p>}

          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="w-full flex items-center justify-center space-x-1.5 text-xs text-gray-500 border border-gray-200 rounded-xl py-2.5 hover:bg-gray-50 transition disabled:text-gray-300"
          >
            {isSigningOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            <span>ログアウト</span>
          </button>
        </div>
      )}
    </section>
  );
}
