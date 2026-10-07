'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Check,
  ClipboardCheck,
  Clock,
  ListPlus,
  PackageCheck,
  Pencil,
  Plus,
  Settings2,
  ShoppingCart,
  Trash2,
  Utensils,
  Wrench,
  Minus,
} from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import {
  buildStockBoard,
  daysBetween,
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  nextInspectionOn,
  spanText,
  STORAGE_LABEL,
  type StockPlan,
  type StockStorage,
} from '@/lib/stockUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import StockTargetDetail from './StockTargetDetail';
import { readinessColor, Ring, StockIcon, TONE } from './stockVisual';

// 防災備蓄の画面（docs/home.md §10.2・§10.2.1）。状態を見渡す「点検盤」。
// mobile版の `mobile/src/components/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 文字の一覧ではなく、図で読む画面にする:
//   上（固定）: 期限・不足・点検の3つの状況タイルと、保管場所（寝室／持ち出し）の切り替え。
//   中（スクロール）: 備え度のリング → 期限の見通し → 要対応 → 目標のタイル → 備品のタイル。
//   持ち出しは、バッグの中身を押して確かめるチェック表。
// 費用・ロットは目標のタイルを押した詳しい画面（StockTargetDetail）に置く。

const STORAGE_OPTIONS: { id: StockStorage; label: string }[] = [
  { id: 'home', label: STORAGE_LABEL.home },
  { id: 'carry', label: STORAGE_LABEL.carry },
];

type PlanKey = keyof StockPlan;
type Anchor = 'replacement' | 'short' | 'inspect';

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

/** 期限の言い方の色。 */
const COUNTDOWN_CLASS = {
  expired: 'bg-red-50 text-red-700',
  soon: 'bg-red-50 text-red-700',
  year: 'bg-gray-100 text-gray-600',
  ok: 'bg-gray-100 text-gray-500',
  none: 'bg-gray-100 text-gray-400',
} as const;

const tileClass = 'rounded-2xl border bg-white';

