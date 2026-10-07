'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, ListPlus, Minus, Plus } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import {
  buildStockBoard,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  nextInspectionOn,
  STORAGE_LABEL,
  unitPriceOf,
  type ExpiryLevel,
  type StockPlan,
  type StockStorage,
} from '@/lib/stockUtils';
import SegmentedTabs from '../ui/SegmentedTabs';

// 防災備蓄の画面（docs/home.md §10.2・§10.2.1）。状態を見渡す「点検盤」。
// mobile版の `mobile/src/components/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 上（固定）: 備えの状況（件数・費用）と、保管場所（寝室／持ち出し）の切り替え。
// 中（スクロール）: 要対応 → 目標ごとの塊（期限順と必要数を1つに）→ その他の備品 → 備品（期限なし）。
// 持ち出しは、バッグの中身のチェック表にする。

const LEVEL_TEXT: Record<ExpiryLevel, string> = {
  expired: 'text-red-700',
  soon: 'text-red-700',
  year: 'text-orange-700',
  ok: 'text-gray-500',
  none: 'text-gray-400',
};

const STORAGE_OPTIONS: { id: StockStorage; label: string }[] = [
  { id: 'home', label: STORAGE_LABEL.home },
  { id: 'carry', label: STORAGE_LABEL.carry },
];

type PlanKey = keyof StockPlan;
type Anchor = 'short' | 'replacement' | 'inspect';

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

const dotted = (parts: (string | false | null | undefined)[]) => parts.filter((part) => part).join('・');
const dateText = (on: string) => formatExpiry({ expiresOn: on, expiresMonthOnly: false });

