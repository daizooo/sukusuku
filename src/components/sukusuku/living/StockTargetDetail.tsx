'use client';

import type { StockItem, StockTarget } from '@/types/app';
import {
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  STORAGE_LABEL,
  unitPriceOf,
  type StockPlan,
  type StockStorage,
  type TargetCost,
  type TargetStatus,
} from '@/lib/stockUtils';
import { ModalShell } from '../modals/TaskForm';
import { Ring, StockIcon, TONE } from './stockVisual';

// 目標（水・ご飯など）1つの詳しい画面（docs/home.md §10.2）。mobile版の
// `mobile/src/components/living/StockTargetDetail.tsx` と同じ項目・文言。
// 一覧のタイルには出さない費用と、その目標に数えるロットを期限順に並べる。

interface StockTargetDetailProps {
  status: TargetStatus<StockTarget>;
  cost: TargetCost;
  lots: StockItem[];
  plan: StockPlan;
  today: string;
  onClose: () => void;
  onEditTarget: () => void;
  onEditItem: (item: StockItem) => void;
}

const LEVEL_TEXT = { expired: 'text-red-700', soon: 'text-red-700', year: 'text-orange-700', ok: 'text-gray-500', none: 'text-gray-400' };

const STORAGE_ORDER: StockStorage[] = ['home', 'carry'];

export default function StockTargetDetail({
  status,
  cost,
  lots,
  plan,
  today,
  onClose,
  onEditTarget,
  onEditItem,
}: StockTargetDetailProps) {
  const { target, required, have, shortage, carry } = status;
  const ratio = required > 0 ? have / required : 1;
  const color = shortage > 0 ? TONE.alert : TONE.ok;
  const facts: [string, string][] = [
    ['1日あたり', cost.daily === null ? '決まった数' : `${formatQuantity(cost.daily)}${target.unit}`],
    [`${plan.days}日分の費用`, cost.total === null ? '値段未登録' : formatYen(cost.total)],
    ['買い足し', cost.shortageCost === null ? '—' : shortage > 0 ? formatYen(cost.shortageCost) : '不要'],
    [`1${target.unit}あたり`, cost.unitPrice === null ? '—' : formatYen(cost.unitPrice)],
  ];
  return (
    <ModalShell
      title={target.name}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onEditTarget}
          className="w-full py-3 rounded-xl bg-gray-100 text-sm font-bold text-gray-700 hover:bg-gray-200"
        >
          必要数を直す
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Ring size={88} stroke={9} ratio={ratio} color={color}>
            <StockIcon name={target.name} category={target.category} size={30} color={color} />
          </Ring>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-gray-900 tabular-nums">
              {formatQuantity(have)}
              <span className="text-sm font-bold text-gray-400"> / {formatQuantity(required)}{target.unit}</span>
            </p>
            <p className={`text-sm font-bold ${shortage > 0 ? 'text-red-700' : 'text-green-700'}`}>
              {shortage > 0 ? `あと${formatQuantity(shortage)}${target.unit}` : '足りています'}
            </p>
            {carry && (
              <p className={`text-xs font-bold mt-0.5 tabular-nums ${carry.shortage > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                持ち出し {formatQuantity(carry.have)} / {formatQuantity(carry.required)}
                {target.unit}
              </p>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-gray-50 px-3 py-2">
              <dt className="text-[11px] font-bold text-gray-400">{label}</dt>
              <dd className="text-sm font-bold text-gray-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div>
          <p className="text-xs font-bold text-gray-500 mb-1.5">ロット（期限の近い順）</p>
          {lots.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">まだありません</p>
          ) : (
            <ul className="rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
              {STORAGE_ORDER.flatMap((storage) => lots.filter((item) => item.storage === storage)).map((item) => {
                const level = expiryLevel(item.expiresOn, today);
                const unit = unitPriceOf(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onEditItem(item)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                          {item.storage === 'carry' && (
                            <span className="px-1.5 rounded bg-blue-50 text-[10px] font-bold text-blue-700">
                              {STORAGE_LABEL.carry}
                            </span>
                          )}
                          {item.name}
                        </p>
                        {item.price !== null && (
                          <p className="text-[11px] text-gray-400 tabular-nums">
                            {formatYen(item.price)}/{item.unit || '個'}
                            {unit !== null && (item.unit !== target.unit || item.amountPerUnit !== 1)
                              ? `（${formatYen(unit)}/${target.unit}）`
                              : ''}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p className="text-[13px] font-bold text-gray-700">
                          {formatQuantity(item.quantity)}
                          {item.unit}
                        </p>
                        <p className={`text-[11px] font-bold ${LEVEL_TEXT[level]}`}>
                          {item.expiresOn ? `${formatExpiry(item)}・${expiryCountdown(item.expiresOn, today)}` : '期限なし'}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
