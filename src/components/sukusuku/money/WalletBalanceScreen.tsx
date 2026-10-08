'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
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
  cardScheduleLabel,
  dailyBalances,
  dateKeyOfDate,
  formatBalance,
  formatSignedYen,
  recordsOfWallet,
  walletBalanceOn,
  walletTypeLabel,
} from '@/lib/moneyUtils';
import BalanceModal from './BalanceModal';
import BalanceTrend from './BalanceTrend';
import RecordDayList from './RecordDayList';
import { cardClass, FullScreen, Hero, minus, PrimaryButton, ScreenHeader, SectionHeader, StatRow, type, WalletTypeIcon } from './moneyVisual';
import { WalletModal } from './WalletPicker';

// 口座の詳細（docs/kakei.md §9.3）。mobile版の `mobile/src/components/money/WalletBalanceScreen.tsx` と同じ並び・文言。
// Zaim の口座と同じく「履歴 / 推移 / 残高計算」の3つ。
// - 履歴: その出金元の記録（支出・収入・振替）。押すと記録の詳細
// - 推移: 日ごとの残高の折れ線（期間はじめは全期間）と、残高が変わった日の一覧
// - 残高計算: 残高 ＝ 最後に補正した残高 + そのあとの記録。通帳・銀行のアプリと違うときは「残高を補正する」。
//   カードは残高（未払い）を「請求済み」と「未請求」に分けて出す
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
  onConfirm: (walletId: string, balanceOn: string, amount: number) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
}

type Tab = 'history' | 'trend' | 'calc';

const TABS: { id: Tab; label: string }[] = [
  { id: 'history', label: '履歴' },
  { id: 'trend', label: '推移' },
  { id: 'calc', label: '残高計算' },
];

const fullDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${month}月${day}日`;
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
  const mine = recordsOfWallet(records, wallet.id);
  const points = dailyBalances([wallet.id], records, balances, today);
  const billing = wallet.type === 'card' ? cardBilling(wallet, now.amount, records, today) : null;
  const payWallet = wallets.find((entry) => entry.id === wallet.payWalletId) ?? null;

  const remove = (balance: MoneyWalletBalance) => {
    if (window.confirm(`${fullDate(balance.balanceOn)}の補正を取り消しますか？残高は、その前の補正と記録から出し直します。`)) {
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
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5">
        <WalletTypeIcon type={wallet.type} size={16} />
        <span className={`min-w-0 flex-1 truncate ${type.sub}`}>
          {[walletTypeLabel(wallet.type), wallet.isSaving ? '貯金用' : '', cardScheduleLabel(wallet), payWallet ? `${payWallet.name}から引き落とし` : '']
            .filter((part) => part !== '')
            .join('・')}
        </span>
        <span className={minus(type.amount, now.amount < 0)}>{formatBalance(now.amount)}</span>
      </div>
      <div role="tablist" className="shrink-0 flex border-b border-gray-200 px-2">
        {TABS.map((entry) => {
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

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8">
        {tab === 'history' &&
          (mine.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">この出金元の記録はまだありません</p>
          ) : (
            <RecordDayList records={mine} categories={categories} wallets={wallets} specialItems={specialItems} onOpen={onOpenRecord} />
          ))}

        {tab === 'trend' && <BalanceTrend points={points} asOf={today} />}

        {tab === 'calc' && (
          <div className="space-y-3 pt-3">
            <Hero
              label="残高"
              value={formatBalance(now.amount)}
              isMinus={now.amount < 0}
              note={
                now.confirmed === null
                  ? '記録の合計です。記録は使い始めからなので、いまの残高を入れて合わせてください'
                  : `${fullDate(now.confirmed.balanceOn)}に補正した ${formatBalance(now.confirmed.amount)} に、そのあとの記録${now.count}件（${formatSignedYen(now.movement)}）を足した額`
              }
            >
              {billing !== null && billing.billed + billing.unbilled > 0 && (
                <>
                  <StatRow
                    label="請求済み"
                    note={billing.payOn ? `${monthDayLabel(billing.payOn)}に引き落とし` : '引き落とし待ち'}
                    value={formatBalance(-billing.billed)}
                    isMinus={billing.billed > 0}
                  />
                  <StatRow
                    label="未請求"
                    note={`${monthDayLabel(billing.closedOn)}の締め日のあとの利用`}
                    value={formatBalance(-billing.unbilled)}
                    isMinus={billing.unbilled > 0}
                  />
                </>
              )}
            </Hero>
            <PrimaryButton label="残高を補正する" onClick={() => setCorrecting(true)} />

            <SectionHeader title="補正の履歴" hint="通帳・銀行のアプリと違うときに入れます" />
            {checks.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">まだ補正していません</p>
            ) : (
              <div className={`${cardClass} overflow-hidden`}>
                {checks.map((check, index) => (
                  <div
                    key={check.balance.id}
                    className={`flex items-center gap-3 px-3.5 py-3 ${index > 0 ? 'border-t border-gray-200' : ''}`}
                  >
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
                      aria-label={`${monthDayLabel(check.balance.balanceOn)}の補正を取り消す`}
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
        )}
      </div>

      {correcting && (
        <BalanceModal
          wallet={wallet}
          records={records}
          balances={balances}
          onClose={() => setCorrecting(false)}
          onSubmit={(balanceOn, amount) => {
            setCorrecting(false);
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