const cardClass = 'bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden';
const primaryButton = 'shrink-0 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-bold hover:bg-blue-600';
const secondaryButton = 'shrink-0 px-2.5 py-1.5 rounded-lg bg-gray-100 text-xs font-bold text-gray-700 hover:bg-gray-200';

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
  const { counts, overview, attention } = board;
  const anchors = useRef<Partial<Record<Anchor, HTMLElement | null>>>({});
  // 持ち出しのチェック表で、確かめたロット（この画面の中だけ。点検した日の記録は「点検した」で行う）。
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const jump = (anchor: Anchor) => {
    if (storage !== 'home') onStorageChange('home');
    // 保管場所を戻した描画のあとで動かす。
    requestAnimationFrame(() => anchors.current[anchor]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const bagDue = attention.bag?.due === true;
  const inspectCount = counts.inspect + (bagDue ? 1 : 0);
  const badges = [
    counts.short > 0 && { key: 'short', anchor: 'short' as const, text: `不足 ${counts.short}品目`, warm: true },
    counts.carryShort > 0 && {
      key: 'carry',
      anchor: 'short' as const,
      text: `持ち出し不足 ${counts.carryShort}品目`,
      warm: true,
    },
    counts.expired > 0 && { key: 'expired', anchor: 'replacement' as const, text: `期限切れ ${counts.expired}件`, warm: false },
    counts.soon > 0 && { key: 'soon', anchor: 'replacement' as const, text: `3か月以内 ${counts.soon}件`, warm: false },
    inspectCount > 0 && { key: 'inspect', anchor: 'inspect' as const, text: `点検の時期 ${inspectCount}件`, warm: true },
  ].filter((badge) => badge !== false);

  const confirmDiscard = (item: StockItem) => {
    if (window.confirm(`${item.name}を処分しますか？\n備蓄から削除します。`)) onDiscard(item);
  };

  const storageTag = (item: StockItem) =>
    item.storage === 'carry' && (
      <span className="px-1.5 rounded bg-blue-50 text-[10px] font-bold text-blue-700">{STORAGE_LABEL.carry}</span>
    );

  const lotRow = (item: StockItem) => {
    const level = expiryLevel(item.expiresOn, today);
    const unit = unitPriceOf(item);
    const target = targets.find((row) => row.id === item.targetId);
    const price = item.price === null ? null : `${formatYen(item.price)}/${item.unit || '個'}`;
    const perUnit = unit !== null && target ? `${formatYen(unit)}/${target.unit}` : null;
    const sub = dotted([item.note, price, perUnit]);
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => onEditItem(item)}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900">{item.name}</p>
            {sub !== '' && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
          </div>
          <div className="shrink-0 text-right tabular-nums">
            <p className="text-[13px] font-bold text-gray-700">
              {formatQuantity(item.quantity)}
              {item.unit}
            </p>
            <p className={`text-[11px] font-bold mt-0.5 ${LEVEL_TEXT[level]}`}>
              {item.expiresOn ? `${level === 'expired' ? '切れ ' : ''}${formatExpiry(item)}` : '期限なし'}
            </p>
          </div>
        </button>
      </li>
    );
  };

  const inspectionLine = (item: StockItem) => {
    if (item.inspectIntervalMonths === null) return '点検しない';
    const next = nextInspectionOn(item);
    return dotted([
      `${item.inspectIntervalMonths}か月ごと`,
      item.inspectedOn ? `前回 ${dateText(item.inspectedOn)}` : '未点検',
      next && `次 ${dateText(next)}`,
    ]);
  };

  const stepper = (key: PlanKey, label: string, suffix: string) => (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-bold text-gray-500">{label}</span>
      <button
        type="button"
        aria-label={`${label}を減らす`}
        onClick={() => onStepPlan(key, -1)}
        className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
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
        className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
      >
        <Plus size={14} />
      </button>
    </div>
  );

  // ---- 持ち出し: バッグの中身のチェック表 ----
  const bagLots = items.filter((item) => item.storage === 'carry' && item.quantity > 0);
  const bagByCategory = bagLots.reduce<Record<string, StockItem[]>>((groups, item) => {
    const key = item.category.trim() || 'その他';
    (groups[key] ??= []).push(item);
    return groups;
  }, {});
  const carryShortages = board.blocks.filter((block) => (block.status.carry?.shortage ?? 0) > 0);

  const carryView = (
    <>
      {attention.bag && (
        <div
          className={`flex items-center gap-3 rounded-xl border p-3 ${
            attention.bag.due ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
          }`}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-gray-900">{plan.carryDays}日分のバッグの点検</p>
            <p className={`text-[11px] mt-0.5 ${attention.bag.due ? 'text-red-700' : 'text-gray-400'}`}>
              {attention.bag.lastOn ? `前回 ${dateText(attention.bag.lastOn)}` : '未点検'}・次 {dateText(attention.bag.nextOn)}
              {attention.bag.due ? '（時期です）' : ''}
            </p>
          </div>
          <button type="button" onClick={() => onInspect(bagLots)} className={primaryButton}>
            点検した
          </button>
        </div>
      )}
      {carryShortages.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-1">
          <p className="text-[13px] font-bold text-red-700">足りないもの</p>
          {carryShortages.map(({ status }) => (
            <p key={status.target.id} className="text-[13px] font-bold text-red-700 tabular-nums">
              {status.target.name} {formatQuantity(status.carry?.have ?? 0)} / {formatQuantity(status.carry?.required ?? 0)}
              {status.target.unit}
            </p>
          ))}
        </div>
      )}
      {bagLots.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">持ち出しバッグには何も入っていません</p>
      ) : (
        Object.entries(bagByCategory).map(([category, rows]) => (
          <section key={category}>
            <h3 className="text-xs font-bold text-gray-500 mb-1.5">{category}</h3>
            <ul className={cardClass}>
              {rows.map((item) => {
                const on = checked.has(item.id);
                const level = expiryLevel(item.expiresOn, today);
                return (
                  <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${item.name}を確かめた`}
                      onClick={() =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                      className={`shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center ${
                        on ? 'bg-green-700 border-green-700 text-white' : 'border-gray-300 text-transparent'
                      }`}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditItem(item)}
                      className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
                    >
                      <span className="flex-1 min-w-0 text-sm font-bold text-gray-900">{item.name}</span>
                      <span className="shrink-0 text-[13px] font-bold text-gray-700 tabular-nums">
                        {formatQuantity(item.quantity)}
                        {item.unit}
                      </span>
                      <span className={`shrink-0 min-w-16 text-right text-[11px] font-bold tabular-nums ${LEVEL_TEXT[level]}`}>
                        {item.expiresOn ? formatExpiry(item) : '—'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {bagLots.length > 0 && (
        <p className="text-[11px] text-gray-400 text-center">チェックはこの画面の中だけ。「点検した」で日付を残します</p>
      )}
    </>
  );

  // ---- 寝室: 要対応 → 目標ごとの塊 → その他 → 備品 ----
  const hasAttention =
    attention.short.length > 0 || attention.replacement.lots.length > 0 || attention.inspect.length > 0 || bagDue;

  const homeView = (
    <>
      {hasAttention && <h3 className="text-[15px] font-bold text-gray-900">要対応</h3>}

      {attention.short.length > 0 && (
        <section ref={(el) => void (anchors.current.short = el)}>
          <h4 className="text-xs font-bold text-red-700 mb-1.5">足りないもの {attention.short.length}品目</h4>
          <ul className={cardClass}>
            {attention.short.map(({ status, cost }) => {
              const { target, shortage, carry } = status;
              return (
                <li key={target.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{target.name}</p>
                    <p className="text-[11px] text-red-700 mt-0.5">
                      {dotted([
                        shortage > 0 && `あと${formatQuantity(shortage)}${target.unit}不足`,
                        carry && carry.shortage > 0 && `持ち出し あと${formatQuantity(carry.shortage)}${target.unit}`,
                      ])}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                      {cost.shortageCost !== null && shortage > 0
                        ? `買い足し ${formatYen(cost.shortageCost)}`
                        : cost.unitPrice === null
                          ? '値段未登録'
                          : ''}
                    </p>
                  </div>
                  {shortage > 0 && (
                    <button
                      type="button"
                      aria-label={`${target.name}の不足を買い出しリストへ`}
                      onClick={() => onSendShortage(target, shortage)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-bold hover:bg-red-200"
                    >
                      <ListPlus size={16} />
                      リストへ
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {attention.replacement.lots.length > 0 && (
        <section ref={(el) => void (anchors.current.replacement = el)}>
          <h4 className="text-xs font-bold text-red-700 mb-1.5">
            期限が近い・切れた {attention.replacement.lots.length}件
            {attention.replacement.total > 0 ? `・買い替え見込み ${formatYen(attention.replacement.total)}` : ''}
            {attention.replacement.unpriced > 0 ? `（値段未登録 ${attention.replacement.unpriced}件は含まず）` : ''}
          </h4>
          <ul className={cardClass}>
            {attention.replacement.lots.map(({ item, level, amount }) => (
              <li key={item.id} className="pb-2.5">
                <button
                  type="button"
                  onClick={() => onEditItem(item)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                      {storageTag(item)}
                      {item.name}
                    </p>
                    {item.note !== '' && <p className="text-[11px] text-gray-400 mt-0.5">{item.note}</p>}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p className="text-[13px] font-bold text-gray-700">
                      {formatQuantity(item.quantity)}
                      {item.unit}
                    </p>
                    <p className={`text-[11px] font-bold mt-0.5 ${LEVEL_TEXT[level]}`}>
                      {level === 'expired' ? '切れ ' : ''}
                      {formatExpiry(item)}
                    </p>
                    <p className="text-[11px] font-bold mt-0.5 text-gray-500">
                      {amount === null ? '値段未登録' : formatYen(amount)}
                    </p>
                  </div>
                </button>
                <div className="flex flex-wrap gap-1.5 px-3">
                  <button type="button" onClick={() => onRestock(item)} className={primaryButton}>
                    買い替えた
                  </button>
                  <button type="button" onClick={() => onUse(item)} className={secondaryButton}>
                    食べた・使った −1
                  </button>
                  <button type="button" onClick={() => confirmDiscard(item)} className={`${secondaryButton} text-red-500`}>
                    処分
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(attention.inspect.length > 0 || bagDue) && (
        <section ref={(el) => void (anchors.current.inspect = el)}>
          <h4 className="text-xs font-bold text-red-700 mb-1.5">点検の時期</h4>
          <ul className={cardClass}>
            {attention.bag?.due && (
              <li className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">持ち出しバッグ</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {attention.bag.lastOn ? `前回 ${dateText(attention.bag.lastOn)}` : '未点検'}・中身を確かめましょう
                  </p>
                </div>
                <button type="button" onClick={() => onStorageChange('carry')} className={primaryButton}>
                  チェック表へ
                </button>
              </li>
            )}
            {attention.inspect.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                <button type="button" onClick={() => onEditItem(item)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-bold text-gray-900">{item.name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{inspectionLine(item)}</p>
                </button>
                <button type="button" onClick={() => onInspect([item])} className={primaryButton}>
                  点検した
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-1.5 pt-1">
        <h3 className="text-[15px] font-bold text-gray-900">目標ごとの備え</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {stepper('people', '人数', '人')}
          {stepper('days', '日数', '日')}
          {stepper('carryDays', '持ち出し', '日')}
        </div>
      </div>

      {board.blocks.map(({ status, cost, lots }) => {
        const { target, required, have, shortage, carry } = status;
        const homeLots = lots.filter((item) => item.storage === 'home');
        const ratio = required > 0 ? Math.min(1, have / required) : 1;
        const rule = target.perPersonDay
          ? `1人1日 ${formatQuantity(target.quantity)}${target.unit}・${plan.people}人で ${formatQuantity(cost.daily ?? 0)}${target.unit}/日`
          : '決まった数';
        return (
          <section key={target.id} className={`${cardClass} ${shortage > 0 ? 'border-red-200' : ''}`}>
            <button
              type="button"
              aria-label={`${target.name}の必要数を直す`}
              onClick={() => onEditTarget(target)}
              className="w-full px-3 py-2.5 text-left space-y-1 hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <p className="flex-1 min-w-0 text-[15px] font-bold text-gray-900">{target.name}</p>
                <p className="shrink-0 text-[13px] font-bold text-gray-700 tabular-nums">
                  {formatQuantity(have)} / {formatQuantity(required)}
                  {target.unit}
                </p>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${shortage > 0 ? 'bg-red-700' : 'bg-green-700'}`}
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-400">{dotted([rule, target.note])}</p>
              <p className={`text-[11px] ${shortage > 0 ? 'text-red-700' : 'text-green-700'}`}>
                {shortage > 0 ? `あと${formatQuantity(shortage)}${target.unit} 不足` : '足りています'}
                {carry
                  ? `・持ち出し ${formatQuantity(carry.have)} / ${formatQuantity(carry.required)}${target.unit}${carry.shortage > 0 ? ' 不足' : ''}`
                  : ''}
              </p>
              <p className="text-[11px] text-gray-400 tabular-nums">
                {cost.unitPrice === null
                  ? '値段未登録'
                  : dotted([
                      `${plan.days}日分 ${formatYen(cost.total ?? 0)}`,
                      shortage > 0 && `買い足し ${formatYen(cost.shortageCost ?? 0)}`,
                      `${target.unit}あたり ${formatYen(cost.unitPrice)}`,
                    ])}
              </p>
            </button>
            {homeLots.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-gray-400">寝室にはありません</p>
            ) : (
              <ul className="divide-y divide-gray-200">{homeLots.map(lotRow)}</ul>
            )}
          </section>
        );
      })}

      {board.others.some((item) => item.storage === 'home') && (
        <section>
          <h3 className="text-xs font-bold text-gray-500 mb-1.5">その他の備品</h3>
          <ul className={cardClass}>{board.others.filter((item) => item.storage === 'home').map(lotRow)}</ul>
        </section>
      )}

      {board.equipment.length > 0 && (
        <section>
          <div className="flex items-center mb-1.5">
            <h3 className="flex-1 text-xs font-bold text-gray-500">備品（期限なし）</h3>
            {board.equipment.some((item) => item.inspectIntervalMonths !== null) && (
              <button
                type="button"
                onClick={() => onInspect(board.equipment.filter((item) => item.inspectIntervalMonths !== null))}
                className={secondaryButton}
              >
                まとめて点検した
              </button>
            )}
          </div>
          <ul className={cardClass}>
            {board.equipment.map((item) => {
              const due = item.inspectIntervalMonths !== null && (nextInspectionOn(item) ?? '9999') <= today;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onEditItem(item)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                        {storageTag(item)}
                        {item.name}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${due ? 'text-red-700' : 'text-gray-400'}`}>
                        {dotted([item.category, inspectionLine(item)])}
                      </p>
                    </div>
                    <p className="shrink-0 text-[13px] font-bold text-gray-700 tabular-nums">
                      {formatQuantity(item.quantity)}
                      {item.unit}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <button
        type="button"
        onClick={onAddTarget}
        className="w-full flex items-center justify-center gap-1 py-2.5 text-xs font-bold text-blue-600"
      >
        <Plus size={14} />
        目標（必要数）を追加
      </button>
    </>
  );

  return (
    <>
      <div className="shrink-0 space-y-1.5 pb-2">
        {badges.length === 0 ? (
          <p className="text-xs text-gray-500">不足も、期限が近いものも、点検の時期のものもありません</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <button
                key={badge.key}
                type="button"
                aria-label={`${badge.text}の要対応へ`}
                onClick={() => jump(badge.anchor)}
                className={`px-2 py-1 rounded-lg text-xs font-bold ${
                  badge.warm ? 'bg-orange-50 text-orange-700' : 'bg-red-100 text-red-700'
                }`}
              >
                {badge.text}
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-500 tabular-nums">
          {plan.people}人×{plan.days}日分を揃える {formatYen(overview.total)}・足りない分の買い足し{' '}
          {formatYen(overview.shortageTotal)}
          {overview.unpricedTargets > 0 ? `（値段未登録 ${overview.unpricedTargets}品目は含まず）` : ''}
        </p>
      </div>

      <SegmentedTabs
        ariaLabel="保管場所"
        value={storage}
        onChange={onStorageChange}
        options={STORAGE_OPTIONS}
        className="shrink-0 mb-2"
      />

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-6">{storage === 'home' ? homeView : carryView}</div>
    </>
  );
}
