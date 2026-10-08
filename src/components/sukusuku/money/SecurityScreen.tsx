'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import type { MoneySecuritiesData, MoneySecurity, MoneySecurityDraft, MoneyWallet } from '@/types/app';
import {
  dateKeyOfDate,
  formatBalance,
  formatQuantity,
  formatSecurityPrice,
  holdingAccountLabel,
  holdingDailyValues,
  securityRows,
} from '@/lib/moneyUtils';
import BalanceTrend from './BalanceTrend';
import SecuritySheet from './SecuritySheet';
import { cardClass, FullScreen, Gain, ScreenHeader, type } from './moneyVisual';

// 銘柄の詳細（docs/kakei.md §9.2.4）。mobile版の `mobile/src/components/money/SecurityScreen.tsx` と同じ並び・文言。
// 上に評価額と推移、下に詳細（評価損益・現在値・取得単価・保有数。保有数は預り区分ごと）。編集は見出しの鉛筆から。

interface SecurityScreenProps {
  wallet: MoneyWallet;
  security: MoneySecurity;
  securities: MoneySecuritiesData;
  onClose: () => void;
  onSave: (draft: MoneySecurityDraft) => void;
  onArchive: () => void;
}

export default function SecurityScreen({ wallet, security, securities, onClose, onSave, onArchive }: SecurityScreenProps) {
  const [editing, setEditing] = useState(false);
  const today = dateKeyOfDate(new Date());
  const row = useMemo(
    () => securityRows(wallet.id, securities, today).find((entry) => entry.security.id === security.id) ?? null,
    [wallet.id, securities, today, security.id],
  );
  const holdings = securities.holdings.filter((holding) => holding.walletId === wallet.id && holding.securityId === security.id);
  const points = useMemo(
    () =>
      holdingDailyValues(
        securities.holdings
          .filter((holding) => holding.walletId === wallet.id && holding.securityId === security.id)
          .map((holding) => holding.id),
        securities.values,
        today,
      ),
    [securities, wallet.id, security.id, today],
  );
  const shown = row?.holdings ?? [];
  const isCash = security.kind === 'cash';
  // 詳細の行（評価損益・現在値・取得単価・保有数。預り金は額だけ）。
  const details: { key: string; label: string; note?: string; value: ReactNode }[] = [];
  if (row?.gain != null) {
    details.push({ key: 'gain', label: '評価損益', value: <Gain gain={row.gain} rate={row.gainRate} /> });
  }
  if (!isCash) {
    details.push({
      key: 'price',
      label: '現在値',
      note: security.kind === 'jp_fund' ? '1万口あたり' : undefined,
      value: <span className={type.amount}>{row?.price != null ? formatSecurityPrice(row.price, security.currency) : '−'}</span>,
    });
    details.push({
      key: 'cost',
      label: '取得単価',
      value: <span className={type.amount}>{row?.costPrice != null ? formatSecurityPrice(row.costPrice, 'JPY') : '−'}</span>,
    });
  }
  for (const holding of shown) {
    details.push({
      key: holding.id,
      label: isCash ? '額' : '保有数',
      note: !isCash && shown.length > 1 ? holdingAccountLabel(holding.account) : undefined,
      value: (
        <span className={type.amount}>
          {isCash ? formatSecurityPrice(holding.quantity, security.currency) : formatQuantity(holding.quantity, security.kind)}
        </span>
      ),
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
        <BalanceTrend points={points} asOf={today} showHistory={false} emptyText="まだ評価額がありません" />
        <div className={`${cardClass} overflow-hidden`}>
          {details.map((detail, index) => (
            <div key={detail.key} className={`flex items-center gap-3 px-3.5 py-3 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className={type.row}>{detail.label}</p>
                {detail.note !== undefined && <p className={type.faint}>{detail.note}</p>}
              </div>
              {detail.value}
            </div>
          ))}
        </div>
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
