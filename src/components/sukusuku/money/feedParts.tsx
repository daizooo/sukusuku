'use client';

import type { ReactNode } from 'react';
import type { MoneyWallet } from '@/types/app';
import { WALLET_TYPES } from '@/lib/moneyUtils';
import { WalletTypeIcon } from './moneyVisual';

// Zaim 取り込みの画面（未確認の一覧・家計の設定の「Zaim 取り込み」）で使う小さな部品。
// mobile版の `mobile/src/components/money/feedParts.tsx` と同じ見た目。

export const feedInputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-400';

/** 小さな選択の札（向き・動きなど）。選んだものは淡い青。 */
export function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] ${
        selected ? 'border-blue-300 bg-blue-100 font-bold text-blue-800' : 'border-gray-200 bg-white font-semibold text-gray-700'
      }`}
    >
      {label}
    </button>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

/** 見出しつきの欄。 */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold text-gray-700">{label}</p>
      {children}
      {hint && <p className="text-xs leading-relaxed text-gray-500">{hint}</p>}
    </div>
  );
}

/** 入・切の行（「次から同じ内容は自動で」など）。 */
export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex-1 text-sm font-semibold text-gray-900">{label}</span>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5" />
    </label>
  );
}

/** 出金元を1つ選ぶ一覧（種類ごと）。exclude は出さない出金元。 */
export function WalletChoices({
  wallets,
  selectedId,
  onPick,
  exclude,
}: {
  wallets: MoneyWallet[];
  selectedId: string | null;
  onPick: (walletId: string) => void;
  exclude?: string | null;
}) {
  const usable = wallets.filter((wallet) => !wallet.archived && wallet.id !== exclude);
  return (
    <div className="space-y-2.5">
      {WALLET_TYPES.map((walletType) => {
        const inType = usable.filter((wallet) => wallet.type === walletType.id);
        if (inType.length === 0) return null;
        return (
          <div key={walletType.id} className="space-y-1">
            <p className="text-[11px] font-bold text-gray-500">{walletType.label}</p>
            {inType.map((wallet) => {
              const selected = wallet.id === selectedId;
              return (
                <button
                  key={wallet.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPick(wallet.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left ${
                    selected ? 'border-blue-300 bg-blue-50' : 'border-gray-200'
                  }`}
                >
                  <WalletTypeIcon type={wallet.type} size={20} color={wallet.iconColor} />
                  <span className="flex-1 truncate text-sm font-semibold text-gray-900">{wallet.name}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
