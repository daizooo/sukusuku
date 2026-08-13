'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Baby, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

function ConfirmErrorBanner() {
  const searchParams = useSearchParams();
  if (searchParams.get('error') !== 'confirm_failed') return null;
  return (
    <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2.5 mb-4">
      確認リンクが無効か、有効期限切れです。もう一度お試しください。
    </p>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setInfoMessage('');
    setIsLoading(true);

    const supabase = createClient();

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        router.push('/');
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
        });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        if (data.session) {
          router.push('/');
          router.refresh();
        } else {
          setInfoMessage('確認メールを送信しました。メール内のリンクから登録を完了してください。');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 via-blue-400 to-teal-300 flex items-center justify-center mb-3 shadow-sm">
            <Baby className="text-white" size={28} />
          </div>
          <h1 className="font-bold text-gray-800 text-lg">すくすく手帳</h1>
          <p className="text-xs text-gray-500 mt-1">夫婦で育児を共有しよう</p>
        </div>

        <Suspense fallback={null}>
          <ConfirmErrorBanner />
        </Suspense>

        <div className="flex bg-gray-100 p-1 rounded-lg mb-6">
          <button
            type="button"
            onClick={() => setMode('signin')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${mode === 'signin' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            ログイン
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${mode === 'signup' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            新規登録
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">パスワード</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
              placeholder="6文字以上"
            />
          </div>

          {errorMessage && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2.5">{errorMessage}</p>}
          {infoMessage && <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg p-2.5">{infoMessage}</p>}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-500 text-white font-medium py-2.5 rounded-xl shadow-sm hover:bg-blue-600 active:bg-blue-700 transition disabled:bg-gray-300 flex items-center justify-center"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : mode === 'signin' ? 'ログイン' : '登録する'}
          </button>
        </form>
      </div>
    </div>
  );
}
