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
} from '@/types/app';
import {
  buildWalletBalances,
  dateKeyOfDate,
  formatBalance,
  reorderedPositions,
  WALLET_DELETE_NOTE,
  WALLET_TYPES,
  type WalletBalanceRow,
} from '@/lib/moneyUtils';
import { useDragReorder } from '../ui/useDragReorder';
import SecuritiesWalletScreen from './SecuritiesWalletScreen';
import TotalTrendScreen from './TotalTrendScreen';
import WalletBalanceScreen from './WalletBalanceScreen';
import { WalletModal } from './WalletPicker';
import { cardClass, FitText, incomeAmountClass, type, WalletTypeIcon } from './moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。mobile版の `mobile/src/components/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定。押すと推移）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に補正した残高 + その後の記録（支出・収入・振替）。補正は、通帳・銀行のアプリと違うときに詳細から入れる
// （「未確定」などの印は出さない。2026-10-08に、出しっぱなしでうるさいので外した）。
// 出金元を押すと詳細（履歴 / 推移 / 残高計算）。長押しでつかむと、同じ種類の中で並べ替えられる（2026-10-18。money_wallets.position）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入る（請求済み・未請求の内訳は、押した先の詳細だけに出す）。
// 証券口座の残高は、記録からではなく保有銘柄の評価額（docs/kakei.md §9.2）。押すと証券口座の詳細（推移と保有銘柄）。

interface MoneyAccountsViewProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  securities: MoneySecuritiesData;
  categories: MoneyCategory[];
  isLoading: boolean;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, adjustment: number, amount: number, showInHistory: boolean) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onDeleteWallet: (wallet: MoneyWallet) => void;
  onRestoreWallet: (wallet: MoneyWallet) => void;
  /** 種類の中の並びを動かしたあと。変わった出金元の position。 */
  onReorderWallets: (changes: { id: string; position: number }[]) => void;
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
  isLoading,
  onOpenRecord,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onDeleteWallet,
  onRestoreWallet,
  onReorderWallets,
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
  const drag = useDragReorder((_sectionKey, orderedIds) => {
    const changes = reorderedPositions(wallets, orderedIds);
    if (changes.length > 0) onReorderWallets(changes);
  });
  const opened = wallets.find((wallet) => wallet.id === openId) ?? null;
  const needsHistory =
    (opened !== null && opened.type === 'securities') ||
    (showTrend && wallets.some((wallet) => wallet.type === 'securities' && !wallet.archived));
  useEffect(() => {
    if (needsHistory && !securities.historyLoaded) void onNeedSecurityHistory();
  }, [needsHistory, securities.historyLoaded, onNeedSecurityHistory]);

  // 出金元のタイル。Zaim の「残高」と同じく2列に並べる（2026-10-08）。金額は大きく太く、プラスは緑・マイナスは「−」と黒（2026-10-10）。
  // 種類ごとの見出し・合計は出さず、種類の区切りも空けずに1つの2列に詰める（2026-10-24）。並びは種類の順（WALLET_TYPES）。
  // 長押しの並べ替えは、これまでどおり同じ種類の中だけ。
  const groups = WALLET_TYPES.map((walletType) => {
    const sectionKey = `wallets-${walletType.id}`;
    const rows = drag.arrange(
      sectionKey,
      usable.filter((row) => row.wallet.type === walletType.id).map((row) => ({ ...row, id: row.wallet.id })),
    );
    return { sectionKey, rows };
  });
  const renderTile = (sectionKey: string, inType: (WalletBalanceRow & { id: string })[], row: WalletBalanceRow) => (
    <button
      key={row.wallet.id}
      type="button"
      ref={drag.dragRef(row.wallet.id)}
      {...drag.handleProps(sectionKey, inType, row.wallet.id)}
      onClick={() => setOpenId(row.wallet.id)}
      className={`flex min-w-0 select-none flex-col justify-between gap-1 rounded-[14px] bg-white px-3 pb-2 pt-2.5 text-left shadow-sm hover:bg-gray-50 ${
        drag.isDragging(row.wallet.id) ? 'relative z-20 shadow-lg' : ''
      }`}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <span className="shrink-0">
          <WalletTypeIcon type={row.wallet.type} size={20} color={row.wallet.iconColor} />
        </span>
        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-bold leading-[18px] text-gray-900">{row.wallet.name}</span>
      </span>
      <span className={`block w-full text-right text-[22px] font-extrabold tabular-nums ${row.amount > 0 ? incomeAmountClass : 'text-gray-900'}`}>
        <FitText>{formatBalance(row.amount)}</FitText>
      </span>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 総残高も一覧と一緒に流れる（固定しない。2026-10-08）。右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-36">
        <button
          type="button"
          aria-label="総残高の推移を見る"
          onClick={() => setShowTrend(true)}
          disabled={usable.length === 0}
          className="mt-2 block w-full rounded-2xl bg-white py-3.5 text-center shadow-sm hover:bg-gray-50"
        >
          {/* 総残高は白い札に大きく。口座のタイルより一段強く見せる（Zaim の「残高」と同じ。2026-10-24）。 */}
          <span className="block text-sm font-bold text-gray-500">総残高</span>
          <span className="block text-[40px] font-extrabold leading-tight tabular-nums text-gray-900">
            <FitText>{formatBalance(summary.total)}</FitText>
          </span>
          {usable.length === 0 && <span className={`block ${type.sub}`}>出金元を足すと、残高が出ます</span>}
        </button>
        {isLoading && <p className="py-4 text-center text-sm text-gray-400">読み込み中...</p>}
        {usable.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {groups.flatMap(({ sectionKey, rows }) => rows.map((row) => renderTile(sectionKey, rows, row)))}
          </div>
        )}

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
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`${row.wallet.name}を削除しますか？${WALLET_DELETE_NOTE}`)) onDeleteWallet(row.wallet);
                    }}
                    className="text-[13px] font-bold text-red-500"
                  >
                    削除
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
          onDeleteWallet={onDeleteWallet}
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
          onClose={() => setOpenId(null)}
          onOpenRecord={onOpenRecord}
          onConfirm={onConfirm}
          onDeleteBalance={onDeleteBalance}
          onSaveWallet={onSaveWallet}
          onDeleteWallet={onDeleteWallet}
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
