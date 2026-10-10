'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type {
  MoneyCategory,
  MoneyRecord,
  MoneySecuritiesData,
  MoneySecurity,
  MoneySecurityDraft,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
  SpecialItem,
} from '@/types/app';
import {
  buildWalletBalances,
  dateKeyOfDate,
  formatBalance,
  WALLET_TYPES,
} from '@/lib/moneyUtils';
import SecuritiesWalletScreen from './SecuritiesWalletScreen';
import TotalTrendScreen from './TotalTrendScreen';
import WalletBalanceScreen from './WalletBalanceScreen';
import { WalletModal } from './WalletPicker';
import { cardClass, Hero, incomeAmountClass, type, WalletTypeIcon } from './moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。mobile版の `mobile/src/components/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定。押すと推移）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に補正した残高 + その後の記録（支出・収入・振替）。補正は、通帳・銀行のアプリと違うときに詳細から入れる
// （「未確定」などの印は出さない。2026-10-08に、出しっぱなしでうるさいので外した）。
// 出金元を押すと詳細（履歴 / 推移 / 残高計算）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入る（請求済み・未請求の内訳は、押した先の詳細だけに出す）。
// 証券口座の残高は、記録からではなく保有銘柄の評価額（docs/kakei.md §9.2）。押すと証券口座の詳細（推移と保有銘柄）。

interface MoneyAccountsViewProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  securities: MoneySecuritiesData;
  categories: MoneyCategory[];
  specialItems: SpecialItem[];
  isLoading: boolean;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onRestoreWallet: (wallet: MoneyWallet) => void;
  onSaveSecurity: (walletId: string, target: MoneySecurity | null, draft: MoneySecurityDraft) => void;
  onArchiveSecurity: (walletId: string, security: MoneySecurity) => void;
  /** 推移・証券口座の詳細を開いたときに、評価額の履歴を読ませる（一覧は最新の1行だけで出す）。 */
  onNeedSecurityHistory: () => void | Promise<void>;
}

export default function MoneyAccountsView({
  wallets,
  records,
  balances,
  securities,
  categories,
  specialItems,
  isLoading,
  onOpenRecord,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
  onRestoreWallet,
  onSaveSecurity,
  onArchiveSecurity,
  onNeedSecurityHistory,
}: MoneyAccountsViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const today = dateKeyOfDate(new Date());
  const summary = useMemo(
    () => buildWalletBalances(wallets, records, balances, today, securities),
    [wallets, records, balances, today, securities],
  );
  const usable = summary.rows.filter((row) => !row.wallet.archived);
  const archived = summary.rows.filter((row) => row.wallet.archived);
  const opened = wallets.find((wallet) => wallet.id === openId) ?? null;
  const needsHistory =
    (opened !== null && opened.type === 'securities') ||
    (showTrend && wallets.some((wallet) => wallet.type === 'securities' && !wallet.archived));
  useEffect(() => {
    if (needsHistory && !securities.historyLoaded) void onNeedSecurityHistory();
  }, [needsHistory, securities.historyLoaded, onNeedSecurityHistory]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 総残高も一覧と一緒に流れる（固定しない。2026-10-08）。右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        <button
          type="button"
          aria-label="総残高の推移を見る"
          onClick={() => setShowTrend(true)}
          disabled={usable.length === 0}
          className="block w-full pt-1.5 text-left"
        >
          <Hero
            center
            label="総残高"
            value={formatBalance(summary.total)}
            compact
            note={usable.length === 0 ? '出金元を足すと、残高が出ます' : undefined}
          />
        </button>
        {isLoading && <p className="py-4 text-center text-sm text-gray-400">読み込み中...</p>}
        {WALLET_TYPES.map((walletType) => {
          const inType = usable.filter((row) => row.wallet.type === walletType.id);
          if (inType.length === 0) return null;
          return (
            <section key={walletType.id} className="mt-2 space-y-[3px]">
              <h4 className="flex items-baseline justify-between px-1 text-xs font-bold text-gray-700">
                <span>{walletType.label}</span>
                <span className="tabular-nums text-gray-500">{formatBalance(inType.reduce((sum, row) => sum + row.amount, 0))}</span>
              </h4>
              {/* Zaim の「残高」と同じく2列に並べる（2026-10-08）。金額は大きく太く、プラスは緑・マイナスは「−」と黒（2026-10-10）。 */}
              <div className="grid grid-cols-2 gap-1.5">
                {inType.map((row) => (
                  <button
                    key={row.wallet.id}
                    type="button"
                    onClick={() => setOpenId(row.wallet.id)}
                    className="flex min-w-0 flex-col justify-between gap-0.5 rounded-xl border border-gray-200 bg-white px-2.5 pb-1.5 pt-[7px] text-left hover:bg-gray-50"
                  >
                    <span className="flex min-w-0 items-start gap-1.5">
                      <span className="shrink-0">
                        <WalletTypeIcon type={row.wallet.type} size={20} color={row.wallet.iconColor} />
                      </span>
                      <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-bold leading-4 text-gray-500">{row.wallet.name}</span>
                    </span>
                    <span
                      className={`self-end text-[21px] font-extrabold tabular-nums ${row.amount > 0 ? incomeAmountClass : 'text-gray-900'}`}
                    >
                      {formatBalance(row.amount)}
                    </span>
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

      {opened !== null && opened.type === 'securities' && (
        <SecuritiesWalletScreen
          key={opened.id}
          wallet={opened}
          wallets={wallets}
          securities={securities}
          onClose={() => setOpenId(null)}
          onSaveWallet={onSaveWallet}
          onArchiveWallet={onArchiveWallet}
          onSaveSecurity={onSaveSecurity}
          onArchiveSecurity={onArchiveSecurity}
        />
      )}
      {opened !== null && opened.type !== 'securities' && (
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
        <TotalTrendScreen
          wallets={wallets}
          records={records}
          balances={balances}
          securities={securities}
          today={today}
          onClose={() => setShowTrend(false)}
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
