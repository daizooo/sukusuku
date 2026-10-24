'use client';

import { memo } from 'react';
import { ClipboardList, Plus, Scale } from 'lucide-react';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  formatBalance,
  formatYen,
  groupItems,
  groupRecordsByDay,
  iconKeyOf,
  isFixedEstimate,
  itemSummary,
  recordTotal,
  topCategoryIdOf,
  type BalanceCheck,
} from '@/lib/moneyUtils';
import { CategoryIcon, EstimateBadge, NextPeriodBadge, TransferIcon, WalletTypeIcon, incomeAmountClass } from './moneyVisual';

// 記録を日ごと（新しい日から）に並べる一覧（docs/kakei.md §2.1）。家計タブの「記録」と、口座の詳細の「履歴」で同じものを使う。
// mobile版の `mobile/src/components/money/RecordDayList.tsx` と同じ並び・文言。
// Zaim の履歴と同じ作り（2026-10-15）。左に日付（土曜は青・日曜は赤）と縦の時間軸、右に1件1枚のカード。
// 日の見出しは「支出 その日の合計」と、その日に記録を足す「＋」（onAddOnDate があるときだけ）。
// カードは、金額を一番大きく左上に、出金元の種類のアイコンを右上に。次に「小分類 @ お店」（大分類は時間軸の丸のアイコンで分かる）、
// 最後にメモのアイコンをつけた品名の要約（「牛乳、卵ほか」）。振替は回る矢印の丸で、「振替 出金元 → 入金先」。
// 毎月の記録・カード代金で自動で作り、まだ額を確かめていないものは金額の右に「見込み」（§3.3）。
// 口座の履歴では、残高の補正（corrections）も補正した日の先頭に1件のカードで混ぜる。押すと取り消しの確認。
// 補正のカードは、総額が画面の上にあるので補正の増減だけを出す。
// スクロールは持たない（親のスクロールの中に置く）。

interface RecordDayListProps {
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  onOpen: (record: MoneyRecord) => void;
  /** 口座の履歴に混ぜる、残高の補正。 */
  corrections?: BalanceCheck[];
  onOpenCorrection?: (check: BalanceCheck) => void;
  /** 日の見出しの「＋」を押したとき、その日（YYYY-MM-DD）で記録を足す。無ければ「＋」は出さない。 */
  onAddOnDate?: (date: string) => void;
  /** 月の締めの画面で、各カードにチェックボックスを出す（docs/kakei.md §4.5）。 */
  closing?: RecordClosing;
  /** 古い日から（月の初めから）並べる。月の締めで使う。無ければ新しい日から。 */
  oldestFirst?: boolean;
}

const dayLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日（${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]}）`;
};

/** 左の日付の列の2行（10/15 と (木)）と、曜日の色（土＝青・日＝赤）。mobile版の dateParts と同じ。 */
const dateParts = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return {
    main: `${month}/${day}`,
    week: `(${WEEKDAY_LABELS[weekday]})`,
    color: weekday === 0 ? 'text-red-500' : weekday === 6 ? 'text-blue-500' : null,
  };
};

// 日の見出しも、カードも、「日付の列 | 時間軸 | 右の中身」の3列の行。時間軸の線は、行ごとに上から下まで引いてつなぐ。
const rowClass = 'flex items-start';
const axisClass = 'relative flex w-10 shrink-0 self-stretch justify-center';
const lineClass = 'absolute inset-y-0 w-0.5 bg-gray-300';
// 金額は大きく極太（収入は緑・支出は黒。符号はつけない）。「小分類 @ お店」は中くらい、メモは濃いめ。mobile版の styles と同じ。
const amountClass = 'text-[21px] font-extrabold tabular-nums text-gray-900';
const cardClass =
  'ml-1.5 mb-2 min-w-0 flex-1 rounded-[14px] border border-gray-200 bg-white px-3 pt-2 pb-2.5 text-left hover:bg-gray-50';

/** 1日ぶん（日の見出しと、その日の記録・補正のカード）。長い一覧を並べるときに、1行として使う。 */
export interface RecordDay {
  date: string;
  records: MoneyRecord[];
  corrections: BalanceCheck[];
}

/**
 * 月の締めの画面で、見込みの記録に「確定」を出すための指定（docs/kakei.md §4.5。2026-10-16）。mobile版の RecordClosing と同じ。
 * 「確定」は今の額のまま確定する。額が違うものは、カードを押して記録の詳細で直す。
 */
export interface RecordClosing {
  /** 締めた月は、確定できない。 */
  locked: boolean;
  onConfirm: (record: MoneyRecord) => void;
  /** 確定の処理中の記録（二度押せないように）。 */
  busyId: string | null;
  /** カードの下に添える注意（記録の id → 文言。カードの利用通知と額が違うものなど）。 */
  notes: ReadonlyMap<string, string>;
}

interface RecordDayBlockProps {
  day: RecordDay;
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  onOpen: (record: MoneyRecord) => void;
  onOpenCorrection?: (check: BalanceCheck) => void;
  onAddOnDate?: (date: string) => void;
  closing?: RecordClosing;
}

// 画面の外の日は描画を後回しにする（全期間を1本の一覧で出すとき、重くならないように。2026-10-15）。
const LAZY_DAY_STYLE = { contentVisibility: 'auto', containIntrinsicSize: 'auto 120px' } as const;

/** 月の締めのカードの右上。見込みの記録だけ「確定」を出す。 */
function ClosingControl({ record, closing }: { record: MoneyRecord; closing: RecordClosing }) {
  if (!isFixedEstimate(record)) return null;
  return (
    <span
      role="button"
      tabIndex={closing.locked || closing.busyId !== null ? -1 : 0}
      aria-label="この額で確定する"
      aria-disabled={closing.locked || closing.busyId !== null}
      onClick={(event) => {
        event.stopPropagation();
        if (!closing.locked && closing.busyId === null) closing.onConfirm(record);
      }}
      className={`ml-1 shrink-0 cursor-pointer rounded-full bg-blue-100 px-3 py-1 text-[13px] font-bold text-blue-800 ${
        closing.busyId === record.id ? 'opacity-50' : ''
      }`}
    >
      確定
    </span>
  );
}

export const RecordDayBlock = memo(function RecordDayBlock({
  day,
  categories,
  wallets,
  onOpen,
  onOpenCorrection,
  onAddOnDate,
  closing,
}: RecordDayBlockProps) {
  const walletOf = (id: string | null) => wallets.find((wallet) => wallet.id === id) ?? null;
  const walletName = (id: string | null) => walletOf(id)?.name ?? '';

  const describe = (record: MoneyRecord) => {
    if (record.kind === 'transfer') {
      return {
        icon: null,
        title: `振替　${walletName(record.walletId) || '?'} → ${walletName(record.toWalletId) || '?'}`,
        sub: '',
      };
    }
    const groups = groupItems(record.items);
    const first = groups[0];
    const top = first?.categoryId ? topCategoryIdOf(categories, first.categoryId) : null;
    // 小分類だけ（大分類はアイコンで分かる）。
    const firstTitle = first?.categoryId
      ? (categories.find((category) => category.id === first.categoryId)?.name ?? '')
      : (first?.categoryName ?? '');
    const title = groups.length > 1 ? `${firstTitle} ほか` : firstTitle;
    return {
      icon: top ? iconKeyOf(categories.find((category) => category.id === top)) : 'star',
      title: record.store.trim() !== '' ? `${title} @ ${record.store.trim()}` : title,
      sub: itemSummary(record.items),
    };
  };

  /** カードの右上に出す出金元のアイコン（振替は出金元と入金先）。 */
  const walletIcons = (record: MoneyRecord) =>
    (record.kind === 'transfer' ? [record.walletId, record.toWalletId] : [record.walletId])
      .map(walletOf)
      .filter((wallet): wallet is MoneyWallet => wallet !== null);

  const spent = day.records
    .filter((record) => record.kind === 'expense')
    .flatMap((record) => record.items)
    .reduce((sum, item) => sum + item.amount, 0);
  const date = dateParts(day.date);
  const dateColor = date.color ?? 'text-gray-900';
  return (
    <section className="mt-1" data-date={day.date} style={LAZY_DAY_STYLE}>
      <div className={rowClass}>
        <div className="w-[42px] shrink-0 pt-1.5">
          <p className={`text-xs font-extrabold tabular-nums ${dateColor}`}>{date.main}</p>
          <p className={`text-[11px] font-bold ${date.color ?? 'text-gray-500'}`}>{date.week}</p>
        </div>
        <div className={axisClass}>
          <span className={lineClass} />
          <span className="relative mt-3 h-3.5 w-3.5 rounded-full bg-gray-300" />
        </div>
        <div className="ml-1.5 flex min-h-[38px] min-w-0 flex-1 items-center justify-between">
          <h4 className="text-[13px] font-bold text-gray-500">
            支出　<span className="tabular-nums">{formatYen(spent)}</span>
          </h4>
          {onAddOnDate && (
            <button
              type="button"
              aria-label={`${dayLabel(day.date)}に記録を追加`}
              onClick={() => onAddOnDate(day.date)}
              className="flex h-7 w-7 items-center justify-center text-gray-700"
            >
              <Plus size={20} />
            </button>
          )}
        </div>
      </div>
      {day.corrections.map((check) => (
        <div key={check.balance.id} className={rowClass}>
          <div className="w-[42px] shrink-0" />
          <div className={axisClass}>
            <span className={lineClass} />
            <span className="relative mt-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-[#5b7a99] text-white">
              <Scale size={18} />
            </span>
          </div>
          <button type="button" aria-label="残高の補正" onClick={() => onOpenCorrection?.(check)} className={cardClass}>
            <span
              className={`block ${
                check.diff > 0 ? amountClass.replace('text-gray-900', incomeAmountClass) : amountClass
              }`}
            >
              {formatBalance(check.diff)}
            </span>
            <span className="mt-px block truncate text-[13px] font-semibold text-gray-700">
              残高を補正
            </span>
          </button>
        </div>
      ))}
      {day.records.map((record) => {
        const { icon, title, sub } = describe(record);
        return (
          <div key={record.id} className={rowClass}>
            <div className="w-[42px] shrink-0" />
            <div className={axisClass}>
              <span className={lineClass} />
              <span className="relative mt-2.5">
                {icon === null ? <TransferIcon size={36} /> : <CategoryIcon iconKey={icon} size={36} />}
              </span>
            </div>
            <button type="button" onClick={() => onOpen(record)} className={cardClass}>
              <span className="flex items-center gap-1.5">
                <span
                  className={
                    record.kind === 'transfer'
                      ? amountClass.replace('text-gray-900', 'text-gray-500')
                      : record.kind === 'income'
                        ? amountClass.replace('text-gray-900', incomeAmountClass)
                        : amountClass
                  }
                >
                  {formatYen(recordTotal(record))}
                </span>
                {isFixedEstimate(record) && <EstimateBadge />}
                {record.cardNextPeriod && <NextPeriodBadge />}
                <span className="flex-1" />
                <span className="flex min-w-[16px] gap-1">
                  {walletIcons(record).map((wallet, iconIndex) => (
                    <WalletTypeIcon key={`${wallet.id}-${iconIndex}`} type={wallet.type} size={16} color={wallet.iconColor} />
                  ))}
                </span>
                {closing && <ClosingControl record={record} closing={closing} />}
              </span>
              <span className="mt-px block truncate text-[13px] font-semibold text-gray-700">{title}</span>
              {closing?.notes.get(record.id) !== undefined && (
                <span className="mt-1 block text-xs font-semibold text-amber-800">{closing.notes.get(record.id)}</span>
              )}
              {sub !== '' && (
                <span className="mt-[5px] flex items-center gap-1.5 text-[13px] font-bold text-gray-700">
                  <ClipboardList size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{sub}</span>
                </span>
              )}
            </button>
          </div>
        );
      })}
    </section>
  );
});

export default function RecordDayList({
  records,
  categories,
  wallets,
  onOpen,
  corrections = [],
  onOpenCorrection,
  onAddOnDate,
  closing,
  oldestFirst = false,
}: RecordDayListProps) {
  // 記録のある日と補正のある日を合わせて、新しい日から（oldestFirst なら古い日から。日の中の並びも逆にする）。
  const recordDays = groupRecordsByDay(records);
  const dates = [...new Set([...recordDays.map((day) => day.date), ...corrections.map((check) => check.balance.balanceOn)])].sort(
    (a, b) => (oldestFirst ? a.localeCompare(b) : b.localeCompare(a)),
  );
  const days = dates.map((date) => {
    const dayRecords = recordDays.find((day) => day.date === date)?.records ?? [];
    return {
      date,
      records: oldestFirst ? [...dayRecords].reverse() : dayRecords,
      corrections: corrections.filter((check) => check.balance.balanceOn === date),
    };
  });

  return (
    <>
      {days.map((day) => (
        <RecordDayBlock
          key={day.date}
          day={day}
          categories={categories}
          wallets={wallets}
          onOpen={onOpen}
          onOpenCorrection={onOpenCorrection}
          onAddOnDate={onAddOnDate}
          closing={closing}
        />
      ))}
    </>
  );
}

