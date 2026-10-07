'use client';

import { useMemo, useState } from 'react';
import { Backpack, Check, ChevronRight, Clock, Minus, Plus, Settings2, Wrench } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import {
  buildStockBoard,
  daysBetween,
  expiryCountdown,
  formatQuantity,
  formatYen,
  spanText,
  type StockPlan,
  type StockProduct,
} from '@/lib/stockUtils';
import StockAttention from './StockAttention';
import StockBagCheck from './StockBagCheck';
import StockProductDetail from './StockProductDetail';
import { readinessColor, Ring, StockIcon } from './stockVisual';

// 防災備蓄の画面（docs/home.md §10.2・§10.2.1）。mobile版の
// `mobile/src/components/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 主役は「どんな備蓄が、どれだけあるか」。カテゴリごとに品目の行を並べ、全体の数を大きく出す。
// 期限・不足・点検は品目に付く補助の情報なので、行の小さな一行と、上の細い帯から開く
// 「確認が必要なもの」（StockAttention）に置く。色は淡い橙と、対応が要るものの赤だけ。
//   上（固定）: 確認が必要なものの帯と「バッグ」・カテゴリの絞り込み。
//   中（スクロール）: 備え度 → カテゴリごとの品目の行（寝室・持ち出し用の内訳は品目の詳しい画面）。
//   「バッグ」は、バッグの中身を押して確かめるチェック表（StockBagCheck）を開く。

type PlanKey = keyof StockPlan;

interface StockBoardProps {
  items: StockItem[];
  targets: StockTarget[];
  plan: StockPlan;
  /** 日本時間の今日（YYYY-MM-DD）。 */
  today: string;
  onEditItem: (item: StockItem) => void;
  onEditTarget: (target: StockTarget) => void;
  onAddTarget: () => void;
  onStepPlan: (key: PlanKey, delta: number) => void;
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

const tileClass = 'rounded-2xl border border-gray-200 bg-white';

export default function StockBoard({
  items,
  targets,
  plan,
  today,
  onEditItem,
  onEditTarget,
  onAddTarget,
  onStepPlan,
  onSendShortage,
  onRestock,
  onUse,
  onDiscard,
  onInspect,
}: StockBoardProps) {
  const board = useMemo(() => buildStockBoard(items, targets, plan, today), [items, targets, plan, today]);
  const { counts, overview, attention, readiness, categories } = board;
  const [showPlan, setShowPlan] = useState(false);
  const [category, setCategory] = useState(ALL);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);

  const bagDue = attention.bag?.due === true;
  const expiryCount = counts.expired + counts.soon;
  const shortCount = attention.short.length;
  const inspectCount = counts.inspect + (bagDue ? 1 : 0);
  const attentionCount = expiryCount + shortCount + inspectCount;

  // 絞り込んでいたカテゴリが無くなったら「すべて」へ戻す。
  const activeCategory = categories.some((row) => row.category === category) ? category : ALL;
  const shown = activeCategory === ALL ? categories : categories.filter((row) => row.category === activeCategory);
  const detail = categories.flatMap((row) => row.products).find((product) => product.key === detailKey) ?? null;
  const inspectable = board.equipment.filter((item) => item.inspectIntervalMonths !== null);

  // ---- 上の細い帯 ----
  const banner =
    attentionCount > 0 ? (
      <button
        type="button"
        onClick={() => setAttentionOpen(true)}
        className="min-w-0 flex-1 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-left hover:bg-gray-50"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
        <span className="text-[13px] font-bold text-gray-900">確認が必要 {attentionCount}件</span>
        <span className="flex-1 min-w-0 truncate text-[11px] font-bold text-gray-400">
          {[
            expiryCount > 0 && `期限 ${expiryCount}`,
            shortCount > 0 && `不足 ${shortCount}`,
            inspectCount > 0 && `点検 ${inspectCount}`,
          ]
            .filter(Boolean)
            .join('・')}
        </span>
        <ChevronRight size={15} className="shrink-0 text-gray-300" />
      </button>
    ) : (
      <p className="min-w-0 flex-1 flex items-center gap-1.5 px-1 py-1.5 text-[11px] font-bold text-gray-400">
        <Check size={13} />
        確認が必要なものはありません
      </p>
    );

