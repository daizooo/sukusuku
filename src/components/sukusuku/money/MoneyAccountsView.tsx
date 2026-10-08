'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance, MoneyWalletDraft } from '@/types/app';
import {
  buildWalletBalances,
  cardScheduleLabel,
  dateKeyOfDate,
  formatBalance,
  formatShortDate,
  WALLET_TYPES,
  type WalletBalanceRow,
} from '@/lib/moneyUtils';
import WalletBalanceScreen from './WalletBalanceScreen';
import { WalletModal } from './WalletPicker';
import { cardClass, Hero, minus, type, WalletTypeIcon } from './moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。mobile版の `mobile/src/components/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に確定した残高 + その後の記録（支出・収入・振替）。確定がまだなら記録だけから出し、「未確定」と出す。
// 出金元を押すと詳細（残高を確定する・確定の履歴）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入る。

interface MoneyAccountsViewProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  isLoading: boolean;
  onConfirm: (walletId: string, balanceOn: string, amount: number) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onRestoreWallet: (wallet: MoneyWallet) => void;
}

export default function MoneyAccountsView({
  wallets,
  records,
  balances,
  isLoading,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
  onRestoreWallet,
}: MoneyAccountsViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const today = dateKeyOfDate(new Date());
  const summary = useMemo(
    () => buildWalletBalances(wallets, records, balances, today),
    [wallets, records, balances, today],
  );
  const usable = summary.rows.filter((row) => !row.wallet.archived);
  const archived = summary.rows.filter((row) => row.wallet.archived);
  const opened = wallets.find((wallet) => wallet.id === openId) ?? null;

  const status = (row: WalletBalanceRow) =>
    [
      row.confirmed === null ? '未確定' : `${formatShortDate(row.confirmed.balanceOn)} 確定`,
      row.wallet.isSaving ? '貯金用' : '',
      cardScheduleLabel(row.wallet),
    ]
      .filter((part) => part !== '')
      .join('・');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 pt-3">
        <Hero
          label="総残高"
          value={formatBalance(summary.total)}
          isMinus={summary.total < 0}
          note={
            usable.length === 0
              ? '出金元を足すと、残高が出ます'
              : summary.unconfirmed > 0
                ? `未確定の出金元 ${summary.unconfirmed}件は、記録だけから出した額です`
                : '確定した残高 + そのあとの記録'
          }
        />
      </div>
      {/* 右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        {isLoading && <p className="py-4 text-center text-sm text-gray-400">読み込み中...</p>}
        {WALLET_TYPES.map((walletType) => {
          const inType = usable.filter((row) => row.wallet.type === walletType.id);
          if (inType.length === 0) return null;
          return (
            <section key={walletType.id} className="mt-5 space-y-1.5">
              <h4 className="text-[13px] font-bold text-gray-700">{walletType.label}</h4>
              <div className={`${cardClass} overflow-hidden`}>
                {inType.map((row, index) => (
                  <button
                    key={row.wallet.id}
                    type="button"
                    onClick={() => setOpenId(row.wallet.id)}
                    className={`flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-gray-50 ${
                      index > 0 ? 'border-t border-gray-200' : ''
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                      <WalletTypeIcon type={row.wallet.type} size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${type.row}`}>{row.wallet.name}</span>
                      <span className={`block truncate ${row.confirmed === null ? 'text-xs font-medium text-amber-800' : type.sub}`}>
                        {status(row)}
                      </span>
                    </span>
                    <span className={minus(type.amount, row.amount < 0)}>{formatBalance(row.amount)}</span>
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 py-4 text-[15px] font-bold text-blue-600"
        >
          <Plus size={18} />
          出金元を足す
        </button>

        {archived.length > 0 && (
          <section className="mt-5 space-y-1.5">
            <h4 className="text-[13px] font-bold text-gray-700">使わない出金元（記録には残っています）</h4>
            <div className={`${cardClass} overflow-hidden`}>
              {archived.map((row, index) => (
                <div
                  key={row.wallet.id}
                  className={`flex items-center gap-3 px-3.5 py-3 ${index > 0 ? 'border-t border-gray-200' : ''}`}
                >
                  <span className={`min-w-0 flex-1 truncate opacity-70 ${type.row}`}>{row.wallet.name}</span>
                  <button type="button" onClick={() => onRestoreWallet(row.wallet)} className={type.link}>
                    また使う
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {opened !== null && (
        <WalletBalanceScreen
          key={opened.id}
          wallet={opened}
          wallets={wallets}
          records={records}
          balances={balances}
          onClose={() => setOpenId(null)}
          onConfirm={onConfirm}
          onDeleteBalance={onDeleteBalance}
          onSaveWallet={onSaveWallet}
          onArchiveWallet={onArchiveWallet}
        />
      )}
      {adding && (
        <WalletModal
          wallet={null}
          wallets={wallets}
          onClose={() => setAdding(false)}
          onSubmit={(draft) => {
            setAdding(false);
            void onSaveWallet(null, draft);
          }}
        />
      )}
    </div>
  );
}
