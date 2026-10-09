'use client';

import { useMemo } from 'react';
import type { MoneyRecord, MoneySecuritiesData, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import { totalDailyBalances } from '@/lib/moneyUtils';
import BalanceTrend from './BalanceTrend';
import { FullScreen, ScreenHeader, type } from './moneyVisual';

// 総残高の推移（docs/kakei.md §9.3）。mobile版の `mobile/src/components/money/TotalTrendScreen.tsx` と同じ並び・文言。
// 「口座」の総残高を押すと開く。使っている出金元の合計（証券口座は評価額。docs/kakei.md §9.2.3）を、日ごとの折れ線と、残高が変わった日の一覧で見る。
// 戻る操作（ブラウザの戻る）でこの画面を閉じる。

interface TotalTrendScreenProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  securities: MoneySecuritiesData;
  today: string;
  onClose: () => void;
}

export default function TotalTrendScreen({ wallets, records, balances, securities, today, onClose }: TotalTrendScreenProps) {
  // 証券の評価額は毎日変わるので、証券口座があるときは「残高が変わった日」の一覧を出さない（毎日の行になる）。
  const hasSecurities = wallets.some((wallet) => wallet.type === 'securities' && !wallet.archived);
  // 証券口座があるときは、評価額の履歴が読めるまで推移を出さない（最新の1行だけで描くと、過去が崩れる）。
  const waiting = hasSecurities && !securities.historyLoaded;
  const points = useMemo(
    () => (waiting ? [] : totalDailyBalances(wallets, records, balances, securities, today)),
    [waiting, wallets, records, balances, securities, today],
  );

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title="残高の推移" icon="back" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8">
        <p className={`${type.sub} py-2.5`}>総残高</p>
        <BalanceTrend points={points} asOf={today} showHistory={!hasSecurities} emptyText={waiting ? '読み込み中...' : undefined} />
      </div>
    </FullScreen>
  );
}
