'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type {
  MoneyCategory,
  MoneyRecord,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
  SpecialItem,
} from '@/types/app';
import {
  balanceChecks,
  cardBilling,
  cardPaymentHistory,
  cardUsagePeriod,
  dailyBalances,
  dateKeyOfDate,
  formatBalance,
  formatMonthKey,
  formatYen,
  recordsOfWallet,
  walletBalanceOn,
} from '@/lib/moneyUtils';
import BalanceModal from './BalanceModal';
import BalanceTrend from './BalanceTrend';
import RecordDayList from './RecordDayList';
import { EstimateBadge, FullScreen, minus, ScreenHeader, StatRow, type } from './moneyVisual';
import { WalletModal } from './WalletPicker';
import { useSwipeTabs } from '../ui/useSwipeTabs';

// 口座の詳細（docs/kakei.md §9.3）。mobile版の `mobile/src/components/money/WalletBalanceScreen.tsx` と同じ並び・文言。
// 上に残高と「残高を補正」、その下に「履歴 / 推移」の2つ（2026-10-08に、使わない「残高計算」を外した。余計な文字は入れない）。
// - 履歴: その出金元の記録（支出・収入・振替）に、残高の補正を同じ日の先頭に混ぜる。記録を押すと記録の詳細、補正を押すと取り消し
// - 推移: 日ごとの残高の折れ線（期間はじめは全期間）と、残高が変わった日の一覧
//   （カードは推移でなく「引き落とし」: これまでの引き落とし額を、引き落とし月ごとに新しい月から。2026-10-09）
// カードは残高（未払い）の下に「請求済み」と「未請求」を添える（一覧の行には出さず、押したあとのここだけ）。
// 出金元の編集・使わなくするは見出しの鉛筆から。戻る操作（ブラウザの戻る）は、シートを閉じる → この画面を閉じる、の順。

interface WalletBalanceScreenProps {
  wallet: MoneyWallet;
  /** 引き落とし口座の名前を出す・編集の候補に使う。 */
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  categories: MoneyCategory[];
  specialItems: SpecialItem[];
  onClose: () => void;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
}

type Tab = 'history' | 'trend';

const TABS: { id: Tab; label: string }[] = [
  { id: 'history', label: '履歴' },
  { id: 'trend', label: '推移' },
];
/** カードは推移の代わりに、これまでの引き落とし額を見る。 */
const CARD_TABS: { id: Tab; label: string }[] = [
  { id: 'history', label: '履歴' },
  { id: 'trend', label: '引き落とし' },
];

const fullDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${month}月${day}日`;
};
const shortDay = (dateKey: string) => {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}/${day}`;
};
const monthDayLabel = (dateKey: string) => {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日`;
};

export default function WalletBalanceScreen({
  wallet,
  wallets,
  records,
  balances,
  categories,
  specialItems,
  onClose,
  onOpenRecord,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
}: WalletBalanceScreenProps) {
  const [tab, setTab] = useState<Tab>('history');
  const [correcting, setCorrecting] = useState(false);
  const [editing, setEditing] = useState(false);

  const today = dateKeyOfDate(new Date());
  const now = walletBalanceOn(wallet.id, today, records, balances);
  const checks = balanceChecks(wallet.id, records, balances);
  // 履歴に行として出すのは、「履歴に残す」を選んだ補正だけ（残さない補正も、残高の土台としては同じに効く）。
  const shownChecks = checks.filter((check) => check.balance.showInHistory);
  const mine = recordsOfWallet(records, wallet.id);
  const points = dailyBalances([wallet.id], records, balances, today);
  const isCard = wallet.type === 'card';
  const tabs = isCard ? CARD_TABS : TABS;
  const billing = isCard ? cardBilling(wallet, now.amount, records, today) : null;
  const payments = isCard ? cardPaymentHistory(wallet.id, records, today) : [];

  const remove = (balance: MoneyWalletBalance) => {
    if (window.confirm(`${fullDate(balance.balanceOn)}の補正を取り消しますか？残高は、その前の補正と記録から出し直します。`)) {
      onDeleteBalance(balance);
    }
  };

  // 履歴/推移は、帯と中身の上の左右スワイプでも切り替える。
  const { handlers: swipeHandlers, attachContent } = useSwipeTabs(
    tabs.map((entry) => entry.id),
    tab,
    setTab,
  );

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
      <div className="shrink-0 space-y-2 px-4 pb-2.5 pt-3">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className={minus(type.hero, now.amount < 0)}>{formatBalance(now.amount)}</p>
          </div>
          <button
            type="button"
            onClick={() => setCorrecting(true)}
            className="rounded-full bg-blue-100 px-3.5 py-2 text-[13px] font-bold text-blue-800 hover:bg-blue-200"
          >
            残高を補正
          </button>
        </div>
        {billing !== null && billing.billed + billing.unbilled > 0 && (
          <div className="border-t border-gray-200">
            {billing.billed > 0 && (
              <StatRow
                label="請求済み"
                note={billing.payOn ? `${monthDayLabel(billing.payOn)}に引き落とし` : '引き落とし待ち'}
                value={formatBalance(-billing.billed)}
                isMinus
              />
            )}
            {billing.unbilled > 0 && (
              <StatRow
                label="未請求"
                value={formatBalance(-billing.unbilled)}
                isMinus
              />
            )}
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" {...swipeHandlers}>
        <div role="tablist" className="shrink-0 flex border-b border-gray-200 px-2">
          {tabs.map((entry) => {
            const selected = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(entry.id)}
                className="flex flex-1 flex-col items-center pt-2"
              >
                <span className={`text-[15px] ${selected ? 'font-bold text-gray-900' : 'font-semibold text-gray-400'}`}>{entry.label}</span>
                <span className={`mt-2 h-[3px] w-8 rounded-full ${selected ? 'bg-blue-600' : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>

        <div ref={attachContent} className="flex-1 min-h-0 overflow-y-auto px-4 pb-8">
          {tab === 'history' &&
            (mine.length === 0 && shownChecks.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">この出金元の記録はまだありません</p>
            ) : (
              <RecordDayList
                records={mine}
                categories={categories}
                wallets={wallets}
                specialItems={specialItems}
                onOpen={onOpenRecord}
                corrections={shownChecks}
                onOpenCorrection={(check) => remove(check.balance)}
              />
            ))}

          {tab === 'trend' &&
            (isCard ? (
              payments.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">引き落としの記録はまだありません</p>
              ) : (
                <div className="mt-3 divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                  {payments.map((payment) => {
                    const period = cardUsagePeriod(wallet, payment.monthKey);
                    return (
                      <div key={payment.monthKey} className="flex items-center gap-2 px-3.5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className={type.row}>{formatMonthKey(payment.monthKey)}</p>
                          <p className={type.faint}>
                            {period ? `ご利用 ${shortDay(period.from)}〜${shortDay(period.to)}・` : ''}
                            {monthDayLabel(payment.lastOn)}に引き落とし
                          </p>
                        </div>
                        {payment.estimate && <EstimateBadge />}
                        <span className={type.amount}>{formatYen(payment.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <BalanceTrend points={points} asOf={today} />
            ))}
        </div>
      </div>

      {correcting && (
        <BalanceModal
          wallet={wallet}
          records={records}
          balances={balances}
          onClose={() => setCorrecting(false)}
          onSubmit={(balanceOn, amount, showInHistory) => {
            setCorrecting(false);
            onConfirm(wallet.id, balanceOn, amount, showInHistory);
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
