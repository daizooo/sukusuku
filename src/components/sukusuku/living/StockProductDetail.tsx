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
  type StockProduct,
  type StockStorage,
} from '@/lib/stockUtils';
import { ModalShell } from '../modals/TaskForm';
import { Ring, StockIcon, TONE } from './stockVisual';

// 品目1つの詳しい画面（docs/home.md §10.2）。mobile版の
// `mobile/src/components/living/StockProductDetail.tsx` と同じ項目・文言。
// 一覧のタイルには出さない費用と、その品目に数えるロットを期限順に並べる。
// 目標（必要数）がある品目は、必要数・不足・費用も出す。

interface StockProductDetailProps {
  product: StockProduct<StockItem, StockTarget>;
  plan: StockPlan;
  today: string;
  onClose: () => void;
  onEditTarget: (target: StockTarget) => void;
  onEditItem: (item: StockItem) => void;
}

const LEVEL_TEXT = { expired: 'text-red-700', soon: 'text-red-700', year: 'text-gray-600', ok: 'text-gray-500', none: 'text-gray-400' };

const STORAGE_ORDER: StockStorage[] = ['home', 'carry'];

export default function StockProductDetail({
  product,
  plan,
  today,
  onClose,
  onEditTarget,
  onEditItem,
}: StockProductDetailProps) {
  const target = product.target;
  const status = target?.status ?? null;
  const cost = target?.cost ?? null;
  const shortage = status?.shortage ?? 0;
  const required = status?.required ?? 0;
  const ratio = status && required > 0 ? status.have / required : 1;
  const ringColor = shortage > 0 ? TONE.alert : TONE.ok;
  const unitLabel = status?.target.unit ?? product.unit;
  const facts: [string, string][] =
    status && cost
      ? [
          ['必要数', `${formatQuantity(required)}${unitLabel}`],
          [`${plan.days}日分の費用`, cost.total === null ? '値段未登録' : formatYen(cost.total)],
          ['買い足し', cost.shortageCost === null ? '—' : shortage > 0 ? formatYen(cost.shortageCost) : '不要'],
          [`1${unitLabel}あたり`, cost.unitPrice === null ? '—' : formatYen(cost.unitPrice)],
        ]
      : [];
  const ordered = STORAGE_ORDER.flatMap((storage) => product.lots.filter((item) => item.storage === storage));

  return (
    <ModalShell
      title={product.name}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={() => (status ? onEditTarget(status.target) : onClose())}
          className="w-full py-3 rounded-xl bg-gray-100 text-sm font-bold text-gray-700 hover:bg-gray-200"
        >
          {status ? '必要数を直す' : '閉じる'}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Ring size={88} stroke={9} ratio={ratio} color={ringColor}>
            <StockIcon name={product.name} category={product.category} size={30} color={ringColor} />
          </Ring>
          <div className="min-w-0">
            <p className="text-3xl font-bold text-gray-900 tabular-nums">
              {formatQuantity(product.total)}
              <span className="text-sm font-bold text-gray-400"> {unitLabel}</span>
            </p>
            {shortage > 0 && <p className="text-sm font-bold text-red-700">あと{formatQuantity(shortage)}{unitLabel}</p>}
            {status?.carry && (
              <p className={`text-xs font-bold mt-0.5 tabular-nums ${status.carry.shortage > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                持ち出し {formatQuantity(status.carry.have)} / {formatQuantity(status.carry.required)}
                {unitLabel}
              </p>
            )}
            {!status && product.carryTotal > 0 && (
              <p className="text-xs font-bold mt-0.5 text-gray-500 tabular-nums">
                持ち出し {formatQuantity(product.carryTotal)}
                {unitLabel}
              </p>
            )}
          </div>
        </div>

        {facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-2">
            {facts.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-gray-50 px-3 py-2">
                <dt className="text-[11px] font-bold text-gray-400">{label}</dt>
                <dd className="text-sm font-bold text-gray-900 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div>
          <p className="text-xs font-bold text-gray-500 mb-1.5">ロット（期限の近い順）</p>
          {ordered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">まだありません</p>
          ) : (
            <ul className="rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
              {ordered.map((item) => {
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
                            <span className="px-1.5 rounded bg-gray-100 text-[10px] font-bold text-gray-600">
                              {STORAGE_LABEL.carry}
                            </span>
                          )}
                          {item.name}
                        </p>
                        {item.price !== null && (
                          <p className="text-[11px] text-gray-400 tabular-nums">
                            {formatYen(item.price)}/{item.unit || '個'}
                            {unit !== null && status && (item.unit !== status.target.unit || item.amountPerUnit !== 1)
                              ? `（${formatYen(unit)}/${status.target.unit}）`
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
