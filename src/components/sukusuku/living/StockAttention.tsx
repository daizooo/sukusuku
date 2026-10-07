'use client';

import { Check, ClipboardCheck, ListPlus, PackageCheck, Trash2, Utensils, Wrench } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import {
  daysBetween,
  expiryCountdown,
  formatQuantity,
  formatYen,
  spanText,
  STORAGE_LABEL,
  type buildStockBoard,
} from '@/lib/stockUtils';
import { ModalShell } from '../modals/TaskForm';
import { StockIcon } from './stockVisual';

// 「確認が必要なもの」（docs/home.md §10.2）。期限・不足・点検は品目に付く補助の情報なので、
// 一覧の主役にはせず、上の帯から開くこの画面に集める。mobile版の
// `mobile/src/components/living/StockAttention.tsx` と同じ項目・文言。

type Board = ReturnType<typeof buildStockBoard<StockItem, StockTarget>>;

interface StockAttentionProps {
  board: Board;
  /** 備品（期限なし）のうち、点検する設定のもの。「まとめて点検した」の対象。 */
  inspectable: StockItem[];
  today: string;
  onClose: () => void;
  onEditItem: (item: StockItem) => void;
  onSendShortage: (target: StockTarget, shortage: number) => void;
  onRestock: (item: StockItem) => void;
  onUse: (item: StockItem) => void;
  onDiscard: (item: StockItem) => void;
  onInspect: (items: StockItem[]) => void;
  /** 持ち出しバッグのチェック表を開く。 */
  onOpenBag: () => void;
}

const COUNTDOWN_CLASS = {
  expired: 'bg-red-50 text-red-700',
  soon: 'bg-red-50 text-red-700',
  year: 'bg-gray-100 text-gray-600',
  ok: 'bg-gray-100 text-gray-500',
  none: 'bg-gray-100 text-gray-400',
} as const;

const cardClass = 'rounded-2xl border border-gray-200 bg-white';

