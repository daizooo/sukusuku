'use client';

import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { MoneyWallet, MoneyWalletDraft } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { cardScheduleLabel, WALLET_TYPES } from '@/lib/moneyUtils';
import { archiveMoneyWallet, insertMoneyWallet, restoreMoneyWallet, updateMoneyWallet } from '@/lib/api/money';
import { WalletModal } from './WalletPicker';
import { ScreenHeader, StackedScreen } from './moneyVisual';

// 出金元の設定（docs/kakei.md §3.5）。mobile版の `mobile/src/components/money/WalletSettings.tsx` と同じ並び・文言。
// 種類（財布・カード・口座…）ごとに並べ、足す・直す・使わなくする・また使う。記録の入力中の「出金元を選ぶ」と同じ編集の枠。

interface WalletSettingsProps {
  familyId: string;
  wallets: MoneyWallet[];
  onWallets: (update: (prev: MoneyWallet[]) => MoneyWallet[]) => void;
  onBack: () => void;
}

const byPosition = (a: MoneyWallet, b: MoneyWallet) => a.position - b.position;

export default function WalletSettings({ familyId, wallets, onWallets, onBack }: WalletSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [editing, setEditing] = useState<MoneyWallet | 'new' | null>(null);
  const usable = wallets.filter((wallet) => !wallet.archived);
  const archived = wallets.filter((wallet) => wallet.archived);

  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');
  const put = (saved: MoneyWallet) =>
    onWallets((prev) => [...prev.filter((wallet) => wallet.id !== saved.id), saved].sort(byPosition));

  const save = async (target: MoneyWallet | null, draft: MoneyWalletDraft) => {
    setEditing(null);
    try {
      put(
        target === null
          ? await insertMoneyWallet(
              supabase,
              familyId,
              draft,
              wallets.reduce((max, wallet) => Math.max(max, wallet.position + 1), 0),
            )
          : await updateMoneyWallet(supabase, target.id, draft),
      );
    } catch {
      failed();
    }
  };

  const archive = async (wallet: MoneyWallet) => {
    setEditing(null);
    try {
      put(await archiveMoneyWallet(supabase, wallet.id));
    } catch {
      failed();
    }
  };

  const restore = async (wallet: MoneyWallet) => {
    try {
      put(await restoreMoneyWallet(supabase, wallet.id));
    } catch {
      failed();
    }
  };

  return (
    <StackedScreen onBack={onBack}>
      <ScreenHeader title="出金元" icon="back" onClose={onBack} />
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {usable.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-400">出金元がまだありません。カード・財布・口座などを足してください</p>
        )}
        {WALLET_TYPES.map((type) => {
          const inType = usable.filter((wallet) => wallet.type === type.id);
          if (inType.length === 0) return null;
          return (
            <section key={type.id} className="space-y-1.5">
              <p className="text-xs font-bold text-gray-500">{type.label}</p>
              {inType.map((wallet) => (
                <button
                  key={wallet.id}
                  type="button"
                  aria-label={`${wallet.name}を編集`}
                  onClick={() => setEditing(wallet)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-3 text-left hover:bg-gray-50"
                >
                  <span className="flex-1">
                    <span className="block text-[15px] font-semibold text-gray-900">{wallet.name}</span>
                    {wallet.isSaving && <span className="block text-xs text-gray-400">貯金用</span>}
                    {cardScheduleLabel(wallet) !== '' && (
                      <span className="block text-xs text-gray-400">{cardScheduleLabel(wallet)}</span>
                    )}
                  </span>
                  <Pencil size={16} className="text-gray-400" />
                </button>
              ))}
            </section>
          );
        })}
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex items-center gap-2 py-2.5 text-[15px] font-bold text-blue-600"
        >
          <Plus size={18} />
          出金元を足す
        </button>

        {archived.length > 0 && (
          <section className="space-y-1.5">
            <p className="text-xs font-bold text-gray-500">使わない出金元（記録には残っています）</p>
            {archived.map((wallet) => (
              <div key={wallet.id} className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-3 opacity-70">
                <span className="flex-1 text-[15px] font-semibold text-gray-900">{wallet.name}</span>
                <button type="button" onClick={() => void restore(wallet)} className="text-[13px] font-bold text-blue-600">
                  また使う
                </button>
              </div>
            ))}
          </section>
        )}
      </div>

      {editing !== null && (
        <WalletModal
          key={editing === 'new' ? 'new' : editing.id}
          wallet={editing === 'new' ? null : editing}
          wallets={wallets}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(editing === 'new' ? null : editing, draft)}
          onArchive={editing === 'new' ? undefined : () => void archive(editing)}
        />
      )}
    </StackedScreen>
  );
}
