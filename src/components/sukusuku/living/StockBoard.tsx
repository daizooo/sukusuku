'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import {
  buildStockBoard,
  daysBetween,
  expiryCountdown,
  formatQuantity,
  spanText,
  type StockPlan,
  type StockProduct,
} from '@/lib/stockUtils';
import StockAttention from './StockAttention';
import StockBagCheck from './StockBagCheck';
import StockProductDetail from './StockProductDetail';
import { readinessColor, Ring } from './stockVisual';
import { useSwipeTabs } from '../ui/useSwipeTabs';

// 防災備蓄の画面（docs/home.md §10.2.2）。mobile版の
// `mobile/src/components/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 主役は「どんな備蓄が、どれだけあるか」。上はまとめて静かにし、品目の行で全体の数を大きく出す。
//   上（固定）: 備え度と「確認が必要」を1枚にまとめたカード（押すと「確認が必要なもの」）・カテゴリのタブ。
//     「バッグ」と「＋」は暮らしタブの見出しの右（tabs/LivingTab.tsx）。人数・日数は画面では変えない。
//   中（スクロール）: カテゴリごとの品目の行（寝室・持ち出し用の内訳は品目の詳しい画面）。
// 色は淡い橙と、対応が要るものの赤だけ。文字は見出し・数を太く大きく、品名は普通の太さ、単位は薄く小さく。

interface StockBoardProps {
  items: StockItem[];
  targets: StockTarget[];
  plan: StockPlan;
  /** 日本時間の今日（YYYY-MM-DD）。 */
  today: string;
  /** 持ち出しバッグの点検を開いているか（見出しの「バッグ」から開く）。 */
  bagOpen: boolean;
  onBagOpenChange: (open: boolean) => void;
  onEditItem: (item: StockItem) => void;
  onEditTarget: (target: StockTarget) => void;
  /** 不足を買い出しリストへ。 */
  onSendShortage: (target: StockTarget, shortage: number) => void;
  onRestock: (item: StockItem) => void;
  /** 「食べた/使った」（−1）。 */
  onUse: (item: StockItem) => void;
  onDiscard: (item: StockItem) => void;
  /** 点検した日（今日）を、ロットにまとめて記録する。 */
  onInspect: (items: StockItem[]) => void;
}

/** 絞り込みの「すべて」。 */
const ALL = '';

