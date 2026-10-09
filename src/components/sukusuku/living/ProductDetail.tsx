'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { HouseholdProduct } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateString } from '@/lib/dateUtils';
import { formatAxisYen, niceTicks } from '@/lib/moneyUtils';
import { loadProductPurchases } from '@/lib/api/householdProducts';
import {
  MIN_PURCHASES_FOR_COST,
  compactYen,
  costEstimate,
  formatPriceChange,
  monthlyPurchases,
  priceHistory,
  priceSummary,
  priceTrend,
  purchaseTotals,
  type PricePoint,
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

/** 値段の推移の折れ線（買った日ごとの単価）。mobile版の同名の部品と同じ並び。 */
const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;
const PAD = { left: 40, right: 10, top: 10, bottom: 22 };

const dayNumber = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};
const shortDate = (key: string) => {
  const [, month, day] = key.split('-').map(Number);
  return `${month}/${day}`;
};

function PriceChart({ points }: { points: PricePoint[] }) {
  const geometry = useMemo(() => {
    const values = points.map((point) => point.unitPrice);
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    const plotWidth = CHART_WIDTH - PAD.left - PAD.right;
    const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
    const start = dayNumber(points[0].on);
    const span = dayNumber(points[points.length - 1].on) - start;
    const x = (on: string) => PAD.left + (span === 0 ? plotWidth / 2 : ((dayNumber(on) - start) / span) * plotWidth);
    const y = (value: number) => PAD.top + (high === low ? plotHeight / 2 : (1 - (value - low) / (high - low)) * plotHeight);
    return { ticks, x, y, line: points.map((point) => `${x(point.on)},${y(point.unitPrice)}`).join(' ') };
  }, [points]);

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto" role="img" aria-label="値段の推移">
      {geometry.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={CHART_WIDTH - PAD.right}
            y1={geometry.y(tick)}
            y2={geometry.y(tick)}
            stroke="#d1d5db"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text x={PAD.left - 6} y={geometry.y(tick) + 3.5} fontSize={10} fill="#9ca3af" textAnchor="end">
            {formatAxisYen(tick)}
          </text>
        </g>
      ))}
      {points.length > 1 && (
        <polyline points={geometry.line} fill="none" stroke="#059669" strokeWidth={2} strokeLinejoin="round" />
      )}
      {points.map((point, index) => (
        <circle key={`${point.on}-${index}`} cx={geometry.x(point.on)} cy={geometry.y(point.unitPrice)} r={3.5} fill="#059669" />
      ))}
      <text x={PAD.left} y={CHART_HEIGHT - 6} fontSize={10} fill="#9ca3af" textAnchor="start">
        {shortDate(points[0].on)}
      </text>
      {points.length > 1 && (
        <text x={CHART_WIDTH - PAD.right} y={CHART_HEIGHT - 6} fontSize={10} fill="#9ca3af" textAnchor="end">
          {shortDate(points[points.length - 1].on)}
        </text>
      )}
    </svg>
  );
}

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
  const records = useMemo(() => (lines ? priceHistory(lines) : []), [lines]);
  const trend = useMemo(() => (lines ? priceTrend(lines) : []), [lines]);
  const summary = useMemo(() => priceSummary(trend), [trend]);
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

            {summary && trend.length >= MIN_PURCHASES_FOR_COST && (
              <section className="space-y-1.5">
                <h4 className="text-[13px] font-bold text-gray-900">値段の推移</h4>
                <PriceChart points={trend} />
                <p className="text-[11px] font-bold text-gray-500 tabular-nums">
                  {formatPrice(summary.first.unitPrice)}（{shortDate(summary.first.on)}）→ {formatPrice(summary.latest.unitPrice)}（
                  {shortDate(summary.latest.on)}）
                  {summary.change !== 0 ? `　${formatPriceChange(summary.change)}` : '　変わらず'}
                </p>
                <p className="text-[11px] font-bold text-gray-500 tabular-nums">
                  最安 {formatPrice(summary.lowest.unitPrice)}
                  {summary.lowest.store !== '' ? `（${summary.lowest.store}・${shortDate(summary.lowest.on)}）` : `（${shortDate(summary.lowest.on)}）`}
                </p>
              </section>
            )}

            <section className="space-y-1.5">
              <h4 className="text-[13px] font-bold text-gray-900">買った記録</h4>
              <ul className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
                {records.map((row, index) => (
                  <li key={`${row.on}-${index}`} className="flex items-center gap-2.5 px-3 py-2 tabular-nums">
                    <span className="text-xs font-bold text-gray-900">{row.on.replace(/-/g, '.')}</span>
                    <span className="text-xs font-bold text-gray-700">{row.quantity}個</span>
                    <span className="text-xs font-bold text-gray-700">{formatPrice(row.unitPrice)}</span>
                    <span className={`min-w-11 text-[10px] font-bold ${row.change !== null && row.change > 0 ? 'text-red-700' : 'text-emerald-600'}`}>
                      {row.change === null ? '' : formatPriceChange(row.change)}
                    </span>
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
