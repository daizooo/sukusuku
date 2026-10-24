'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronRight, Plus } from 'lucide-react';
import type { FamilyMember, MoneyCategory, MoneyMonthWalletCheck, MoneyRecord, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import type { CardMonthChecks } from '@/lib/moneyFeedUtils';
import { formatBalance, formatYen } from '@/lib/moneyUtils';
import { allOk, closeFigure, closeFigureLabel, closeRecords, closeWallets, okUsers } from '@/lib/moneyClose';
import RecordDayList, { type RecordClosing } from './RecordDayList';
import BalanceModal from './BalanceModal';
import { FullScreen, PrimaryButton, ScreenHeader, WalletTypeIcon, cardClass } from './moneyVisual';

// 月の締め（docs/kakei.md §4.5。2026-10-24に作り直した）。mobile版の `mobile/src/components/money/MonthCloseScreen.tsx` と同じ並び・文言。
//
// 締めは、銀行口座・カード・家族の財布のそれぞれについて、その月の入出金を振り返りながら、残高（カードはその月の利用残高）が
// 合っているかを夫婦で確かめる作業。収支は出さない（締めたあとの月の振り返りで見る）。
// - 開くのは、振り返りの「この月を締める」を夫婦が5分以内に押したとき（MoneyReviewView）
// - いちばん上に「片づけるもの n件」（未確認の明細と、今月記録予定の固定費。押すと未確定明細の一覧）
// - 口座の一覧: 口座ごとに名前・額・右端のチェック（夫婦がふたりとも OK するとチェックが入る）。注釈は付けない
// - 口座を押すと詳細: 上に額と、夫婦それぞれの「OK」ボタン（自分の分だけ押せる）。下にその月の記録（月の初めから）。
//   抜けている入出金は右下の「＋ 記録を追加」で足す（出金元はこの口座）。記録を直しても合わないときは、額を押して残高を補正する
//   （カードはその月の利用の合計なので補正は無い。記録で合わせる）。見込みの記録には「確定」、利用通知と額が違う記録には注意を添える
// - OK は押したときの額を持つ。記録を足す・直す・補正して額が変わると、その口座の OK は外れる
// - 「この月を締める」は、すべての口座で夫婦がふたりとも OK したときだけ押せる

interface MonthCloseScreenProps {
  monthKey: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  balances: MoneyWalletBalance[];
  /** 今日（YYYY-MM-DD）。銀行・財布は今日の残高で照合する。 */
  today: string;
  /** 口座ごとの OK。 */
  checks: MoneyMonthWalletCheck[];
  /** 締めに加わる人（夫婦）。 */
  guardians: FamilyMember[];
  /** 自分（アカウントの id）。 */
  userId: string;
  /** 片づけるもの（その月の未確認の明細と、今月記録予定の固定費）の件数。 */
  todoCount: number;
  /** カードの記録を利用通知と見比べるための一覧（利用通知を取り込んでいるときだけ。docs/kakei.md §4.7）。 */
  cardChecks: CardMonthChecks | null;
  closed: boolean;
  /** 締めた日時（締めた月だけ）。 */
  closedAt: string | null;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  /** 記録を足す（出金元はこの口座、日はその日）。 */
  onAddRecord: (walletId: string, date: string) => void;
  /** 残高を補正する（口座の面の「残高を補正」と同じ）。 */
  onSaveBalance: (walletId: string, adjustment: number, amount: number, showInHistory: boolean) => void;
  /** 自分の OK を押す（amount はそのときの額）／外す（null）。 */
  onSetCheck: (walletId: string, amount: number | null) => void;
  onOpenFeed: () => void;
  onCloseMonth: () => void;
  onReopenMonth: () => void;
  onClose: () => void;
}

const closedDateLabel = (closedAt: string) => {
  const date = new Date(closedAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

/** 記録を足すときの日。過ぎた月はその月の末日、今月は今日。 */
const addDateOf = (monthKey: string, today: string) => {
  if (today.startsWith(monthKey)) return today;
  const [year, month] = monthKey.split('-').map(Number);
  return `${monthKey}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
};

export default function MonthCloseScreen({
  monthKey,
  records,
  categories,
  wallets,
  balances,
  today,
  checks,
  guardians,
  userId,
  todoCount,
  cardChecks,
  closed,
  closedAt,
  onConfirmEstimate,
  onOpenRecord,
  onAddRecord,
  onSaveBalance,
  onSetCheck,
  onOpenFeed,
  onCloseMonth,
  onReopenMonth,
  onClose,
}: MonthCloseScreenProps) {
  const label = `${Number(monthKey.slice(5, 7))}月`;
  const [openId, setOpenId] = useState<string | null>(null);

  // 口座ごとの額と、今の額のまま OK している人。
  const rows = useMemo(
    () =>
      closeWallets(wallets).map((wallet) => {
        const figure = closeFigure(wallet, records, balances, monthKey, today);
        const ok = okUsers(checks, monthKey, wallet.id, figure);
        return { wallet, figure, ok, done: allOk(ok, guardians) };
      }),
    [wallets, records, balances, monthKey, today, checks, guardians],
  );
  const allDone = rows.length > 0 && rows.every((row) => row.done);
  const opened = rows.find((row) => row.wallet.id === openId) ?? null;

  return (
    <>
      <FullScreen onBack={onClose}>
        <ScreenHeader title={`${label}の締め`} icon="back" onClose={onClose} />
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-gray-50 px-4 pb-8 pt-3">
          {todoCount > 0 && (
            <button
              type="button"
              onClick={onOpenFeed}
              className="flex w-full items-center gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-left hover:bg-amber-200"
            >
              <span className="flex-1 text-[13px] font-semibold text-amber-800">片づけるもの {todoCount}件</span>
              <ChevronRight size={16} className="text-gray-500" />
            </button>
          )}
          <div className={`${cardClass} overflow-hidden`}>
            {rows.map((row, index) => (
              <button
                key={row.wallet.id}
                type="button"
                onClick={() => setOpenId(row.wallet.id)}
                className={`flex w-full items-center gap-2.5 bg-white px-3.5 py-3.5 text-left hover:bg-gray-50 ${index > 0 ? 'border-t border-gray-200' : ''}`}
              >
                <WalletTypeIcon type={row.wallet.type} size={20} color={row.wallet.iconColor} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-gray-900">{row.wallet.name}</span>
                <span className="text-[15px] font-extrabold tabular-nums text-gray-900">{formatBalance(row.figure)}</span>
                <span
                  aria-label={row.done ? '確認済み' : '未確認'}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                    row.done ? 'border-[#43b02a] bg-[#43b02a]' : 'border-gray-200'
                  }`}
                >
                  {row.done && <Check size={14} strokeWidth={3} className="text-white" />}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="shrink-0 space-y-1.5 border-t border-gray-200 px-4 pb-4 pt-2.5">
          {closed ? (
            <>
              <p className="text-center text-[13px] font-semibold text-gray-500">
                {closedAt ? `${closedDateLabel(closedAt)}に締めました` : '締めた月です'}
              </p>
              <button type="button" onClick={onReopenMonth} className="w-full py-2.5 text-[13px] font-bold text-red-500">
                締めを外す
              </button>
            </>
          ) : (
            <PrimaryButton label="この月を締める" onClick={onCloseMonth} disabled={!allDone} />
          )}
        </div>
      </FullScreen>
      {opened && (
        <WalletCloseScreen
          wallet={opened.wallet}
          figure={opened.figure}
          ok={opened.ok}
          monthKey={monthKey}
          today={today}
          records={records}
          categories={categories}
          wallets={wallets}
          balances={balances}
          guardians={guardians}
          userId={userId}
          cardChecks={cardChecks}
          locked={closed}
          onConfirmEstimate={onConfirmEstimate}
          onOpenRecord={onOpenRecord}
          onAddRecord={() => onAddRecord(opened.wallet.id, addDateOf(monthKey, today))}
          onSaveBalance={(adjustment, amount, showInHistory) => onSaveBalance(opened.wallet.id, adjustment, amount, showInHistory)}
          onSetCheck={(amount) => onSetCheck(opened.wallet.id, amount)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

interface WalletCloseScreenProps {
  wallet: MoneyWallet;
  figure: number;
  ok: ReadonlySet<string>;
  monthKey: string;
  today: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  balances: MoneyWalletBalance[];
  guardians: FamilyMember[];
  userId: string;
  cardChecks: CardMonthChecks | null;
  /** 締めた月（OK・確定・記録の追加はできない）。 */
  locked: boolean;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  onAddRecord: () => void;
  onSaveBalance: (adjustment: number, amount: number, showInHistory: boolean) => void;
  onSetCheck: (amount: number | null) => void;
  onClose: () => void;
}

/** 締めの、口座の詳細。上に額と夫婦それぞれの OK、下にその月の記録。 */
function WalletCloseScreen({
  wallet,
  figure,
  ok,
  monthKey,
  today,
  records,
  categories,
  wallets,
  balances,
  guardians,
  userId,
  cardChecks,
  locked,
  onConfirmEstimate,
  onOpenRecord,
  onAddRecord,
  onSaveBalance,
  onSetCheck,
  onClose,
}: WalletCloseScreenProps) {
  const [adjusting, setAdjusting] = useState(false);
  // 確定を押した記録（読み直しが届くまで、二度押せないように）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const shown = useMemo(() => closeRecords(wallet, records, monthKey), [wallet, records, monthKey]);
  // 補正できるのは残高を照合する口座だけ（カードはその月の利用の合計なので、記録で合わせる）。
  const canAdjust = wallet.type !== 'card' && !locked;

  // 利用通知と額が違う記録（記録の id → 注意の文言）。
  const notes = useMemo(() => {
    const map = new Map<string, string>();
    for (const { record, feedAmount } of cardChecks?.mismatched ?? []) {
      map.set(record.id, `利用通知は ${formatYen(feedAmount)}。額が違います`);
    }
    return map;
  }, [cardChecks]);

  const closing: RecordClosing = {
    locked,
    onConfirm: (record) => {
      setConfirming(record.id);
      void onConfirmEstimate(record).finally(() => setConfirming(null));
    },
    busyId: confirming,
    notes,
  };

  return (
    <>
      <FullScreen onBack={onClose}>
        <ScreenHeader title={wallet.name} icon="back" onClose={onClose} />
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-gray-50 px-4 pb-24 pt-3">
          <div className={`${cardClass} space-y-1 p-3.5`}>
            <p className="text-[13px] font-semibold text-gray-500">{closeFigureLabel(wallet, monthKey, today)}</p>
            {canAdjust ? (
              <button
                type="button"
                aria-label="残高を補正"
                onClick={() => setAdjusting(true)}
                className="block text-left text-[32px] font-extrabold tabular-nums text-gray-900"
              >
                {formatBalance(figure)}
              </button>
            ) : (
              <p className="text-[32px] font-extrabold tabular-nums text-gray-900">{formatBalance(figure)}</p>
            )}
            <div className="flex gap-2.5 pt-2">
              {guardians.map((member) => {
                const on = ok.has(member.id);
                const mine = member.id === userId;
                return (
                  <button
                    key={member.id}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${member.name} OK`}
                    disabled={!mine || locked}
                    onClick={() => onSetCheck(on ? null : figure)}
                    className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl border py-3 ${
                      on
                        ? 'border-[#43b02a] bg-[#43b02a] text-white'
                        : mine
                          ? 'border-gray-200 bg-white hover:bg-gray-50'
                          : 'border-gray-100 bg-gray-100'
                    }`}
                  >
                    <span className={`max-w-full truncate text-sm font-bold ${on ? 'text-white' : 'text-gray-900'}`}>{member.name}</span>
                    <span className={`text-[13px] font-bold ${on ? 'text-white' : 'text-blue-800'}`}>{on ? 'OK ✓' : 'OK'}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="pt-2 text-[15px] font-bold text-gray-900">{`${Number(monthKey.slice(5, 7))}月の記録`}</p>
          {shown.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-gray-400">この月の記録はありません</p>
          ) : (
            <RecordDayList records={shown} categories={categories} wallets={wallets} onOpen={onOpenRecord} closing={closing} oldestFirst />
          )}
        </div>
        {!locked && (
          <button
            type="button"
            onClick={onAddRecord}
            className="absolute bottom-[calc(20px+env(safe-area-inset-bottom))] right-4 flex items-center gap-1.5 rounded-full bg-blue-600 px-[18px] py-[13px] text-[15px] font-bold text-white shadow-lg hover:bg-blue-700"
          >
            <Plus size={18} strokeWidth={2.6} />
            記録を追加
          </button>
        )}
      </FullScreen>
      {adjusting && (
        <BalanceModal
          wallet={wallet}
          records={records}
          balances={balances}
          onClose={() => setAdjusting(false)}
          onSubmit={(adjustment, amount, showInHistory) => {
            onSaveBalance(adjustment, amount, showInHistory);
            setAdjusting(false);
          }}
        />
      )}
    </>
  );
}