export default function StockAttention({
  board,
  inspectable,
  today,
  onClose,
  onEditItem,
  onSendShortage,
  onRestock,
  onUse,
  onDiscard,
  onInspect,
  onOpenBag,
}: StockAttentionProps) {
  const { attention } = board;
  const bagDue = attention.bag?.due === true;
  const bagAge = attention.bag?.lastOn
    ? `${spanText(daysBetween(attention.bag.lastOn, today))}前に点検`
    : 'まだ点検していません';

  const bubble = (name: string, category: string) => (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
      <StockIcon name={name} category={category} size={22} />
    </span>
  );

  const button = (label: string, onClick: () => void, Icon: typeof Check, kind: 'main' | 'sub') => (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold ${
        kind === 'main' ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  const confirmDiscard = (item: StockItem) => {
    if (window.confirm(`${item.name}を処分しますか？\n備蓄から削除します。`)) onDiscard(item);
  };

  const empty =
    attention.replacement.lots.length === 0 && attention.short.length === 0 && attention.inspect.length === 0 && !bagDue;

  return (
    <ModalShell
      title="確認が必要なもの"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-gray-100 text-sm font-bold text-gray-700 hover:bg-gray-200"
        >
          閉じる
        </button>
      }
    >
      <div className="space-y-5">
        {empty && <p className="py-6 text-center text-sm text-gray-400">いまのところ、ありません</p>}

        {attention.replacement.lots.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-gray-900">
              期限が近い・切れた
              {attention.replacement.total > 0 && (
                <span className="ml-2 text-xs font-bold text-gray-500">見込み {formatYen(attention.replacement.total)}</span>
              )}
            </h3>
            {attention.replacement.lots.map(({ item, level, amount }) => (
              <div key={item.id} className={`${cardClass} overflow-hidden`}>
                <button
                  type="button"
                  onClick={() => onEditItem(item)}
                  className="flex w-full items-center gap-3 px-3 pt-3 pb-2 text-left"
                >
                  {bubble(item.name, item.category)}
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-gray-900">{item.name}</span>
                      {item.storage === 'carry' && (
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 text-[10px] font-bold text-gray-600">
                          {STORAGE_LABEL.carry}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      {item.expiresOn && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${COUNTDOWN_CLASS[level]}`}>
                          {expiryCountdown(item.expiresOn, today)}
                        </span>
                      )}
                      <span className="text-[11px] font-bold text-gray-500 tabular-nums">
                        {formatQuantity(item.quantity)}
                        {item.unit}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] font-bold tabular-nums text-gray-400">
                    {amount === null ? '値段未登録' : <span className="text-sm text-gray-800">{formatYen(amount)}</span>}
                  </span>
                </button>
                <div className="flex gap-2 px-3 pb-3">
                  {button('買い替え', () => onRestock(item), PackageCheck, 'main')}
                  {button('使った', () => onUse(item), Utensils, 'sub')}
                  {button('処分', () => confirmDiscard(item), Trash2, 'sub')}
                </div>
              </div>
            ))}
          </section>
        )}

        {attention.short.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-gray-900">足りないもの</h3>
            {attention.short.map(({ status, cost }) => {
              const { target, required, have, shortage, carry } = status;
              const ratio = required > 0 ? have / required : 1;
              return (
                <div key={target.id} className={`${cardClass} flex items-center gap-3 px-3 py-3`}>
                  {bubble(target.name, target.category)}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900">{target.name}</p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-red-600" style={{ width: `${Math.round(Math.min(1, ratio) * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] font-bold text-red-700 tabular-nums">
                      {shortage > 0
                        ? `あと${formatQuantity(shortage)}${target.unit}`
                        : carry
                          ? `バッグにあと${formatQuantity(carry.shortage)}${target.unit}`
                          : ''}
                      {cost.shortageCost !== null && shortage > 0 ? `　${formatYen(cost.shortageCost)}` : ''}
                    </p>
                  </div>
                  {shortage > 0 && (
                    <button
                      type="button"
                      aria-label={`${target.name}の不足を買い出しリストへ`}
                      onClick={() => onSendShortage(target, shortage)}
                      className="flex shrink-0 flex-col items-center gap-0.5 rounded-xl bg-gray-900 px-3 py-2 text-white hover:bg-gray-800"
                    >
                      <ListPlus size={18} />
                      <span className="text-[10px] font-bold">リストへ</span>
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {(attention.inspect.length > 0 || bagDue) && (
          <section className="space-y-2">
            <div className="flex items-center">
              <h3 className="flex-1 text-sm font-bold text-gray-900">点検の時期</h3>
              {inspectable.length > 0 && (
                <button
                  type="button"
                  onClick={() => onInspect(inspectable)}
                  className="flex items-center gap-1 rounded-xl bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-200"
                >
                  <Wrench size={13} />
                  まとめて点検した
                </button>
              )}
            </div>
            {bagDue && (
              <div className={`${cardClass} flex items-center gap-3 px-3 py-3`}>
                {bubble('バッグ', '')}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">持ち出しバッグ</p>
                  <p className="text-[11px] font-bold text-gray-500">{bagAge}</p>
                </div>
                <div className="w-28 shrink-0 flex">{button('確かめる', onOpenBag, ClipboardCheck, 'main')}</div>
              </div>
            )}
            {attention.inspect.map((item) => (
              <div key={item.id} className={`${cardClass} flex items-center gap-3 px-3 py-3`}>
                <button type="button" onClick={() => onEditItem(item)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                  {bubble(item.name, item.category)}
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm font-bold text-gray-900">{item.name}</span>
                    <span className="block text-[11px] font-bold text-gray-500">
                      {item.inspectedOn ? `${spanText(daysBetween(item.inspectedOn, today))}前に点検` : '未点検'}
                    </span>
                  </span>
                </button>
                <div className="w-24 shrink-0 flex">{button('点検した', () => onInspect([item]), Check, 'main')}</div>
              </div>
            ))}
          </section>
        )}
      </div>
    </ModalShell>
  );
}