/** 要対応の束で、初めから出すカードの数（残りは「ほかn件を見る」）。 */
const ATTENTION_LIMIT = 3;

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
  const { counts, overview, attention, readiness } = board;
  const anchors = useRef<Partial<Record<Anchor, HTMLElement | null>>>({});
  // 持ち出しのチェック表で、確かめたロット（この画面の中だけ。点検した日の記録は「点検完了」で行う）。
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showPlan, setShowPlan] = useState(false);
  const [expanded, setExpanded] = useState<Set<Anchor>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const bagDue = attention.bag?.due === true;
  const inspectCount = counts.inspect + (bagDue ? 1 : 0);
  const expiryCount = counts.expired + counts.soon;
  const shortCount = attention.short.length;

  const jump = (anchor: Anchor) => {
    if (storage !== 'home') onStorageChange('home');
    requestAnimationFrame(() => anchors.current[anchor]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const confirmDiscard = (item: StockItem) => {
    if (window.confirm(`${item.name}を処分しますか？\n備蓄から削除します。`)) onDiscard(item);
  };

  // ---- 上の3つの状況タイル ----
  const statusTile = (
    anchor: Anchor,
    label: string,
    count: number,
    tone: 'alert' | 'warn',
    Icon: typeof Clock,
  ) => {
    const active = count > 0;
    const surface = !active
      ? 'bg-white border-gray-200 text-gray-300'
      : tone === 'alert'
        ? 'bg-white border-red-300 text-red-700'
        : 'bg-white border-gray-400 text-gray-900';
    return (
      <button
        type="button"
        aria-label={active ? `${label} ${count}件の要対応へ` : `${label}は問題ありません`}
        disabled={!active}
        onClick={() => jump(anchor)}
        className={`flex-1 min-w-0 flex items-center gap-2 rounded-2xl border px-3 py-2 text-left ${surface}`}
      >
        {active ? <Icon size={20} strokeWidth={2.4} /> : <Check size={20} strokeWidth={2.8} />}
        <span className="flex flex-col leading-tight">
          <span className="text-xl font-bold tabular-nums">{count}</span>
          <span className="text-[11px] font-bold opacity-80">{label}</span>
        </span>
      </button>
    );
  };

  // ---- 備え度のリング ----
  const ringColor = readinessColor(readiness);
  const hero = (
    <section className={`${tileClass} border-gray-200 p-4`}>
      <div className="flex items-center gap-4">
        <Ring size={104} stroke={11} ratio={readiness / 100} color={ringColor}>
          <span className="flex flex-col items-center leading-none">
            <span className="text-2xl font-bold tabular-nums" style={{ color: ringColor }}>
              {readiness}
              <span className="text-xs">%</span>
            </span>
            <span className="text-[10px] font-bold text-gray-400 mt-1">備え度</span>
          </span>
        </Ring>
        <div className="flex-1 min-w-0 space-y-1.5">
          <button
            type="button"
            onClick={() => setShowPlan((prev) => !prev)}
            aria-expanded={showPlan}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700"
          >
            {plan.people}人 × {plan.days}日分
            <Settings2 size={13} />
          </button>
          <p className="text-sm font-bold text-gray-900 tabular-nums">
            {overview.shortageTotal > 0 ? (
              <>
                あと <span className="text-lg">{formatYen(overview.shortageTotal)}</span> で揃う
              </>
            ) : overview.unpricedTargets > 0 ? (
              '値段を入れると費用が出ます'
            ) : (
              '必要な量が揃っています'
            )}
          </p>
          {overview.total > 0 && (
            <p className="text-[11px] text-gray-400 tabular-nums">
              全部で {formatYen(overview.total)}
              {overview.unpricedTargets > 0 ? `（未登録 ${overview.unpricedTargets}品目を除く）` : ''}
            </p>
          )}
        </div>
      </div>
      {showPlan && (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
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

  // ---- 期限の見通し（1本の帯） ----
  const mix = [
    { key: 'expired', label: '切れ', count: counts.expired, color: '#dc2626' },
    { key: 'soon', label: '3か月内', count: counts.soon, color: '#374151' },
    { key: 'year', label: '1年内', count: counts.year, color: '#9ca3af' },
    { key: 'ok', label: 'それ以降', count: counts.ok, color: '#d1d5db' },
  ].filter((entry) => entry.count > 0);
  const mixTotal = mix.reduce((sum, entry) => sum + entry.count, 0);
  const outlook = mixTotal > 0 && (
    <section className={`${tileClass} border-gray-200 px-4 py-3`}>
      <p className="text-xs font-bold text-gray-500 mb-2">期限の見通し</p>
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
        {mix.map((entry) => (
          <div key={entry.key} style={{ width: `${(entry.count / mixTotal) * 100}%`, background: entry.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {mix.map((entry) => (
          <span key={entry.key} className="flex items-center gap-1 text-[11px] font-bold text-gray-600 tabular-nums">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
            {entry.label} {entry.count}
          </span>
        ))}
      </div>
    </section>
  );

  // ---- 要対応のカード ----
  const iconBubble = (item: { name: string; category: string }, tone: string) => (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`}>
      <StockIcon name={item.name} category={item.category} size={22} />
    </span>
  );

  const countdownChip = (item: StockItem) => {
    if (!item.expiresOn) return null;
    const level = expiryLevel(item.expiresOn, today);
    return (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${COUNTDOWN_CLASS[level]}`}>
        {expiryCountdown(item.expiresOn, today)}
      </span>
    );
  };

  const attentionBlock = (anchor: Anchor, title: string, tone: string, children: React.ReactNode[]) => {
    const open = expanded.has(anchor);
    const rows = open ? children : children.slice(0, ATTENTION_LIMIT);
    return (
      <section ref={(el) => void (anchors.current[anchor] = el)} className="scroll-mt-2">
        <h3 className={`mb-2 flex items-center gap-1.5 text-sm font-bold ${tone}`}>{title}</h3>
        <div className="space-y-2">{rows}</div>
        {children.length > ATTENTION_LIMIT && (
          <button
            type="button"
            onClick={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (open) next.delete(anchor);
                else next.add(anchor);
                return next;
              })
            }
            className="mt-1 w-full py-2 text-xs font-bold text-gray-500"
          >
            {open ? '閉じる' : `ほか${children.length - ATTENTION_LIMIT}件を見る`}
          </button>
        )}
      </section>
    );
  };

  const actionButton = (label: string, onClick: () => void, Icon: typeof Check, kind: 'main' | 'sub' | 'danger') => (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold ${
        kind === 'main'
          ? 'bg-gray-900 text-white hover:bg-gray-800'
          : kind === 'danger'
            ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  const bagInspectionAge = attention.bag?.lastOn ? `${spanText(daysBetween(attention.bag.lastOn, today))}前に点検` : 'まだ点検していません';

  const attentionView = (
    <>
      {attention.replacement.lots.length > 0 &&
        attentionBlock(
          'replacement',
          `期限が近い・切れた${attention.replacement.total > 0 ? `　見込み ${formatYen(attention.replacement.total)}` : ''}`,
          'text-gray-900',
          attention.replacement.lots.map(({ item, amount }) => (
            <div
              key={item.id}
              className={`${tileClass} overflow-hidden ${'border-gray-200'}`}
            >
              <button
                type="button"
                onClick={() => onEditItem(item)}
                className="flex w-full items-center gap-3 px-3 pt-3 pb-2 text-left"
              >
                {iconBubble(item, 'bg-gray-100 text-gray-600')}
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
                    {countdownChip(item)}
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
                {actionButton('買い替え', () => onRestock(item), PackageCheck, 'main')}
                {actionButton('使った', () => onUse(item), Utensils, 'sub')}
                {actionButton('処分', () => confirmDiscard(item), Trash2, 'danger')}
              </div>
            </div>
          )),
        )}

      {attention.short.length > 0 &&
        attentionBlock(
          'short',
          '足りないもの',
          'text-gray-900',
          attention.short.map(({ status, cost }) => {
            const { target, required, have, shortage, carry } = status;
            const ratio = required > 0 ? have / required : 1;
            return (
              <div key={target.id} className={`${tileClass} border-gray-200 px-3 py-3`}>
                <div className="flex items-center gap-3">
                  {iconBubble(target, 'bg-gray-100 text-gray-600')}
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
              </div>
            );
          }),
        )}

      {(attention.inspect.length > 0 || bagDue) &&
        attentionBlock(
          'inspect',
          '点検の時期',
          'text-gray-900',
          [
            ...(attention.bag?.due
              ? [
              <div key="bag" className={`${tileClass} flex items-center gap-3 border-gray-200 px-3 py-3`}>
                {iconBubble({ name: 'バッグ', category: '' }, 'bg-gray-100 text-gray-600')}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">持ち出しバッグ</p>
                  <p className="text-[11px] font-bold text-gray-500">{bagInspectionAge}</p>
                </div>
                {actionButton('確かめる', () => onStorageChange('carry'), ClipboardCheck, 'main')}
              </div>,
                ]
              : []),
            ...attention.inspect.map((item) => (
              <div key={item.id} className={`${tileClass} flex items-center gap-3 border-gray-200 px-3 py-3`}>
                <button type="button" onClick={() => onEditItem(item)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                  {iconBubble(item, 'bg-gray-100 text-gray-600')}
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm font-bold text-gray-900">{item.name}</span>
                    <span className="block text-[11px] font-bold text-gray-500">
                      {item.inspectedOn ? `${spanText(daysBetween(item.inspectedOn, today))}前に点検` : '未点検'}
                    </span>
                  </span>
                </button>
                <div className="w-24 shrink-0 flex">{actionButton('点検した', () => onInspect([item]), Check, 'main')}</div>
              </div>
            )),
          ],
        )}
    </>
  );

  // ---- 目標のタイル ----
  const targetTile = ({ status }: (typeof board.blocks)[number]) => {
    const { target, required, have, shortage, carry } = status;
    const ratio = required > 0 ? have / required : 1;
    const color = shortage > 0 ? TONE.alert : carry && carry.shortage > 0 ? TONE.warn : TONE.ok;
    return (
      <button
        key={target.id}
        type="button"
        aria-label={`${target.name}の詳しい画面を開く`}
        onClick={() => setDetailId(target.id)}
        className={`${tileClass} flex flex-col items-center gap-1.5 px-2 py-3 text-center ${
          'border-gray-200'
        } hover:bg-gray-50`}
      >
        <Ring size={64} stroke={7} ratio={ratio} color={color}>
          <StockIcon name={target.name} category={target.category} size={26} color={color} />
        </Ring>
        <span className="w-full truncate text-sm font-bold text-gray-900">{target.name}</span>
        <span className="text-[11px] font-bold text-gray-500 tabular-nums">
          {formatQuantity(have)} / {formatQuantity(required)}
          {target.unit}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            shortage > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {shortage > 0 ? `あと${formatQuantity(shortage)}${target.unit}` : '足りてる'}
        </span>
        {carry && (
          <span
            className={`flex items-center gap-1 text-[10px] font-bold tabular-nums ${
              carry.shortage > 0 ? 'text-red-700' : 'text-gray-400'
            }`}
          >
            バッグ {formatQuantity(carry.have)}/{formatQuantity(carry.required)}
          </span>
        )}
      </button>
    );
  };

  // ---- 備品・その他のタイル ----
  const itemTile = (item: StockItem, chip: { text: string; className: string }) => (
    <button
      key={item.id}
      type="button"
      onClick={() => onEditItem(item)}
      className={`${tileClass} flex flex-col items-center gap-1.5 border-gray-200 px-2 py-3 text-center hover:bg-gray-50`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-600">
        <StockIcon name={item.name} category={item.category} size={24} />
      </span>
      <span className="line-clamp-2 min-h-8 w-full text-[13px] font-bold leading-4 text-gray-900">{item.name}</span>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.className}`}>{chip.text}</span>
    </button>
  );

  const equipmentChip = (item: StockItem) => {
    if (item.inspectIntervalMonths === null) return { text: '点検なし', className: 'bg-gray-100 text-gray-400' };
    const next = nextInspectionOn(item);
    if (next === null) return { text: '点検なし', className: 'bg-gray-100 text-gray-400' };
    if (next <= today) return { text: '点検の時期', className: 'bg-red-50 text-red-700' };
    return { text: `点検まで${spanText(daysBetween(today, next))}`, className: 'bg-gray-100 text-gray-500' };
  };

  const homeOthers = board.others.filter((item) => item.storage === 'home');
  const hasAttention = expiryCount > 0 || shortCount > 0 || inspectCount > 0;

  const homeView = (
    <>
      {hero}
      {outlook}
      {hasAttention && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-gray-900">要対応</h2>
          {attentionView}
        </div>
      )}
      <section>
        <h2 className="mb-2 text-base font-bold text-gray-900">目標ごとの備え</h2>
        <div className="grid grid-cols-2 gap-2.5">{board.blocks.map(targetTile)}</div>
        <button
          type="button"
          onClick={onAddTarget}
          className="mt-1 flex w-full items-center justify-center gap-1 py-2.5 text-xs font-bold text-gray-600"
        >
          <Plus size={14} />
          目標（必要数）を追加
        </button>
      </section>

      {homeOthers.length > 0 && (
        <section>
          <h2 className="mb-2 text-base font-bold text-gray-900">その他の備蓄</h2>
          <div className="grid grid-cols-3 gap-2.5">
            {homeOthers.map((item) =>
              itemTile(item, {
                text: item.expiresOn ? expiryCountdown(item.expiresOn, today) : '期限なし',
                className: item.expiresOn ? COUNTDOWN_CLASS[expiryLevel(item.expiresOn, today)] : COUNTDOWN_CLASS.none,
              }),
            )}
          </div>
        </section>
      )}

      {board.equipment.length > 0 && (
        <section>
          <div className="mb-2 flex items-center">
            <h2 className="flex-1 text-base font-bold text-gray-900">備品（期限なし）</h2>
            {board.equipment.some((item) => item.inspectIntervalMonths !== null) && (
              <button
                type="button"
                onClick={() => onInspect(board.equipment.filter((item) => item.inspectIntervalMonths !== null))}
                className="flex items-center gap-1 rounded-xl bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200"
              >
                <Wrench size={13} />
                まとめて点検した
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2.5">{board.equipment.map((item) => itemTile(item, equipmentChip(item)))}</div>
        </section>
      )}
    </>
  );

  // ---- 持ち出し: バッグの中身を押して確かめる ----
  const bagLots = items.filter((item) => item.storage === 'carry' && item.quantity > 0);
  const doneCount = bagLots.filter((item) => checked.has(item.id)).length;
  const allChecked = bagLots.length > 0 && doneCount === bagLots.length;
  const carryShortages = board.blocks.filter((block) => (block.status.carry?.shortage ?? 0) > 0);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const carryView = (
    <>
      <section className={`${tileClass} flex items-center gap-4 p-4 ${attention.bag?.due ? 'border-gray-200' : 'border-gray-200'}`}>
        <Ring
          size={88}
          stroke={10}
          ratio={bagLots.length === 0 ? 0 : doneCount / bagLots.length}
          color={allChecked ? TONE.ok : TONE.accent}
        >
          <span className="flex flex-col items-center leading-none">
            <span className="text-xl font-bold tabular-nums text-gray-900">
              {doneCount}
              <span className="text-xs text-gray-400">/{bagLots.length}</span>
            </span>
            <span className="mt-1 text-[10px] font-bold text-gray-400">確認</span>
          </span>
        </Ring>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-bold text-gray-900">{plan.carryDays}日分のバッグ</p>
          <p className={`text-[11px] font-bold ${attention.bag?.due ? 'text-red-700' : 'text-gray-400'}`}>
            {attention.bag ? bagInspectionAge : 'バッグは空です'}
          </p>
          {attention.bag && (
            <p className="text-[11px] text-gray-400 tabular-nums">
              {attention.bag.due ? '点検の時期です' : `次は ${dateText(attention.bag.nextOn)} ごろ`}
            </p>
          )}
        </div>
      </section>

      {carryShortages.length > 0 && (
        <section className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
          <p className="mb-1.5 text-xs font-bold text-gray-500">足りないもの</p>
          <div className="flex flex-wrap gap-1.5">
            {carryShortages.map(({ status }) => (
              <span
                key={status.target.id}
                className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 tabular-nums"
              >
                {status.target.name} あと{formatQuantity(status.carry?.shortage ?? 0)}
                {status.target.unit}
              </span>
            ))}
          </div>
        </section>
      )}

      {bagLots.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">持ち出しバッグには何も入っていません</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {bagLots.map((item) => {
            const on = checked.has(item.id);
            const level = expiryLevel(item.expiresOn, today);
            return (
              <div
                key={item.id}
                className={`relative rounded-2xl border-2 transition ${
                  on ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'
                }`}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${item.name}を確かめた`}
                  onClick={() => toggle(item.id)}
                  className="flex w-full flex-col items-center gap-1.5 px-2 pb-3 pt-4 text-center"
                >
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-full ${
                      on ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {on ? <Check size={26} strokeWidth={3} /> : <StockIcon name={item.name} category={item.category} size={24} />}
                  </span>
                  <span className="line-clamp-2 min-h-8 w-full text-[13px] font-bold leading-4 text-gray-900">{item.name}</span>
                  <span className="text-[12px] font-bold text-gray-700 tabular-nums">
                    {formatQuantity(item.quantity)}
                    {item.unit}
                  </span>
                  {item.expiresOn && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${COUNTDOWN_CLASS[level]}`}>
                      {expiryCountdown(item.expiresOn, today)}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`${item.name}を編集`}
                  onClick={() => onEditItem(item)}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                >
                  <Pencil size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const detail = board.blocks.find((block) => block.status.target.id === detailId) ?? null;

  return (
    <>
      <div className="shrink-0 flex gap-2 pb-2">
        {statusTile('replacement', '期限', expiryCount, 'alert', Clock)}
        {statusTile('short', '不足', shortCount, 'alert', ShoppingCart)}
        {statusTile('inspect', '点検', inspectCount, 'warn', Wrench)}
      </div>

      <SegmentedTabs
        ariaLabel="保管場所"
        value={storage}
        onChange={onStorageChange}
        options={STORAGE_OPTIONS}
        className="shrink-0 mb-2"
      />

      <div className="relative flex-1 min-h-0">
        <div className="h-full overflow-y-auto space-y-3 pb-24">{storage === 'home' ? homeView : carryView}</div>
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
                allChecked ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-200 text-gray-400'
              }`}
            >
              {allChecked ? '点検完了（今日の日付を残す）' : `あと${bagLots.length - doneCount}つ確かめましょう`}
            </button>
          </div>
        )}
      </div>

      {detail && (
        <StockTargetDetail
          status={detail.status}
          cost={detail.cost}
          lots={detail.lots}
          plan={plan}
          today={today}
          onClose={() => setDetailId(null)}
          onEditTarget={() => {
            setDetailId(null);
            onEditTarget(detail.status.target);
          }}
          onEditItem={(item) => {
            setDetailId(null);
            onEditItem(item);
          }}
        />
      )}
    </>
  );
}
