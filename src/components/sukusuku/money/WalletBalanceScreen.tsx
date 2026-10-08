'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance, MoneyWalletDraft } from '@/types/app';
import {
  balanceChecks,
  cardScheduleLabel,
  dateKeyOfDate,
  formatBalance,
  formatShortDate,
  formatSignedYen,
  walletBalanceOn,
  walletTypeLabel,
} from '@/lib/moneyUtils';
import BalanceModal from './BalanceModal';
import { cardClass, FullScreen, Hero, minus, PrimaryButton, ScreenHeader, SectionHeader, type, WalletTypeIcon } from './moneyVisual';
import { WalletModal } from './WalletPicker';

// 口座の詳細（docs/kakei.md §9.3）。mobile版の `mobile/src/components/money/WalletBalanceScreen.tsx` と同じ並び・文言。
// 残高（確定した残高 + その後の記録）、「残高を確定する」、確定の履歴（記録との差つき）、出金元の編集・使わなくする。
// 戻る操作（ブラウザの戻る）は、シートを閉じる → この画面を閉じる、の順。

interface WalletBalanceScreenProps {
  wallet: MoneyWallet;
  /** 引き落とし口座の名前を出す・編集の候補に使う。 */
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  onClose: () => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
}

const fullDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${month}月${day}日`;
};

export default function WalletBalanceScreen({
  wallet,
  wallets,
  records,
  balances,
  onClose,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
}: WalletBalanceScreenProps) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  const now = walletBalanceOn(wallet.id, dateKeyOfDate(new Date()), records, balances);
  const checks = balanceChecks(wallet.id, records, balances);
  const payWallet = wallets.find((entry) => entry.id === wallet.payWalletId) ?? null;
  const schedule = cardScheduleLabel(wallet);

  const remove = (balance: MoneyWalletBalance) => {
    if (window.confirm(`${fullDate(balance.balanceOn)}の確定を取り消しますか？残高は、その前の確定と記録から出し直します。`)) {
      onDeleteBalance(balance);
    }
  };

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader
        title={wallet.name}
        icon="back"
        onClose={onClose}
        right={
          <button type="button" aria-label={`${wallet.name}を編集`} onClick={() => setEditing(true)} className="text-gray-700">
            <Pencil size={20} />
          </button>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 p-4 pb-8">
        <div className="flex items-center gap-2">
          <WalletTypeIcon type={wallet.type} size={16} />
          <span className={type.sub}>
            {[walletTypeLabel(wallet.type), wallet.isSaving ? '貯金用' : '', schedule, payWallet ? `${payWallet.name}から引き落とし` : '']
              .filter((part) => part !== '')
              .join('・')}
          </span>
        </div>

        <Hero
          label="残高"
          value={formatBalance(now.amount)}
          isMinus={now.amount < 0}
          note={
            now.confirmed === null
              ? 'まだ確定していません。記録だけから出した額です'
              : `${fullDate(now.confirmed.balanceOn)}に確定した ${formatBalance(now.confirmed.amount)} に、そのあとの記録${now.count}件（${formatSignedYen(now.movement)}）を足した額`
          }
        />
        <PrimaryButton label="残高を確定する" onClick={() => setConfirming(true)} />

        <SectionHeader title="確定の履歴" hint="月に1回、通帳・銀行のアプリの残高を入れます" />
        {checks.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">まだ確定していません</p>
        ) : (
          <div className={`${cardClass} overflow-hidden`}>
            {checks.map((check, index) => (
              <div key={check.balance.id} className={`flex items-center gap-3 px-3.5 py-3 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className={type.row}>{fullDate(check.balance.balanceOn)}</p>
                  <p className={minus(type.sub, check.diff !== null && check.diff !== 0)}>
                    {check.diff === null
                      ? 'はじめの残高'
                      : check.diff === 0
                        ? `記録と合っていました（${formatBalance(check.expected)}）`
                        : `記録との差 ${formatSignedYen(check.diff)}（記録では ${formatBalance(check.expected)}）`}
                  </p>
                </div>
                <span className={minus(type.amount, check.balance.amount < 0)}>{formatBalance(check.balance.amount)}</span>
                <button
                  type="button"
                  aria-label={`${formatShortDate(check.balance.balanceOn)}の確定を取り消す`}
                  onClick={() => remove(check.balance)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirming && (
        <BalanceModal
          wallet={wallet}
          records={records}
          balances={balances}
          onClose={() => setConfirming(false)}
          onSubmit={(balanceOn, amount) => {
            setConfirming(false);
            onConfirm(wallet.id, balanceOn, amount);
          }}
        />
      )}
      {editing && (
        <WalletModal
          wallet={wallet}
          wallets={wallets}
          onClose={() => setEditing(false)}
          onSubmit={(draft) => {
            setEditing(false);
            void onSaveWallet(wallet, draft);
          }}
          onArchive={() => {
            setEditing(false);
            onArchiveWallet(wallet);
            onClose();
          }}
        />
      )}
    </FullScreen>
  );
}