export default function StockBoard({
  items,
  targets,
  plan,
  today,
  bagOpen,
  onBagOpenChange,
  onEditItem,
  onEditTarget,
  onSendShortage,
  onRestock,
  onUse,
  onDiscard,
  onInspect,
}: StockBoardProps) {
  const board = useMemo(() => buildStockBoard(items, targets, plan, today), [items, targets, plan, today]);
  const { counts, attention, readiness, categories } = board;
  const [category, setCategory] = useState(ALL);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(false);

  const bagDue = attention.bag?.due === true;
  const expiryCount = counts.expired + counts.soon;
  const shortCount = attention.short.length;
  const inspectCount = counts.inspect + (bagDue ? 1 : 0);
  const attentionCount = expiryCount + shortCount + inspectCount;

  // 絞り込んでいたカテゴリが無くなったら「すべて」へ戻す。
  const activeCategory = categories.some((row) => row.category === category) ? category : ALL;
  const shown = activeCategory === ALL ? categories : categories.filter((row) => row.category === activeCategory);
  // カテゴリは、一覧の上の左右スワイプでも切り替える（一覧が指に合わせて動く）。
  const { handlers: swipeHandlers, attachContent } = useSwipeTabs(
    [ALL, ...categories.map((row) => row.category)],
    activeCategory,
    setCategory,
  );
  const detail = categories.flatMap((row) => row.products).find((product) => product.key === detailKey) ?? null;
  const inspectable = board.equipment.filter((item) => item.inspectIntervalMonths !== null);

  // ---- 備え度と「確認が必要」を1枚に ----
  const ringColor = readinessColor(readiness);
  const breakdown = [
    shortCount > 0 && `不足 ${shortCount}`,
    expiryCount > 0 && `期限 ${expiryCount}`,
    inspectCount > 0 && `点検 ${inspectCount}`,
  ]
    .filter(Boolean)
    .join('・');
  const summary = (
    <button
      type="button"
      aria-label="確認が必要なものを開く"
      onClick={() => setAttentionOpen(true)}
      className="shrink-0 mb-2 flex w-full items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-2.5 py-2 text-left hover:bg-gray-50"
    >
      <Ring size={38} stroke={5} ratio={readiness / 100} color={ringColor}>
        <span className="text-[11px] font-extrabold tabular-nums" style={{ color: ringColor }}>
          {readiness}
        </span>
      </Ring>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-gray-700">
          {plan.people}人×{plan.days}日分
        </span>
        {attentionCount > 0 ? (
          <span className="block text-xs font-bold text-red-700 tabular-nums">
            確認が必要 {attentionCount}件（{breakdown}）
          </span>
        ) : (
          <span className="block text-xs font-bold text-gray-400">確認が必要なものはありません</span>
        )}
      </span>
      <ChevronRight size={16} className="shrink-0 text-gray-300" />
    </button>
  );

  // ---- 品目の行（品名は全部見せ、全体の数を右に大きく） ----
  const productRow = (product: StockProduct<StockItem, StockTarget>) => {
    const status = product.target?.status ?? null;
    const shortage = status?.shortage ?? 0;
    const nearestLevel = product.nearest?.level;
    const nearestAlert = nearestLevel === 'expired' || nearestLevel === 'soon';
    // 品名の下の一行は1つだけ。対応が要るものを先に（不足 → 期限 → 点検）。
    const note =
      shortage > 0 && status
        ? { text: `あと${formatQuantity(shortage)}${status.target.unit}不足`, alert: true }
        : product.nearest && nearestAlert
          ? { text: expiryCountdown(product.nearest.on, today), alert: true }
          : product.inspect?.due
            ? { text: '点検の時期', alert: true }
            : product.nearest
              ? { text: expiryCountdown(product.nearest.on, today), alert: false }
              : product.inspect
                ? { text: `点検まで${spanText(daysBetween(today, product.inspect.next))}`, alert: false }
                : null;
    return (
      <li key={product.key}>
        <button
          type="button"
          onClick={() => setDetailKey(product.key)}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium leading-snug text-gray-900">{product.name}</span>
            {note && (
              <span className={`block text-[11px] font-bold tabular-nums ${note.alert ? 'text-red-700' : 'text-gray-400'}`}>
                {note.text}
              </span>
            )}
          </span>
          <span className="shrink-0 text-right tabular-nums">
            <span className="text-lg font-extrabold text-gray-900">{formatQuantity(product.total)}</span>
            <span className="ml-0.5 text-[11px] font-bold text-gray-400">{product.unit}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <>
      {summary}

      {categories.length > 1 && (
        <div className="shrink-0 -mx-4 flex gap-4 overflow-x-auto border-b border-gray-200 px-4">
          {[ALL, ...categories.map((row) => row.category)].map((value) => {
            const selected = value === activeCategory;
            return (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(value)}
                className={`shrink-0 border-b-[2.5px] pb-1.5 pt-1 text-[13px] font-bold transition ${
                  selected ? 'border-orange-400 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {value === ALL ? 'すべて' : value}
              </button>
            );
          })}
        </div>
      )}

      <div ref={attachContent} className="flex-1 min-h-0 overflow-y-auto space-y-3 pt-2.5 pb-6" {...swipeHandlers}>
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">備蓄はまだありません</p>
        ) : (
          shown.map((row) => (
            <section key={row.category}>
              <h2 className="mb-1 flex items-baseline gap-1.5 px-0.5">
                <span className="text-[15px] font-extrabold text-gray-900">{row.category}</span>
                <span className="text-xs font-bold text-gray-400">{row.products.length}</span>
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
                {row.products.map(productRow)}
              </ul>
            </section>
          ))
        )}
      </div>

      {detail && (
        <StockProductDetail
          product={detail}
          today={today}
          onClose={() => setDetailKey(null)}
          onEditTarget={(target) => {
            setDetailKey(null);
            onEditTarget(target);
          }}
          onEditItem={(item) => {
            setDetailKey(null);
            onEditItem(item);
          }}
        />
      )}

      {attentionOpen && (
        <StockAttention
          board={board}
          inspectable={inspectable}
          today={today}
          onClose={() => setAttentionOpen(false)}
          onEditItem={(item) => {
            setAttentionOpen(false);
            onEditItem(item);
          }}
          onSendShortage={onSendShortage}
          onRestock={(item) => {
            setAttentionOpen(false);
            onRestock(item);
          }}
          onUse={onUse}
          onDiscard={onDiscard}
          onInspect={onInspect}
          onOpenBag={() => {
            setAttentionOpen(false);
            onBagOpenChange(true);
          }}
        />
      )}

      {bagOpen && (
        <StockBagCheck
          board={board}
          items={items}
          plan={plan}
          today={today}
          onClose={() => onBagOpenChange(false)}
          onEditItem={(item) => {
            onBagOpenChange(false);
            onEditItem(item);
          }}
          onInspect={onInspect}
        />
      )}
    </>
  );
}
