'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type {
  MoneyCategory,
  MoneyRecord,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
  SpecialItem,
} from '@/types/app';
import {
  buildWalletBalances,
  cardBilling,
  cardScheduleLabel,
  dateKeyOfDate,
  formatBalance,
  formatYen,
  WALLET_TYPES,
  type WalletBalanceRow,
} from '@/lib/moneyUtils';
import TotalTrendScreen from './TotalTrendScreen';
import WalletBalanceScreen from './WalletBalanceScreen';
import { WalletModal } from './WalletPicker';
import { cardClass, Hero, minus, type, WalletTypeIcon } from './moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。mobile版の `mobile/src/components/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定。押すと推移）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に補正した残高 + その後の記録（支出・収入・振替）。補正は、通帳・銀行のアプリと違うときに詳細から入れる
// （「未確定」などの印は出さない。2026-10-08に、出しっぱなしでうるさいので外した）。
// 出金元を押すと詳細（履歴 / 推移 / 残高計算）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入り、請求済み（引き落とし待ち）と未請求に分けて添える。
// 証券口座は、銘柄ごとの評価額（docs/kakei.md §9.2）ができるまでは入らない。

interface MoneyAccountsViewProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  categories: MoneyCategory[];
  specialItems: SpecialItem[];
  isLoading: boolean;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onRestoreWallet: (wallet: MoneyWallet) => void;
}

const shortDay = (dateKey: string) => {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}/${day}`;
};

export default function MoneyAccountsView({
  wallets,
  records,
  balances,
  categories,
  specialItems,
  isLoading,
  onOpenRecord,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
  onRestoreWallet,
}: MoneyAccountsViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const today = dateKeyOfDate(new Date());
  const summary = useMemo(
    () => buildWalletBalances(wallets, records, balances, today),
    [wallets, records, balances, today],
  );
  const usable = summary.rows.filter((row) => !row.wallet.archived);
  const archived = summary.rows.filter((row) => row.wallet.archived);
  const opened = wallets.find((wallet) => wallet.id === openId) ?? null;

  const status = (row: WalletBalanceRow) =>
    [row.wallet.isSaving ? '貯金用' : '', cardScheduleLabel(row.wallet)].filter((part) => part !== '').join('・');
  /** カードの残高に添える、請求済み（引き落とし待ち）と未請求の2行。締め日が未設定なら出さない。 */
  const billingLines = (row: WalletBalanceRow): string[] => {
    if (row.wallet.type !== 'card') return [];
    const billing = cardBilling(row.wallet, row.amount, records, today);
    if (billing === null || billing.billed + billing.unbilled === 0) return [];
    // 0円の行は出さない（引き落としの直後は請求済みが0、締め日の直後は未請求が0）。
    return [
      ...(billing.billed > 0 ? [`請求済み ${formatYen(billing.billed)}${billing.payOn ? `（${shortDay(billing.payOn)}）` : ''}`] : []),
      ...(billing.unbilled > 0 ? [`未請求 ${formatYen(billing.unbilled)}`] : []),
    ];
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        aria-label="総残高の推移を見る"
        onClick={() => setShowTrend(true)}
        disabled={usable.length === 0}
        className="shrink-0 pt-3 text-left"
      >
        <Hero
          label="総残高"
          value={formatBalance(summary.total)}
          isMinus={summary.total < 0}
          note={usable.length === 0 ? '出金元を足すと、残高が出ます' : '押すと推移'}
        />
      </button>
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
                      {status(row) !== '' && <span className={`block truncate ${type.sub}`}>{status(row)}</span>}
                      {billingLines(row).map((line) => (
                        <span key={line} className={`block ${type.sub}`}>
                          {line}
                        </span>
                      ))}
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
          categories={categories}
          specialItems={specialItems}
          onClose={() => setOpenId(null)}
          onOpenRecord={onOpenRecord}
          onConfirm={onConfirm}
          onDeleteBalance={onDeleteBalance}
          onSaveWallet={onSaveWallet}
          onArchiveWallet={onArchiveWallet}
        />
      )}
      {showTrend && (
        <TotalTrendScreen wallets={wallets} records={records} balances={balances} today={today} onClose={() => setShowTrend(false)} />
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
