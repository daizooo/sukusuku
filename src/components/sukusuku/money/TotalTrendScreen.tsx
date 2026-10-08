'use client';

import { useMemo } from 'react';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import { dailyBalances } from '@/lib/moneyUtils';
import BalanceTrend from './BalanceTrend';
import { FullScreen, ScreenHeader, type } from './moneyVisual';

// 総残高の推移（docs/kakei.md §9.3）。mobile版の `mobile/src/components/money/TotalTrendScreen.tsx` と同じ並び・文言。
// 「口座」の総残高を押すと開く。使っている出金元の合計を、日ごとの折れ線と、残高が変わった日の一覧で見る。
// 戻る操作（ブラウザの戻る）でこの画面を閉じる。

interface TotalTrendScreenProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  today: string;
  onClose: () => void;
}

export default function TotalTrendScreen({ wallets, records, balances, today, onClose }: TotalTrendScreenProps) {
  const points = useMemo(
    () =>
      dailyBalances(
        wallets.filter((wallet) => !wallet.archived).map((wallet) => wallet.id),
        records,
        balances,
        today,
      ),
    [wallets, records, balances, today],
  );

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title="残高の推移" icon="back" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8">
        <p className={`${type.sub} py-2.5`}>総残高</p>
        <BalanceTrend points={points} asOf={today} />
      </div>
    </FullScreen>
  );
}
