'use client';

import { Scale } from 'lucide-react';
import type { MoneyCategory, MoneyRecord, MoneyWallet, SpecialItem } from '@/types/app';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  formatBalance,
  formatSignedYen,
  formatYen,
  groupItems,
  groupRecordsByDay,
  iconKeyOf,
  itemSummary,
  recordTotal,
  topCategoryIdOf,
  type BalanceCheck,
} from '@/lib/moneyUtils';
import { CategoryIcon, EstimateBadge, TransferIcon, WalletTypeIcon, cardClass, incomeAmountClass, minus, type } from './moneyVisual';

// 記録を日ごと（新しい日から）に並べる一覧（docs/kakei.md §2.1）。家計タブの「記録」と、口座の詳細の「履歴」で同じものを使う。
// mobile版の `mobile/src/components/money/RecordDayList.tsx` と同じ並び・文言。
// 1行＝1件の記録。Zaim の履歴と同じく、1行目は「小分類 @ お店」（大分類はアイコンで分かる）、2行目は品名の要約
// （「牛乳、卵ほか」）、金額の右に出金元の種類のアイコン。振替は回る矢印のアイコンで、出金元 → 入金先。
// 毎月の記録・カード代金で自動で作り、まだ額を確かめていないものは金額の左に「見込み」（§3.3）。
// 口座の履歴では、残高の補正（corrections）も同じ日の先頭に1行で混ぜる（その日の終わりの残高なので）。押すと取り消しの確認。
// スクロールは持たない（親のスクロールの中に置く）。

interface RecordDayListProps {
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  specialItems: SpecialItem[];
  onOpen: (record: MoneyRecord) => void;
  /** 口座の履歴に混ぜる、残高の補正。 */
  corrections?: BalanceCheck[];
  onOpenCorrection?: (check: BalanceCheck) => void;
}

/** 補正の行の補足（差・はじめの残高）。 */
const correctionNote = (check: BalanceCheck) =>
  check.diff === null
    ? 'はじめの残高'
    : check.diff === 0
      ? '記録と合っていました'
      : `記録との差 ${formatSignedYen(check.diff)}`;

const dayLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日（${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]}）`;
};

export default function RecordDayList({
  records,
  categories,
  wallets,
  specialItems,
  onOpen,
  corrections = [],
  onOpenCorrection,
}: RecordDayListProps) {
  // 記録のある日と補正のある日を合わせて、新しい日から。
  const recordDays = groupRecordsByDay(records);
  const dates = [...new Set([...recordDays.map((day) => day.date), ...corrections.map((check) => check.balance.balanceOn)])].sort(
    (a, b) => b.localeCompare(a),
  );
  const days = dates.map((date) => ({
    date,
    records: recordDays.find((day) => day.date === date)?.records ?? [],
    corrections: corrections.filter((check) => check.balance.balanceOn === date),
  }));
  const walletOf = (id: string | null) => wallets.find((wallet) => wallet.id === id) ?? null;
  const walletName = (id: string | null) => walletOf(id)?.name ?? '';

  const describe = (record: MoneyRecord) => {
    if (record.kind === 'transfer') {
      return {
        icon: null,
        title: '振替',
        sub: `${walletName(record.walletId) || '?'} → ${walletName(record.toWalletId) || '?'}`,
      };
    }
    const groups = groupItems(record.items);
    const first = groups[0];
    const top = first?.categoryId ? topCategoryIdOf(categories, first.categoryId) : null;
    // 小分類だけ（大分類はアイコンで分かる）。特別費は項目の名前。
    const firstTitle = first?.categoryId
      ? (categories.find((category) => category.id === first.categoryId)?.name ?? '')
      : first?.specialItemId
        ? (specialItems.find((item) => item.id === first.specialItemId)?.name ?? '')
        : '';
    const title = groups.length > 1 ? `${firstTitle} ほか${groups.length - 1}` : firstTitle;
    return {
      // 特別費は Zaim と同じく黄色の星。
      icon: top ? iconKeyOf(categories.find((category) => category.id === top)) : 'star',
      title: record.store.trim() !== '' ? `${title} @ ${record.store.trim()}` : title,
      sub: itemSummary(record.items),
    };
  };

  /** 金額の右に出す出金元のアイコン（振替は出金元と入金先）。 */
  const walletIcons = (record: MoneyRecord) =>
    (record.kind === 'transfer' ? [record.walletId, record.toWalletId] : [record.walletId])
      .map(walletOf)
      .filter((wallet): wallet is MoneyWallet => wallet !== null);

  return (
    <>
      {days.map((day) => {
        const spent = day.records
          .filter((record) => record.kind === 'expense')
          .flatMap((record) => record.items)
          .filter((item) => item.specialItemId === null)
          .reduce((sum, item) => sum + item.amount, 0);
        return (
          <section key={day.date} className="mt-5">
            <div className="flex items-baseline justify-between pb-1.5">
              <h4 className="text-[13px] font-bold text-gray-700">{dayLabel(day.date)}</h4>
              {spent > 0 && <span className={type.faint}>{formatYen(spent)}</span>}
            </div>
            <div className={`${cardClass} overflow-hidden`}>
              {day.corrections.map((check, index) => (
                <button
                  key={check.balance.id}
                  type="button"
                  aria-label="残高の補正"
                  onClick={() => onOpenCorrection?.(check)}
                  className={`flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-gray-50 ${
                    index > 0 ? 'border-t border-gray-200' : ''
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5b7a99] text-white">
                    <Scale size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${type.row}`}>残高を補正</span>
                    <span className={`block truncate ${minus(type.sub, check.diff !== null && check.diff !== 0)}`}>
                      {correctionNote(check)}
                    </span>
                  </span>
                  <span className={minus(type.amount, check.balance.amount < 0)}>{formatBalance(check.balance.amount)}</span>
                </button>
              ))}
              {day.records.map((record, indexInDay) => {
                const index = day.corrections.length + indexInDay;
                const { icon, title, sub } = describe(record);
                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => onOpen(record)}
                    className={`flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-gray-50 ${
                      index > 0 ? 'border-t border-gray-200' : ''
                    }`}
                  >
                    {icon === null ? <TransferIcon /> : <CategoryIcon iconKey={icon} />}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${type.row}`}>{title}</span>
                      {sub !== '' && <span className={`block truncate ${type.sub}`}>{sub}</span>}
                    </span>
                    {record.isEstimate && <EstimateBadge />}
                    <span
                      className={
                        record.kind === 'transfer'
                          ? type.amount.replace('text-gray-900', 'text-gray-500')
                          : record.kind === 'income'
                            ? type.amount.replace('text-gray-900', incomeAmountClass)
                            : type.amount
                      }
                    >
                      {record.kind === 'income' ? '+' : ''}
                      {formatYen(recordTotal(record))}
                    </span>
                    <span className="flex min-w-[15px] gap-0.5">
                      {walletIcons(record).map((wallet, iconIndex) => (
                        <WalletTypeIcon key={`${wallet.id}-${iconIndex}`} type={wallet.type} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