  // ---- 帯の右の「バッグ」（持ち出しバッグの点検を開く。点検の時期だけ赤い点） ----
  const bagButton = (
    <button
      type="button"
      aria-label={bagDue ? '持ち出しバッグを点検する（点検の時期です）' : '持ち出しバッグを点検する'}
      onClick={() => setBagOpen(true)}
      className="relative flex shrink-0 items-center gap-1 rounded-xl bg-orange-100 px-2.5 py-1.5 text-xs font-bold text-orange-800 hover:bg-orange-200"
    >
      <Backpack size={14} />
      バッグ
      {bagDue && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-gray-50 bg-red-400" />}
    </button>
  );

  // ---- 備え度（1行） ----
  const ringColor = readinessColor(readiness);
  const summary = (
    <section className={`${tileClass} px-3 py-1.5`}>
      <div className="flex items-center gap-2.5">
        <Ring size={36} stroke={5} ratio={readiness / 100} color={ringColor}>
          <span className="text-[10px] font-bold tabular-nums" style={{ color: ringColor }}>
            {readiness}
          </span>
        </Ring>
        <p className="flex-1 min-w-0 truncate text-[12px] font-bold text-gray-900">
          {plan.people}人×{plan.days}日分
          <span className="ml-2 font-medium text-gray-400 tabular-nums">
            {overview.shortageTotal > 0
              ? `あと ${formatYen(overview.shortageTotal)}${overview.unpricedTargets > 0 ? '＋' : ''} で揃う`
              : overview.unpricedTargets > 0
                ? '値段を入れると費用が出ます'
                : '必要な量が揃っています'}
          </span>
        </p>
        <button
          type="button"
          aria-label="人数・日数を変える"
          aria-expanded={showPlan}
          onClick={() => setShowPlan((prev) => !prev)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-50 text-orange-500"
        >
          <Settings2 size={14} />
        </button>
      </div>
      {showPlan && (
        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2">
          {(
            [
              ['people', '人数', '人'],
              ['days', '日数', '日'],
              ['carryDays', 'バッグ', '日'],
            ] as [PlanKey, string, string][]
          ).map(([key, label, suffix]) => (
            <div key={key} className="flex flex-col items-center gap-1">
              <span className="text-[11px] font-bold text-gray-400">{label}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`${label}を減らす`}
                  onClick={() => onStepPlan(key, -1)}
                  className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
                >
                  <Minus size={14} />
                </button>
                <span className="min-w-8 text-center text-sm font-bold text-gray-900 tabular-nums">
                  {plan[key]}
                  {suffix}
                </span>
                <button
                  type="button"
                  aria-label={`${label}を増やす`}
                  onClick={() => onStepPlan(key, 1)}
                  className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  // ---- 品目の行（リスト。品名は全部見せ、数量を右に大きく） ----
  const listClass = 'rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden';

  const productRow = (product: StockProduct<StockItem, StockTarget>) => {
    const status = product.target?.status ?? null;
    const shortage = status?.shortage ?? 0;
    const required = status?.required ?? 0;
    const ratio = status && required > 0 ? Math.min(1, status.have / required) : null;
    const nearestLevel = product.nearest?.level;
    const nearestAlert = nearestLevel === 'expired' || nearestLevel === 'soon';
    const hasNotes = shortage > 0 || product.nearest !== null || product.inspect !== null;
    return (
      <li key={product.key}>
        <button
          type="button"
          onClick={() => setDetailKey(product.key)}
          className="relative flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-gray-50"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-500">
            <StockIcon name={product.name} category={product.category} size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold leading-tight text-gray-900">{product.name}</span>
            {hasNotes && (
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] font-bold leading-tight tabular-nums">
                {shortage > 0 && status && (
                  <span className="text-red-700">
                    あと{formatQuantity(shortage)}
                    {status.target.unit}不足
                  </span>
                )}
                {product.nearest && (
                  <span className={`flex items-center gap-0.5 ${nearestAlert ? 'text-red-700' : 'text-gray-400'}`}>
                    <Clock size={9} />
                    {expiryCountdown(product.nearest.on, today)}
                  </span>
                )}
                {product.inspect && (
                  <span className={`flex items-center gap-0.5 ${product.inspect.due ? 'text-red-700' : 'text-gray-400'}`}>
                    <Wrench size={9} />
                    {product.inspect.due ? '点検の時期' : `点検まで${spanText(daysBetween(today, product.inspect.next))}`}
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="shrink-0 text-right leading-tight tabular-nums">
            <span className="text-base font-bold text-gray-900">{formatQuantity(product.total)}</span>
            <span className="ml-0.5 text-[10px] font-bold text-gray-400">{product.unit}</span>
          </span>
          {ratio !== null && (
            <span className="absolute inset-x-2.5 bottom-0 block h-[2px] overflow-hidden rounded-full bg-gray-100">
              <span
                className={`block h-full ${shortage > 0 ? 'bg-red-400' : 'bg-orange-300'}`}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
          )}
        </button>
      </li>
    );
  };

  const categoryHeader = (name: string, count: number) => (
    <h2 className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-gray-900">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-orange-600">
        <StockIcon name={name} size={11} />
      </span>
      {name}
      <span className="text-[11px] font-bold text-gray-400">{count}</span>
    </h2>
  );

  const homeView = (
    <>
      {summary}
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">備蓄はまだありません</p>
      ) : (
        shown.map((row) => (
          <section key={row.category}>
            {categoryHeader(row.category, row.products.length)}
            <ul className={listClass}>{row.products.map(productRow)}</ul>
          </section>
        ))
      )}
      <button
        type="button"
        onClick={onAddTarget}
        className="flex w-full items-center justify-center gap-1 py-1.5 text-xs font-bold text-gray-500"
      >
        <Plus size={14} />
        目標（必要数）を追加
      </button>
    </>
  );

  return (
    <>
      <div className="shrink-0 mb-1.5 flex items-center gap-1.5">
        {banner}
        {bagButton}
      </div>

      {categories.length > 1 && (
        <div className="shrink-0 flex gap-1.5 overflow-x-auto pb-1.5">
          {[ALL, ...categories.map((row) => row.category)].map((value) => {
            const selected = value === activeCategory;
            return (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(value)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold transition ${
                  selected ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {value === ALL ? 'すべて' : value}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-6">{homeView}</div>

      {detail && (
        <StockProductDetail
          product={detail}
          plan={plan}
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
            setBagOpen(true);
          }}
        />
      )}

      {bagOpen && (
        <StockBagCheck
          board={board}
          items={items}
          plan={plan}
          today={today}
          onClose={() => setBagOpen(false)}
          onEditItem={(item) => {
            setBagOpen(false);
            onEditItem(item);
          }}
          onInspect={onInspect}
        />
      )}
    </>
  );
}
