'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Edit2, Loader2, LogOut, Save, UserCog } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { listAccountMembers, updateMyAccount, ROLE_LABEL, type AccountMember, type FamilyRole } from '@/lib/api/account';

interface AccountSectionProps {
  familyId: string;
  userId: string;
}

const ROLES: FamilyRole[] = ['papa', 'mama'];

// 「設定」タブ内のアカウント情報カード。
// 家族参加時に選んだ役割(パパ/ママ)の修正・表示名の変更・招待コードの再確認・
// ログアウトをここから行えるようにする。
export default function AccountSection({ familyId, userId }: AccountSectionProps) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [tempRole, setTempRole] = useState<FamilyRole>('papa');
  const [tempName, setTempName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  const [copied, setCopied] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // 再読み込みボタン用。値を変えることでeffectを再実行する。
  const [reloadKey, setReloadKey] = useState(0);

  const me = members.find((member) => member.id === userId) ?? null;
  const partners = members.filter((member) => member.id !== userId);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    Promise.all([supabase.auth.getUser(), listAccountMembers(supabase, familyId)])
      .then(([{ data: authData }, familyMembers]) => {
        if (cancelled) return;
        setEmail(authData.user?.email ?? '');
        setMembers(familyMembers);
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
  }, [familyId, reloadKey]);

  const handleRetry = () => {
    setIsLoading(true);
    setLoadError('');
    setReloadKey((key) => key + 1);
  };

  const startEditing = () => {
    setTempRole(me?.role ?? 'papa');
    setTempName(me?.name ?? '');
    setSaveError('');
    setSavedMessage('');
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError('');
    try {
      const updated = await updateMyAccount(createClient(), userId, { role: tempRole, name: tempName });
      setMembers((prev) => prev.map((member) => (member.id === userId ? updated : member)));
      setIsEditing(false);
      setSavedMessage('保存しました。');
      setTimeout(() => setSavedMessage(''), 3000);
      // ホーム画面などはサーバー側で読んだ役割(users.role)を使うため、再取得させる
      router.refresh();
    } catch (err) {
      console.error('Failed to update profile:', err);
      setSaveError('保存に失敗しました。時間を置いて再度お試しください。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyInviteCode = async () => {
    try {
      await navigator.clipboard.writeText(familyId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy invite code:', err);
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
        {!isLoading && !loadError && !isEditing && (
          <button
            onClick={startEditing}
            className="text-blue-600 flex items-center text-xs font-medium bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100"
          >
            <Edit2 size={14} className="mr-1" /> 変更
          </button>
        )}
        {isEditing && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="text-white flex items-center text-xs font-medium bg-blue-500 px-4 py-1.5 rounded-lg shadow-sm hover:bg-blue-600 disabled:bg-gray-300"
          >
            {isSaving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />} 保存
          </button>
        )}
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
            <span className="text-gray-500 text-xs">メールアドレス</span>
            <span className="font-medium text-gray-700 text-xs break-all text-right ml-2">{email || '未取得'}</span>
          </div>

          <div>
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500 text-xs">あなたの役割</span>
              {!isEditing && (
                <span className="font-medium text-gray-700">{me?.role ? ROLE_LABEL[me.role] : '未設定'}</span>
              )}
            </div>
            {isEditing && (
              <div className="flex space-x-2 mt-1.5">
                {ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setTempRole(role)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                      tempRole === role ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {ROLE_LABEL[role]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500 text-xs">お名前</span>
              {!isEditing && <span className="font-medium text-gray-700">{me?.name || '未設定'}</span>}
            </div>
            {isEditing && (
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                placeholder="アプリ内での表示名"
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 mt-1.5"
              />
            )}
          </div>

          {isEditing && (
            <button
              onClick={() => setIsEditing(false)}
              className="w-full text-center text-xs text-gray-400 py-1 hover:text-gray-600 transition"
            >
              変更をやめる
            </button>
          )}

          {saveError && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2.5">{saveError}</p>}
          {savedMessage && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg p-2.5">{savedMessage}</p>
          )}

          {partners.length > 0 && (
            <div className="pt-1">
              <span className="text-gray-500 text-xs">パートナー</span>
              <ul className="mt-1.5 space-y-1.5">
                {partners.map((partner) => (
                  <li key={partner.id} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-700">{partner.name || '名前未設定'}</span>
                    <span className="text-[10px] font-bold text-gray-600 bg-white border border-gray-200 rounded-md px-2 py-0.5">
                      {partner.role ? ROLE_LABEL[partner.role] : '役割未設定'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-1">
            <span className="text-gray-500 text-xs">家族の招待コード</span>
            <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5 mt-1.5">
              <code className="flex-1 text-[10px] text-gray-700 break-all font-mono">{familyId}</code>
              <button
                onClick={handleCopyInviteCode}
                className="shrink-0 text-blue-500 hover:bg-blue-50 p-1.5 rounded-lg transition"
                aria-label="招待コードをコピー"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
              パートナーがまだ参加していない場合は、このコードを共有してください。
            </p>
          </div>

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
