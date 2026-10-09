'use client';

import { useState } from 'react';
import { Check, Pencil, Plus } from 'lucide-react';
import type { MoneyWallet, MoneyWalletDraft, MoneyWalletType } from '@/types/app';
import { cardScheduleLabel, WALLET_ICON_COLORS, WALLET_TYPES } from '@/lib/moneyUtils';
import { ModalShell } from '../modals/TaskForm';
import { PrimaryButton, ScreenHeader, StackedScreen, WalletTypeIcon } from './moneyVisual';

// 出金元の選択（docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/WalletPicker.tsx` と同じ並び・文言。
// 種類（財布・カード・口座…）ごとに並べる。ここで出金元を足す・直す・使わなくする。
// カードは締め日・引き落とし日・引き落とし口座を持てる。そろうと、引き落とし日にカード代金の振替（見込み）が
// 自動で作られる（docs/kakei.md §3.4）。

interface WalletPickerProps {
  title: string;
  wallets: MoneyWallet[];
  selectedId: string | null;
  onPick: (walletId: string) => void;
  onClose: () => void;
  onSave: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchive: (wallet: MoneyWallet) => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

export default function WalletPicker({ title, wallets, selectedId, onPick, onClose, onSave, onArchive }: WalletPickerProps) {
  const [editing, setEditing] = useState<MoneyWallet | 'new' | null>(null);
  const usable = wallets.filter((wallet) => !wallet.archived);

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader title={title} icon="back" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {usable.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-400">出金元がまだありません。カード・財布・口座などを足してください</p>
        )}
        {WALLET_TYPES.map((type) => {
          const inType = usable.filter((wallet) => wallet.type === type.id);
          if (inType.length === 0) return null;
          return (
            <section key={type.id} className="space-y-1">
              <p className="text-xs font-bold text-gray-500">{type.label}</p>
              {inType.map((wallet) => {
                const selected = wallet.id === selectedId;
                return (
                  <div
                    key={wallet.id}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 ${
                      selected ? 'border-blue-100 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onPick(wallet.id)}
                      className="flex flex-1 items-center gap-2 py-3 text-left"
                    >
                      <span className="flex-1">
                        <span className="block text-[15px] font-semibold text-gray-900">{wallet.name}</span>
                        {wallet.isSaving && <span className="block text-xs text-gray-400">貯金用</span>}
                        {cardScheduleLabel(wallet) !== '' && (
                          <span className="block text-xs text-gray-400">{cardScheduleLabel(wallet)}</span>
                        )}
                      </span>
                      {selected && <Check size={18} className="text-blue-600" />}
                    </button>
                    <button
                      type="button"
                      aria-label={`${wallet.name}を編集`}
                      onClick={() => setEditing(wallet)}
                      className="p-1 text-gray-400 hover:text-gray-600"
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                );
              })}
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
      </div>

      {editing !== null && (
        <WalletModal
          key={editing === 'new' ? 'new' : editing.id}
          wallet={editing === 'new' ? null : editing}
          wallets={wallets}
          onClose={() => setEditing(null)}
          onSubmit={async (draft) => {
            const target = editing === 'new' ? null : editing;
            setEditing(null);
            const saved = await onSave(target, draft);
            // 足したばかりの出金元は、そのまま選ぶ。
            if (saved && target === null) onPick(saved.id);
          }}
          onArchive={
            editing === 'new'
              ? undefined
              : () => {
                  const target = editing;
                  setEditing(null);
                  onArchive(target);
                }
          }
        />
      )}
    </StackedScreen>
  );
}

/** 「15」→ 15。1〜31 でなければ null（31 は末日）。 */
const parseDay = (text: string): number | null => {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
};

export function WalletModal({
  wallet,
  wallets,
  onClose,
  onSubmit,
  onArchive,
}: {
  wallet: MoneyWallet | null;
  /** 引き落とし口座の候補に使う。 */
  wallets: MoneyWallet[];
  onClose: () => void;
  onSubmit: (draft: MoneyWalletDraft) => void;
  onArchive?: () => void;
}) {
  const [name, setName] = useState(wallet?.name ?? '');
  const [type, setType] = useState<MoneyWalletType>(wallet?.type ?? 'card');
  const [iconColor, setIconColor] = useState<string | null>(wallet?.iconColor ?? null);
  const [isSaving, setIsSaving] = useState(wallet?.isSaving ?? false);
  const [closeDay, setCloseDay] = useState(wallet?.closeDay ? String(wallet.closeDay) : '');
  const [payDay, setPayDay] = useState(wallet?.payDay ? String(wallet.payDay) : '');
  const [payWalletId, setPayWalletId] = useState<string | null>(wallet?.payWalletId ?? null);
  const [error, setError] = useState<string | null>(null);
  const payChoices = wallets.filter(
    (entry) => entry.type !== 'card' && entry.id !== wallet?.id && (!entry.archived || entry.id === payWalletId),
  );

  const submit = () => {
    if (name.trim() === '') return setError('名前を入れてください');
    const close = closeDay.trim() === '' ? null : parseDay(closeDay);
    const pay = payDay.trim() === '' ? null : parseDay(payDay);
    if (type === 'card' && ((closeDay.trim() !== '' && close === null) || (payDay.trim() !== '' && pay === null))) {
      return setError('締め日・引き落とし日は 1〜31 で入れてください（末日は31）');
    }
    // 貯金は記録なので、貯金用は目印だけ（収支には入れない。月の目標も持たない。docs/kakei.md §4）。
    onSubmit({
      name,
      type,
      isSaving: type !== 'securities' && isSaving,
      savingTarget: type !== 'securities' && isSaving ? (wallet?.savingTarget ?? null) : null,
      closeDay: type === 'card' ? close : null,
      payDay: type === 'card' ? pay : null,
      payWalletId: type === 'card' ? payWalletId : null,
      iconColor,
    });
  };

  const archive = () => {
    if (window.confirm(`${wallet?.name ?? ''}を使わなくしますか？選べなくなりますが、記録には残ります。`)) onArchive?.();
  };

  return (
    <ModalShell
      title={wallet ? '出金元を編集' : '出金元を足す'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <PrimaryButton label="保存する" onClick={submit} />
          {onArchive && (
            <button type="button" onClick={archive} className="w-full py-2 text-sm text-red-500">
              使わなくする
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className={labelClass}>名前</span>
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 〇〇カード（家族）" />
        </label>
        <div>
          <span className={labelClass}>種類</span>
          <div className="flex flex-wrap gap-2">
            {WALLET_TYPES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={type === entry.id}
                onClick={() => setType(entry.id)}
                className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                  type === entry.id ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={labelClass}>アイコンの色</span>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              aria-label="標準の色"
              aria-pressed={iconColor === null}
              onClick={() => setIconColor(null)}
              className={`flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gray-100 ${
                iconColor === null ? 'ring-[3px] ring-gray-900' : ''
              }`}
            >
              <WalletTypeIcon type={type} size={18} />
            </button>
            {WALLET_ICON_COLORS.map((entry) => (
              <button
                key={entry.color}
                type="button"
                aria-label={entry.label}
                aria-pressed={iconColor === entry.color}
                onClick={() => setIconColor(entry.color)}
                style={{ backgroundColor: entry.color }}
                className={`flex h-[34px] w-[34px] items-center justify-center rounded-full ${
                  iconColor === entry.color ? 'ring-[3px] ring-gray-900' : ''
                }`}
              >
                {iconColor === entry.color && <Check size={18} color="#ffffff" />}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">左端は種類ごとの標準の色です</p>
        </div>
        {type !== 'securities' && (
          <label className="flex items-center gap-3">
            <span className="flex-1">
              <span className="block text-xs font-bold text-gray-700">貯金用</span>
              <span className="block text-xs text-gray-400">貯金用の口座の目印です（収支には入れません）</span>
            </span>
            <input type="checkbox" checked={isSaving} onChange={(event) => setIsSaving(event.target.checked)} className="h-5 w-5" />
          </label>
        )}
        {type === 'card' && (
          <>
            <div className="flex gap-3">
              <label className="block flex-1">
                <span className={labelClass}>締め日</span>
                <input
                  className={inputClass}
                  value={closeDay}
                  onChange={(event) => setCloseDay(event.target.value)}
                  inputMode="numeric"
                  placeholder="例: 15（末日は31）"
                />
              </label>
              <label className="block flex-1">
                <span className={labelClass}>引き落とし日</span>
                <input
                  className={inputClass}
                  value={payDay}
                  onChange={(event) => setPayDay(event.target.value)}
                  inputMode="numeric"
                  placeholder="例: 10"
                />
              </label>
            </div>
            <div>
              <span className={labelClass}>引き落とし口座</span>
              <div className="flex flex-wrap gap-2">
                {payChoices.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={payWalletId === entry.id}
                    onClick={() => setPayWalletId(payWalletId === entry.id ? null : entry.id)}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                      payWalletId === entry.id ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {entry.name}
                  </button>
                ))}
                {payChoices.length === 0 && <span className="text-xs text-gray-400">口座を出金元に足すと選べます</span>}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">
                3つそろうと、引き落とし日（休日は翌営業日）に、締め日で区切った1か月分の合計で「口座 → カード」の振替を見込みで作ります
              </p>
            </div>
          </>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
