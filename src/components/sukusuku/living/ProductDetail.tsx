'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { HouseholdProduct } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateString } from '@/lib/dateUtils';
import { loadProductPurchases } from '@/lib/api/householdProducts';
import {
  MIN_PURCHASES_FOR_COST,
  compactYen,
  costEstimate,
  monthlyPurchases,
  newestFirst,
  purchaseTotals,
  type PurchaseLine,
} from '@/lib/productPurchases';
import { formatPrice } from '@/lib/shoppingUtils';
import { ModalShell } from '../modals/TaskForm';

// 日用品1品の詳しい画面（docs/home.md §4.6）。mobile版の
// `mobile/src/components/living/ProductDetail.tsx` と同じ項目・文言。
// 上に品名の下のお店・カテゴリと鉛筆（編集）、いつもの値段と「買い出しリストへ」。
// 下に家計の記録から数えた費用の目安・月ごとの個数・買った記録。
// 数えるのは、家計で「日用品から選ぶ」で入れた記録だけ（品名が同じでも数えない）。

interface ProductDetailProps {
  product: HouseholdProduct;
  onClose: () => void;
  onEdit: () => void;
  /** 行の「＋」と同じ送り方。 */
  onSend: () => void;
  /** 送ったあとの一言（モーダルの上に出すため、呼び出し側から受け取る）。 */
  banner: ReactNode;
}

/** 月ごとの棒の高さ（最大。px）。 */
const BAR_MAX = 56;

export default function ProductDetail({ product, onClose, onEdit, onSend, banner }: ProductDetailProps) {
  const supabase = useMemo(() => createClient(), []);
  const [lines, setLines] = useState<PurchaseLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const today = toDateString(new Date());

  useEffect(() => {
    let isMounted = true;
    loadProductPurchases(supabase, product.id)
      .then((loaded) => {
        if (isMounted) setLines(loaded);
      })
      .catch(() => {
        if (isMounted) setFailed(true);
      });
    return () => {
      isMounted = false;
    };
  }, [supabase, product.id]);

  const cost = useMemo(() => (lines ? costEstimate(lines, today) : null), [lines, today]);
  const months = useMemo(() => (lines ? monthlyPurchases(lines, today) : []), [lines, today]);
  const maxQuantity = Math.max(1, ...months.map((row) => row.quantity));
  const records = useMemo(() => (lines ? newestFirst(lines) : []), [lines]);
  const totals = useMemo(() => purchaseTotals(lines ?? []), [lines]);
  const sub = [product.store, product.category].filter((text) => text !== '').join('・');

  return (
    <ModalShell
      title={product.name}
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
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="flex-1 min-w-0 text-[11px] text-gray-400">{sub}</p>
          <button
            type="button"
            aria-label={`${product.name}を編集`}
            onClick={onEdit}
            className="shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200"
          >
            <Pencil size={14} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-gray-500">いつもの値段</p>
            <p className="text-[22px] font-bold leading-tight text-gray-900 tabular-nums">
              {product.price === null ? '—' : formatPrice(product.price)}
            </p>
          </div>
          <button
            type="button"
            onClick={onSend}
            className="shrink-0 flex items-center gap-1 rounded-full bg-emerald-600 px-3.5 py-2 text-[13px] font-bold text-white hover:bg-emerald-700"
          >
            <Plus size={16} />
            買い出しリストへ
          </button>
        </div>

        {lines === null ? (
          <p className="text-[13px] text-gray-400 text-center py-5">{failed ? '記録を読み込めませんでした' : '読み込み中...'}</p>
        ) : lines.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-5">
            家計で記録するときに「日用品から選ぶ」でこの品を選ぶと、ここに買った記録がたまります
          </p>
        ) : (
          <>
            <section className="rounded-2xl bg-emerald-50 px-3 py-2.5">
              {cost ? (
                <div className="flex gap-2">
                  {(
                    [
                      ['1日あたり', cost.perDay],
                      ['1か月あたり', cost.perMonth],
                      ['1年あたり', cost.perYear],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex-1 text-center">
                      <p className="text-[10px] font-bold text-gray-500">{label}</p>
                      <p className="text-[15px] font-bold text-gray-900 tabular-nums">{formatPrice(value)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center">{MIN_PURCHASES_FOR_COST}回買うと費用の目安を出します</p>
              )}
            </section>

            <section className="space-y-1.5">
              <h4 className="text-[13px] font-bold text-gray-900">月ごと</h4>
              <div className="flex gap-0.5">
                {months.map((row) => {
                  const height = row.quantity === 0 ? 0 : Math.max(3, Math.round((row.quantity / maxQuantity) * BAR_MAX));
                  return (
                    <div key={row.month} className="flex-1 min-w-0 flex flex-col items-center gap-0.5 tabular-nums">
                      <span className="h-3.5 text-[10px] font-bold text-gray-700">{row.quantity === 0 ? '' : row.quantity}</span>
                      <div className="w-full flex items-end justify-center" style={{ height: BAR_MAX }}>
                        <div className="w-3/5 rounded-[3px] bg-emerald-600" style={{ height }} />
                      </div>
                      <span className="text-[9px] font-bold text-gray-500">{Number(row.month.slice(5))}月</span>
                      <span className="h-3 text-[8px] text-gray-400">{row.amount === 0 ? '' : compactYen(row.amount)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-1.5">
              <h4 className="text-[13px] font-bold text-gray-900">買った記録</h4>
              <ul className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
                {records.map((row, index) => (
                  <li key={`${row.on}-${index}`} className="flex items-center gap-2.5 px-3 py-2 tabular-nums">
                    <span className="text-xs font-bold text-gray-900">{row.on.replace(/-/g, '.')}</span>
                    <span className="text-xs font-bold text-gray-700">{row.quantity}個</span>
                    <span className="text-xs font-bold text-gray-700">{formatPrice(row.unitPrice)}</span>
                    <span className="flex-1 min-w-0 truncate text-right text-[11px] text-gray-400">{row.store}</span>
                  </li>
                ))}
              </ul>
              <p className="text-right text-[11px] font-bold text-gray-500 tabular-nums">
                {totals.count}回・合計 {formatPrice(totals.amount)}
              </p>
            </section>
          </>
        )}
      </div>
      {banner}
    </ModalShell>
  );
}
