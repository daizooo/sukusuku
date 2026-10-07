'use client';

import { useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import {
  daysBetween,
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  NO_CATEGORY,
  spanText,
  type buildStockBoard,
  type StockPlan,
} from '@/lib/stockUtils';
import { ModalShell } from '../modals/TaskForm';
import { Ring, StockIcon, TONE } from './stockVisual';

// 持ち出しバッグの点検（docs/home.md §10.2.2）。一覧の上の「バッグ」と、「確認が必要なもの」の
// 「確かめる」から開く。mobile版の `mobile/src/components/living/StockBagCheck.tsx` と同じ項目・文言。
// 中身を押して確かめ（チェックはこの画面の中だけ）、全部確かめたら「点検完了」で今日の日付を残す。

type Board = ReturnType<typeof buildStockBoard<StockItem, StockTarget>>;

interface StockBagCheckProps {
  board: Board;
  items: StockItem[];
  plan: StockPlan;
  today: string;
  onClose: () => void;
  onEditItem: (item: StockItem) => void;
  /** 点検した日（今日）を、バッグのロットにまとめて記録する。 */
  onInspect: (items: StockItem[]) => void;
}

const dateText = (on: string) => formatExpiry({ expiresOn: on, expiresMonthOnly: false });

export default function StockBagCheck({ board, items, plan, today, onClose, onEditItem, onInspect }: StockBagCheckProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const bag = board.attention.bag;
  const bagDue = bag?.due === true;
  const bagLots = items.filter((item) => item.storage === 'carry' && item.quantity > 0);
  const doneCount = bagLots.filter((item) => checked.has(item.id)).length;
  const allChecked = bagLots.length > 0 && doneCount === bagLots.length;
  const shortages = board.blocks.filter((block) => (block.status.carry?.shortage ?? 0) > 0);
  const byCategory = bagLots.reduce<Record<string, StockItem[]>>((groups, item) => {
    const key = item.category.trim() || NO_CATEGORY;
    (groups[key] ??= []).push(item);
    return groups;
  }, {});
  const age = bag?.lastOn ? `${spanText(daysBetween(bag.lastOn, today))}前に点検` : 'まだ点検していません';

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ModalShell
      title="持ち出しバッグ"
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!allChecked}
          onClick={() => {
            onInspect(bagLots);
            onClose();
          }}
          className={`w-full rounded-xl py-3 text-sm font-bold transition ${
            allChecked ? 'bg-orange-100 text-orange-800 hover:bg-orange-200' : 'bg-gray-100 text-gray-400'
          }`}
        >
          {bagLots.length === 0
            ? 'バッグは空です'
            : allChecked
              ? '点検完了（今日の日付を残す）'
              : `あと${bagLots.length - doneCount}つ確かめましょう`}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Ring size={44} stroke={5} ratio={bagLots.length === 0 ? 0 : doneCount / bagLots.length} color={TONE.accent}>
            <span className="text-[11px] font-bold tabular-nums text-gray-900">
              {doneCount}/{bagLots.length}
            </span>
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900">{plan.carryDays}日分のバッグ</p>
            <p className={`text-[11px] font-bold ${bagDue ? 'text-red-700' : 'text-gray-400'}`}>
              {bag ? `${age}${bagDue ? '・点検の時期です' : `・次は ${dateText(bag.nextOn)} ごろ`}` : 'バッグは空です'}
            </p>
          </div>
        </div>

        {shortages.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-gray-500">足りない</span>
            {shortages.map(({ status }) => (
              <span key={status.target.id} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 tabular-nums">
                {status.target.name} あと{formatQuantity(status.carry?.shortage ?? 0)}
                {status.target.unit}
              </span>
            ))}
          </div>
        )}

        {bagLots.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">持ち出しバッグには何も入っていません</p>
        ) : (
          Object.entries(byCategory).map(([name, rows]) => (
            <section key={name}>
              <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-gray-900">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                  <StockIcon name={name} size={11} />
                </span>
                {name}
              </h3>
              <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
                {rows.map((item) => {
                  const on = checked.has(item.id);
                  const level = expiryLevel(item.expiresOn, today);
                  const alert = level === 'expired' || level === 'soon';
                  return (
                    <li key={item.id} className={`flex items-center transition ${on ? 'bg-orange-50' : ''}`}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`${item.name}を確かめた`}
                        onClick={() => toggle(item.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left"
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                            on ? 'border-orange-300 bg-orange-100 text-orange-800' : 'border-gray-300 bg-white text-transparent'
                          }`}
                        >
                          <Check size={14} strokeWidth={3} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-bold leading-tight text-gray-900">{item.name}</span>
                          {item.expiresOn && (
                            <span className={`block text-[10px] font-bold leading-tight ${alert ? 'text-red-700' : 'text-gray-400'}`}>
                              {expiryCountdown(item.expiresOn, today)}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 leading-tight tabular-nums">
                          <span className="text-[15px] font-bold text-gray-900">{formatQuantity(item.quantity)}</span>
                          <span className="ml-0.5 text-[10px] font-bold text-gray-400">{item.unit}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`${item.name}を編集`}
                        onClick={() => onEditItem(item)}
                        className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                      >
                        <Pencil size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </ModalShell>
  );
}
