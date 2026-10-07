'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronRight, Clock, Minus, Pencil, Plus, Settings2, Wrench } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import {
  buildStockBoard,
  daysBetween,
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  spanText,
  type StockPlan,
  type StockProduct,
  type StockStorage,
} from '@/lib/stockUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import StockAttention from './StockAttention';
import StockProductDetail from './StockProductDetail';
import { readinessColor, Ring, StockIcon, TONE } from './stockVisual';

// 防災備蓄の画面（docs/home.md §10.2・§10.2.1）。mobile版の
// `mobile/src/components/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 主役は「どんな備蓄が、どれだけあるか」。カテゴリごとに品目をタイルで並べ、数量を大きく出す。
// 期限・不足・点検は品目に付く補助の情報なので、タイルの小さな一行と、上の細い帯から開く
// 「確認が必要なもの」（StockAttention）に置く。色は赤（対応が要るもの）以外は使わない。
//   上（固定）: 確認が必要なものの帯・備蓄／持ち出しの切り替え・カテゴリの絞り込み。
//   中（スクロール）: 備え度 → カテゴリごとの品目タイル。
//   持ち出しは、バッグの中身を押して確かめるチェック表（カテゴリごと）。

const STORAGE_OPTIONS: { id: StockStorage; label: string }[] = [
  { id: 'home', label: '寝室' },
  { id: 'carry', label: '持ち出し用' },
];

type PlanKey = keyof StockPlan;

interface StockBoardProps {
  items: StockItem[];
  targets: StockTarget[];
  plan: StockPlan;
  /** 日本時間の今日（YYYY-MM-DD）。 */
  today: string;
  storage: StockStorage;
  onStorageChange: (storage: StockStorage) => void;
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

const dateText = (on: string) => formatExpiry({ expiresOn: on, expiresMonthOnly: false });

/** 絞り込みの「すべて」。 */
const ALL = '';

const tileClass = 'rounded-2xl border border-gray-200 bg-white';

export default function StockBoard({
  items,
  targets,
  plan,
  today,
  storage,
  onStorageChange,
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
  // 持ち出しのチェック表で、確かめたロット（この画面の中だけ。点検した日の記録は「点検完了」で行う）。
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showPlan, setShowPlan] = useState(false);
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
  const detail = categories.flatMap((row) => row.products).find((product) => product.key === detailKey) ?? null;
  const inspectable = board.equipment.filter((item) => item.inspectIntervalMonths !== null);

  const bagAge = attention.bag?.lastOn
    ? `${spanText(daysBetween(attention.bag.lastOn, today))}前に点検`
    : 'まだ点検していません';

  // ---- 上の細い帯 ----
  const banner =
    attentionCount > 0 ? (
      <button
        type="button"
        onClick={() => setAttentionOpen(true)}
        className="shrink-0 mb-1.5 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-left hover:bg-gray-50"
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
      <p className="shrink-0 mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-bold text-gray-400">
        <Check size={13} />
        確認が必要なものはありません
      </p>
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
            {product.carryTotal > 0 && (
              <span className="block text-[10px] font-bold text-gray-300">バッグ{formatQuantity(product.carryTotal)}</span>
            )}
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

  // ---- 持ち出し: バッグの中身を押して確かめる（カテゴリごと） ----
  const bagLots = items.filter((item) => item.storage === 'carry' && item.quantity > 0);
  const doneCount = bagLots.filter((item) => checked.has(item.id)).length;
  const allChecked = bagLots.length > 0 && doneCount === bagLots.length;
  const carryShortages = board.blocks.filter((block) => (block.status.carry?.shortage ?? 0) > 0);
  const bagByCategory = bagLots.reduce<Record<string, StockItem[]>>((groups, item) => {
    const key = item.category.trim() || 'その他';
    (groups[key] ??= []).push(item);
    return groups;
  }, {});

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const carryView = (
    <>
      <section className={`${tileClass} flex items-center gap-3 px-3 py-2`}>
        <Ring size={44} stroke={5} ratio={bagLots.length === 0 ? 0 : doneCount / bagLots.length} color={TONE.accent}>
          <span className="text-[11px] font-bold tabular-nums text-gray-900">
            {doneCount}/{bagLots.length}
          </span>
        </Ring>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-gray-900">{plan.carryDays}日分のバッグ</p>
          <p className={`text-[11px] font-bold ${bagDue ? 'text-red-700' : 'text-gray-400'}`}>
            {attention.bag ? `${bagAge}${bagDue ? '・点検の時期です' : `・次は ${dateText(attention.bag.nextOn)} ごろ`}` : 'バッグは空です'}
          </p>
        </div>
      </section>

      {carryShortages.length > 0 && (
        <section className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-[11px] font-bold text-gray-500">足りない</span>
          {carryShortages.map(({ status }) => (
            <span
              key={status.target.id}
              className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 tabular-nums"
            >
              {status.target.name} あと{formatQuantity(status.carry?.shortage ?? 0)}
              {status.target.unit}
            </span>
          ))}
        </section>
      )}

      {bagLots.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">持ち出しバッグには何も入っていません</p>
      ) : (
        Object.entries(bagByCategory).map(([name, rows]) => (
          <section key={name}>
            {categoryHeader(name, rows.length)}
            <ul className={listClass}>
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
                          on ? 'border-orange-300 bg-orange-200 text-orange-800' : 'border-gray-200 bg-white text-transparent'
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
                        <span className="text-base font-bold text-gray-900">{formatQuantity(item.quantity)}</span>
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
    </>
  );

  return (
    <>
      {banner}

      <SegmentedTabs
        ariaLabel="保管場所"
        value={storage}
        onChange={onStorageChange}
        options={STORAGE_OPTIONS}
        className="shrink-0 mb-1.5"
      />

      {storage === 'home' && categories.length > 1 && (
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

      <div className="relative flex-1 min-h-0">
        <div className="h-full overflow-y-auto space-y-2.5 pb-24">{storage === 'home' ? homeView : carryView}</div>
        {storage === 'carry' && bagLots.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent pt-4">
            <button
              type="button"
              disabled={!allChecked}
              onClick={() => {
                onInspect(bagLots);
                setChecked(new Set());
              }}
              className={`w-full rounded-2xl py-3.5 text-sm font-bold transition ${
                allChecked ? 'bg-orange-200 text-orange-900 hover:bg-orange-300' : 'bg-gray-200 text-gray-400'
              }`}
            >
              {allChecked ? '点検完了（今日の日付を残す）' : `あと${bagLots.length - doneCount}つ確かめましょう`}
            </button>
          </div>
        )}
      </div>

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
            onStorageChange('carry');
          }}
        />
      )}
    </>
  );
}
