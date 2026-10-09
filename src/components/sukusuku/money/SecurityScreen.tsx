'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import type { MoneyHolding, MoneySecuritiesData, MoneySecurity, MoneySecurityDraft, MoneyWallet } from '@/types/app';
import {
  dateKeyOfDate,
  formatBalance,
  formatQuantity,
  formatYen,
  holdingDailyValues,
  securityRows,
} from '@/lib/moneyUtils';
import BalanceTrend from './BalanceTrend';
import SecuritySheet from './SecuritySheet';
import { cardClass, FullScreen, Gain, ScreenHeader, type } from './moneyVisual';

// 銘柄の詳細（docs/kakei.md §9.2.4）。mobile版の `mobile/src/components/money/SecurityScreen.tsx` と同じ並び・文言。
// Zaim と同じく保有（預り区分）ごとに開く。上に評価額と推移、下に詳細（評価損益・現在値（投信は基準価額）・取得単価・
// 保有株数（投信は保有口数）。金額はすべて円）。預り金は推移だけ。編集は見出しの鉛筆から（その銘柄の預り区分をまとめて直す）。

interface SecurityScreenProps {
  wallet: MoneyWallet;
  holding: MoneyHolding;
  security: MoneySecurity;
  securities: MoneySecuritiesData;
  onClose: () => void;
  onSave: (draft: MoneySecurityDraft) => void;
  onArchive: () => void;
}

export default function SecurityScreen({ wallet, holding, security, securities, onClose, onSave, onArchive }: SecurityScreenProps) {
  const [editing, setEditing] = useState(false);
  const today = dateKeyOfDate(new Date());
  const row = useMemo(
    () => securityRows(wallet.id, securities, today).find((entry) => entry.holding.id === holding.id) ?? null,
    [wallet.id, securities, today, holding.id],
  );
  const holdings = securities.holdings.filter((entry) => entry.walletId === wallet.id && entry.securityId === security.id);
  const points = useMemo(
    () => (securities.historyLoaded ? holdingDailyValues([holding.id], securities.values, today) : []),
    [holding.id, securities, today],
  );
  const isFund = security.kind === 'jp_fund';
  // 詳細の行（Zaim と同じ項目。預り金は無し）。
  const details: { key: string; label: string; value: ReactNode }[] = [];
  if (security.kind !== 'cash') {
    if (row?.gain != null) {
      details.push({ key: 'gain', label: '評価損益', value: <Gain gain={row.gain} rate={row.gainRate} /> });
    }
    details.push({
      key: 'price',
      label: isFund ? '基準価額' : '現在値',
      value: <span className={type.amount}>{row?.price != null ? formatYen(Math.round(row.price)) : '−'}</span>,
    });
    details.push({
      key: 'cost',
      label: '取得単価',
      value: <span className={type.amount}>{holding.costPrice !== null ? formatYen(Math.round(holding.costPrice)) : '−'}</span>,
    });
    details.push({
      key: 'quantity',
      label: isFund ? '保有口数' : '保有株数',
      value: <span className={type.amount}>{formatQuantity(holding.quantity)}</span>,
    });
  }

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader
        title={security.name}
        icon="back"
        onClose={onClose}
        right={
          <button type="button" aria-label={`${security.name}を編集`} onClick={() => setEditing(true)} className="text-gray-700">
            <Pencil size={20} />
          </button>
        }
      />
      <div className="shrink-0 space-y-1 px-4 pb-3 pt-3">
        <p className={type.hero}>{formatBalance(row?.value ?? 0)}</p>
        {row?.gain != null && <Gain gain={row.gain} rate={row.gainRate} />}
      </div>
      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto px-4 pb-8 pt-2">
        <BalanceTrend
          points={points}
          asOf={today}
          showHistory={false}
          emptyText={securities.historyLoaded ? 'まだ評価額がありません' : '読み込み中...'}
        />
        {details.length > 0 && (
          <div className={`${cardClass} overflow-hidden`}>
            {details.map((detail, index) => (
              <div key={detail.key} className={`flex items-center gap-3 px-3.5 py-3 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className={type.row}>{detail.label}</p>
                </div>
                {detail.value}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <SecuritySheet
          security={security}
          holdings={holdings}
          onClose={() => setEditing(false)}
          onSubmit={(draft) => {
            setEditing(false);
            onSave(draft);
          }}
          onArchive={() => {
            setEditing(false);
            onArchive();
          }}
        />
      )}
    </FullScreen>
  );
}
