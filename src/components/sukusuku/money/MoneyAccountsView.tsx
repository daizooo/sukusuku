'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Inbox, Plus } from 'lucide-react';
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
  groupWalletSections,
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
import { cardClass, Hero, incomeAmountClass, type, WalletTypeIcon } from './moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。mobile版の `mobile/src/components/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定。押すと推移）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に補正した残高 + その後の記録（支出・収入・振替）。補正は、通帳・銀行のアプリと違うときに詳細から入れる
// （「未確定」などの印は出さない。2026-10-08に、出しっぱなしでうるさいので外した）。
// 出金元を押すと詳細（履歴 / 推移 / 残高計算）。長押しでつかむと、同じ種類の中で並べ替えられる（2026-10-18。money_wallets.position）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入る（請求済み・未請求の内訳は、押した先の詳細だけに出す）。
// 証券口座の残高は、記録からではなく保有銘柄の評価額（docs/kakei.md §9.2）。押すと証券口座の詳細（推移と保有銘柄）。

interface WalletSection {
  type: (typeof WALLET_TYPES)[number];
  rows: WalletBalanceRow[];
}

interface MoneyAccountsViewProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  securities: MoneySecuritiesData;
  categories: MoneyCategory[];
  isLoading: boolean;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => void;
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
  /** Gmail から取り込んだ明細のうち、片づいていないものの数（docs/kakei.md §9.5.6.1）。0 なら出さない。 */
  feedOpenCount: number;
  onOpenFeed: () => void;
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
  feedOpenCount,
  onOpenFeed,
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
  const sectionBlocks = groupWalletSections(
    WALLET_TYPES.map((walletType) => ({
      type: walletType,
      rows: usable.filter((row) => row.wallet.type === walletType.id),
    })).filter((section) => section.rows.length > 0),
  );
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

  // 出金元の種類ごとの見出し＋タイル。Zaim の「残高」と同じく2列に並べる（2026-10-08）。金額は大きく太く、プラスは緑・マイナスは「−」と黒（2026-10-10）。
  // paired は「1件だけの種類を2つ横に並べた」ときで、タイルは列いっぱいに広げる。
  const renderSection = ({ type: walletType, rows }: WalletSection, paired: boolean) => {
    const sectionKey = `wallets-${walletType.id}`;
    const inType = drag.arrange(
      sectionKey,
      rows.map((row) => ({ ...row, id: row.wallet.id })),
    );
    return (
      <section className="space-y-[3px]">
        <h4 className="flex items-baseline justify-between px-1 text-xs font-bold text-gray-700">
          <span>{walletType.label}</span>
          <span className="tabular-nums text-gray-500">{formatBalance(inType.reduce((sum, row) => sum + row.amount, 0))}</span>
        </h4>
        <div className={`grid gap-1.5 ${paired ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {inType.map((row) => (
            <button
              key={row.wallet.id}
              type="button"
              ref={drag.dragRef(row.wallet.id)}
              {...drag.handleProps(sectionKey, inType, row.wallet.id)}
              onClick={() => setOpenId(row.wallet.id)}
              className={`flex min-w-0 select-none flex-col justify-between gap-0.5 rounded-xl border border-gray-200 bg-white px-2.5 pb-1.5 pt-[7px] text-left hover:bg-gray-50 ${
                drag.isDragging(row.wallet.id) ? 'relative z-20 shadow-lg' : ''
              }`}
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
  };

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
        {feedOpenCount > 0 && (
          <button
            type="button"
            onClick={onOpenFeed}
            className="mx-4 mt-2 flex w-[calc(100%-2rem)] items-center gap-2 rounded-2xl bg-blue-100 px-3.5 py-2.5 text-left text-blue-800 hover:bg-blue-200"
          >
            <Inbox size={18} />
            <span className="text-[15px] font-extrabold">未確認 {feedOpenCount}件</span>
            <span className="flex-1 text-xs">Gmail から取り込んだ明細</span>
            <ChevronRight size={16} />
          </button>
        )}
        {isLoading && <p className="py-4 text-center text-sm text-gray-400">読み込み中...</p>}
        {/* 項目が1つだけの種類（プリペイド・証券など）は、隣り合うもの同士を横に並べて1行にまとめ、高さを縮める。2つ以上になった種類は単独で2列に戻る。 */}
        {sectionBlocks.map((block) =>
          block.length === 1 ? (
            <div key={block[0].type.id} className="mt-2">
              {renderSection(block[0], false)}
            </div>
          ) : (
            <div key={block.map((section) => section.type.id).join('+')} className="mt-2 grid grid-cols-2 gap-1.5">
              {block.map((section) => (
                <div key={section.type.id} className="min-w-0">
                  {renderSection(section, true)}
                </div>
              ))}
            </div>
          ),
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
