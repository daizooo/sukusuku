'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Pencil, Plus } from 'lucide-react';
import type { MoneySecuritiesData, MoneySecurity, MoneySecurityDraft, MoneyWallet, MoneyWalletDraft } from '@/types/app';
import { dateKeyOfDate, formatBalance, holdingDailyValues, securityRows, walletGain } from '@/lib/moneyUtils';
import BalanceTrend from './BalanceTrend';
import SecurityScreen from './SecurityScreen';
import SecuritySheet from './SecuritySheet';
import { cardClass, FullScreen, Gain, ScreenHeader, SectionHeader, type } from './moneyVisual';
import { WalletModal } from './WalletPicker';

// 証券口座の詳細（docs/kakei.md §9.2.4）。mobile版の `mobile/src/components/money/SecuritiesWalletScreen.tsx` と同じ並び・文言。
// 上に評価額と評価損益、評価額の推移（はじめは全期間。1ヶ月・半年・1年）、下に保有銘柄の一覧
// （銘柄名・評価額・評価損益。Zaim と同じく預り区分ごとに1行・同じ並び）。行を押すと銘柄の詳細。
// 証券口座は記録からではなく評価額で数えるので、補正のボタンは出さない。
// 出金元の編集は見出しの鉛筆から。戻る操作は、シート・銘柄の詳細を閉じる → この画面を閉じる、の順。

interface SecuritiesWalletScreenProps {
  wallet: MoneyWallet;
  wallets: MoneyWallet[];
  securities: MoneySecuritiesData;
  onClose: () => void;
  onSaveWallet: (target: MoneyWallet, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onSaveSecurity: (walletId: string, target: MoneySecurity | null, draft: MoneySecurityDraft) => void;
  onArchiveSecurity: (walletId: string, security: MoneySecurity) => void;
}

export default function SecuritiesWalletScreen({
  wallet,
  wallets,
  securities,
  onClose,
  onSaveWallet,
  onArchiveWallet,
  onSaveSecurity,
  onArchiveSecurity,
}: SecuritiesWalletScreenProps) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const today = dateKeyOfDate(new Date());
  const rows = useMemo(() => securityRows(wallet.id, securities, today), [wallet.id, securities, today]);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const gain = walletGain(rows);
  const points = useMemo(
    () =>
      holdingDailyValues(
        securities.holdings.filter((holding) => holding.walletId === wallet.id).map((holding) => holding.id),
        securities.values,
        today,
      ),
    [wallet.id, securities, today],
  );
  const opened = rows.find((row) => row.holding.id === openId) ?? null;

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
      <div className="shrink-0 space-y-1 px-4 pb-3 pt-3">
        <p className={type.hero}>{formatBalance(total)}</p>
        {gain !== null && <Gain gain={gain.gain} rate={gain.rate} />}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8 pt-2">
        <BalanceTrend points={points} asOf={today} showHistory={false} emptyText="まだ評価額がありません" />

        <SectionHeader title="保有銘柄" />
        {rows.length > 0 && (
          <div className={`${cardClass} overflow-hidden`}>
            {rows.map((row, index) => (
              <button
                key={row.holding.id}
                type="button"
                onClick={() => setOpenId(row.holding.id)}
                className={`flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-gray-50 ${
                  index > 0 ? 'border-t border-gray-200' : ''
                }`}
              >
                <span className={`${type.row} line-clamp-2 min-w-0 flex-1`}>{row.security.name}</span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={type.amount}>{formatBalance(row.value)}</span>
                  {row.gain !== null && <Gain gain={row.gain} rate={row.gainRate} size="sub" />}
                </span>
                <ChevronRight size={16} className="shrink-0 text-gray-400" />
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-2 py-4 text-[15px] font-bold text-blue-600">
          <Plus size={18} />
          銘柄を足す
        </button>
      </div>

      {opened !== null && (
        <SecurityScreen
          key={opened.holding.id}
          wallet={wallet}
          holding={opened.holding}
          security={opened.security}
          securities={securities}
          onClose={() => setOpenId(null)}
          onSave={(draft) => onSaveSecurity(wallet.id, opened.security, draft)}
          onArchive={() => {
            setOpenId(null);
            onArchiveSecurity(wallet.id, opened.security);
          }}
        />
      )}
      {adding && (
        <SecuritySheet
          security={null}
          holdings={[]}
          onClose={() => setAdding(false)}
          onSubmit={(draft) => {
            setAdding(false);
            onSaveSecurity(wallet.id, null, draft);
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
