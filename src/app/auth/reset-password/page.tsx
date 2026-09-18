'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Baby, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Status = 'verifying' | 'ready' | 'invalid';

// パスワード再設定リンクの遷移先。
//
// メールは暗黙的フロー(#access_token=…)のクライアントで送っている
// （理由は src/lib/supabase/client.ts の createPasswordResetRequestClient 参照）。
// このURLフラグメントはSupabaseクライアントが読み込み時に自動で処理し、
// 有効なリンクなら PASSWORD_RECOVERY イベントが飛んでくる（それまでは
// フォームを出さない。無効・期限切れのリンクではイベントが来ない）。
export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('verifying');
  const [password, setPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const supabase = createClient();
    let recovered = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovered = true;
        setStatus('ready');
      }
    });

    const timer = setTimeout(() => {
      if (!recovered) setStatus('invalid');
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setIsSaving(true);

    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      router.push('/');
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 via-blue-400 to-teal-300 flex items-center justify-center mb-3 shadow-sm">
            <Baby className="text-white" size={28} />
          </div>
          <h1 className="font-bold text-gray-800 text-lg">新しいパスワードを設定</h1>
        </div>

        {status === 'verifying' && (
          <div className="flex flex-col items-center py-6 gap-3">
            <Loader2 size={20} className="animate-spin text-blue-500" />
            <p className="text-xs text-gray-500">リンクを確認しています…</p>
          </div>
        )}

        {status === 'invalid' && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2.5">
            リンクが無効か、有効期限切れです。もう一度ログイン画面から再設定メールを送ってください。
          </p>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">新しいパスワード</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
                placeholder="6文字以上"
                autoFocus
              />
            </div>

            {errorMessage && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2.5">{errorMessage}</p>}

            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-blue-500 text-white font-medium py-2.5 rounded-xl shadow-sm hover:bg-blue-600 active:bg-blue-700 transition disabled:bg-gray-300 flex items-center justify-center"
            >
              {isSaving ? <Loader2 size={18} className="animate-spin" /> : 'パスワードを変更する'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
