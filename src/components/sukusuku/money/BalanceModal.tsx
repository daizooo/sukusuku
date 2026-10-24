'use client';

import { useState } from 'react';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import { dateKeyOfDate, formatBalance, formatSignedYen, formatYen, walletBalanceOn } from '@/lib/moneyUtils';
import { ModalShell } from '../modals/TaskForm';
import { minus, PrimaryButton, type } from './moneyVisual';

// 残高を補正する（docs/kakei.md §9.3）。mobile版の `mobile/src/components/money/BalanceSheet.tsx` と同じ並び・文言。
// 通帳・銀行のアプリの残高を入れる。日付は無い（ただの補正。記録のあとから足した分も、補正は動かない）。
// 入れながら、今の残高（記録から出した額）と差（補正する増減）を出す。差があれば、その分だけ補正する。
// カードの未払いのように、マイナスの残高も入れられる。

interface BalanceModalProps {
  wallet: MoneyWallet;
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  onClose: () => void;
  onSubmit: (adjustment: number, amount: number, showInHistory: boolean) => void;
}

export default function BalanceModal({ wallet, records, balances, onClose, onSubmit }: BalanceModalProps) {
  const today = dateKeyOfDate(new Date());
  const [text, setText] = useState('');
  // カードは未払いの額が残高（マイナス）なので、はじめからマイナスにしておく。
  const [negative, setNegative] = useState(wallet.type === 'card');
  // 補正を口座の履歴に行として残すか。
  const [showInHistory, setShowInHistory] = useState(true);

  const digits = text.replace(/[^0-9]/g, '');
  const entered = digits === '' ? null : (negative ? -1 : 1) * Number(digits);
  const now = walletBalanceOn(wallet.id, today, records, balances);
  const diff = entered === null ? null : entered - now.amount;

  return (
    <ModalShell
      title={`${wallet.name}の残高を補正`}
      onClose={onClose}
      footer={
        <PrimaryButton
          label="補正する"
          disabled={entered === null || diff === 0}
          onClick={() => entered !== null && diff !== null && onSubmit(diff, entered, showInHistory)}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-xs font-bold text-gray-700">通帳・銀行のアプリの残高</span>
          <div className="flex items-center gap-2">
            <div role="tablist" className="flex rounded-full bg-gray-100 p-0.5">
              {[
                { value: false, label: '＋', name: 'プラス' },
                { value: true, label: '−', name: 'マイナス' },
              ].map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  role="tab"
                  aria-label={entry.name}
                  aria-selected={negative === entry.value}
                  onClick={() => setNegative(entry.value)}
                  className={`w-9 rounded-full py-1.5 text-base font-bold ${
                    negative === entry.value ? 'bg-white text-gray-900' : 'text-gray-400'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <span className="text-xl font-bold text-gray-700">¥</span>
            <input
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-[22px] font-bold tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={digits === '' ? '' : Number(digits).toLocaleString('ja-JP')}
              onChange={(event) => setText(event.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
              inputMode="numeric"
              placeholder="0"
              autoFocus
            />
          </div>
        </div>

        <label className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-700">履歴に残す</span>
          <input type="checkbox" checked={showInHistory} onChange={(event) => setShowInHistory(event.target.checked)} className="h-5 w-5" />
        </label>
        <div className="space-y-1 rounded-xl bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className={type.sub}>今の残高</span>
            <span className={minus(type.amount, now.amount < 0)}>{formatBalance(now.amount)}</span>
          </div>
          {diff !== null && (
            <div className="flex items-center justify-between gap-2">
              <span className={type.sub}>差</span>
              <span className={minus(type.amount, diff !== 0)}>{diff === 0 ? formatYen(0) : formatSignedYen(diff)}</span>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
