'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Baby, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// パスワード再設定リンクの遷移先。/auth/confirm がリカバリー用のcodeを検証して
// セッションを確立したあと、next=/auth/reset-password でここへリダイレクトしてくる。
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      router.push('/');
      router.refresh();
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
          <h1 className="font-bold text-gray-800 text-lg">新しいパスワードを設定</h1>
        </div>

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
            disabled={isLoading}
            className="w-full bg-blue-500 text-white font-medium py-2.5 rounded-xl shadow-sm hover:bg-blue-600 active:bg-blue-700 transition disabled:bg-gray-300 flex items-center justify-center"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : 'パスワードを変更する'}
          </button>
        </form>
      </div>
    </div>
  );
}
