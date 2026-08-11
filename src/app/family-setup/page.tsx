'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Heart, LogOut, Loader2, UserPlus, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { seedDefaultTasks } from '@/lib/api/tasks';

type Role = 'papa' | 'mama';
type View = 'choose' | 'create' | 'join' | 'done';

const ROLE_LABEL: Record<Role, string> = { papa: 'パパ', mama: 'ママ' };

export default function FamilySetupPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('choose');
  const [role, setRole] = useState<Role>('papa');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [createdFamilyId, setCreatedFamilyId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // 既にfamily_idを持っているユーザーがこの画面に来た場合はトップへ戻す
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace('/login');
        return;
      }
      const { data } = await supabase.from('users').select('family_id').eq('id', user.id).single();
      if (data?.family_id) {
        router.replace('/');
        return;
      }
      setCheckingSession(false);
    });
  }, [router]);

  const handleCreateFamily = async () => {
    setErrorMessage('');
    setIsLoading(true);
    const supabase = createClient();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      // families_select_own ポリシーはusers.family_idと一致する行しかSELECTできないため、
      // insert直後のRETURNINGでは(まだusers.family_id未設定なので)行を取得できない。
      // そのためIDをクライアント側で生成して事前に確定させる。
      const newFamilyId = crypto.randomUUID();
      const { error: familyError } = await supabase.from('families').insert({ id: newFamilyId });
      if (familyError) {
        setErrorMessage(familyError.message);
        return;
      }

      const { error: userError } = await supabase
        .from('users')
        .update({ family_id: newFamilyId, role })
        .eq('id', user.id);
      if (userError) {
        setErrorMessage(userError.message);
        return;
      }

      try {
        await seedDefaultTasks(supabase, newFamilyId);
      } catch (seedError) {
        // 定番ToDoの登録に失敗しても家族作成自体は成功しているため、続行する
        console.error('Failed to seed default tasks:', seedError);
      }

      setCreatedFamilyId(newFamilyId);
      setView('done');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinFamily = async () => {
    setErrorMessage('');
    const trimmedCode = inviteCodeInput.trim();
    if (!trimmedCode) {
      setErrorMessage('招待コードを入力してください。');
      return;
    }
    setIsLoading(true);
    const supabase = createClient();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      const { error } = await supabase.from('users').update({ family_id: trimmedCode, role }).eq('id', user.id);
      if (error) {
        setErrorMessage('招待コードが正しくないか、参加に失敗しました。');
        return;
      }

      router.push('/');
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(createdFamilyId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-100">
        <Loader2 size={24} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 via-blue-400 to-teal-300 flex items-center justify-center mb-3 shadow-sm">
            <Heart className="text-white fill-white" size={26} />
          </div>
          <h1 className="font-bold text-gray-800 text-lg">ご家族の設定</h1>
          <p className="text-xs text-gray-500 mt-1 text-center">
            夫婦で予定や記録を共有するために、
            <br />
            家族グループを作成 または 参加してください
          </p>
        </div>

        {view === 'choose' && (
          <div className="space-y-3">
            <button
              onClick={() => setView('create')}
              className="w-full flex items-center justify-center space-x-2 bg-blue-500 text-white font-medium py-3 rounded-xl shadow-sm hover:bg-blue-600 transition"
            >
              <Users size={18} />
              <span>家族を新規作成する</span>
            </button>
            <button
              onClick={() => setView('join')}
              className="w-full flex items-center justify-center space-x-2 bg-gray-100 text-gray-700 font-medium py-3 rounded-xl hover:bg-gray-200 transition"
            >
              <UserPlus size={18} />
              <span>招待コードで参加する</span>
            </button>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center justify-center space-x-1.5 text-xs text-gray-400 py-2 hover:text-gray-600 transition"
            >
              <LogOut size={14} />
              <span>ログアウト</span>
            </button>
          </div>
        )}

        {(view === 'create' || view === 'join') && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">あなたの役割</label>
              <div className="flex space-x-2">
                {(['papa', 'mama'] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                      role === r ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>

            {view === 'join' && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">招待コード</label>
                <input
                  type="text"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 font-mono"
                  placeholder="パートナーから共有されたコード"
                />
              </div>
            )}

            {errorMessage && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2.5">{errorMessage}</p>}

            <button
              onClick={view === 'create' ? handleCreateFamily : handleJoinFamily}
              disabled={isLoading}
              className="w-full bg-blue-500 text-white font-medium py-2.5 rounded-xl shadow-sm hover:bg-blue-600 transition disabled:bg-gray-300 flex items-center justify-center"
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : view === 'create' ? '作成する' : '参加する'}
            </button>
            <button onClick={() => setView('choose')} className="w-full text-center text-xs text-gray-400 py-1 hover:text-gray-600 transition">
              戻る
            </button>
          </div>
        )}

        {view === 'done' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">家族グループを作成しました。以下の招待コードをパートナーに共有してください。</p>
            <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <code className="flex-1 text-xs text-gray-700 break-all font-mono">{createdFamilyId}</code>
              <button onClick={handleCopy} className="shrink-0 text-blue-500 hover:bg-blue-50 p-1.5 rounded-lg transition">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <button
              onClick={() => {
                router.push('/');
                router.refresh();
              }}
              className="w-full bg-blue-500 text-white font-medium py-2.5 rounded-xl shadow-sm hover:bg-blue-600 transition"
            >
              アプリを開始する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
