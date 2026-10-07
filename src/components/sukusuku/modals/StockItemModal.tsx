'use client';

import { useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import type { StockItem, StockItemDraft, StockTarget, StockTargetDraft } from '@/types/app';
import {
  DEFAULT_INSPECT_MONTHS,
  formatExpiry,
  formatQuantity,
  INSPECT_INTERVAL_OPTIONS,
  parseExpiryInput,
  requiredQuantity,
  STORAGE_LABEL,
  type StockPlan,
  type StockStorage,
} from '@/lib/stockUtils';
import { Segmented } from './logModalParts';
import { ModalShell } from './TaskForm';

// 防災備蓄の1行を足す・直す（docs/home.md §3.2）。mobile版の
// `mobile/src/components/living/StockItemSheet.tsx` と同じ項目・同じ文言。
//
// 必要数は、既にあるものを選ぶか、「＋ 新しく決める」でこの画面の中で作る（docs/home.md §10.2.2）。
//
// 期限は元の一覧と同じ書き方（「2031.08.25」「2027.06」）で打つ。日付の選択画面にしないのは、
// 月までしか無い期限があるのと、袋に書いてある数字をそのまま打つほうが早いため。

interface FormState {
  name: string;
  category: string;
  quantity: string;
  unit: string;
  expiry: string;
  note: string;
  targetId: string | null;
  amountPerUnit: string;
  storage: StockStorage;
  inspectedOn: string;
  inspectInterval: number | null;
  /** 「＋ 新しく決める」で作る必要数。 */
  newQuantity: string;
  newUnit: string;
  newPerPersonDay: boolean;
  newCarry: boolean;
}

/** 必要数の選び方で「＋ 新しく決める」を選んだときの印。 */
const NEW_TARGET = '__new__';

const NEW_TARGET_FIELDS = { newQuantity: '1', newUnit: '', newPerPersonDay: true, newCarry: false };

const MODE_OPTIONS: { value: 'day' | 'fixed'; label: string }[] = [
  { value: 'day', label: '1人1日あたり' },
  { value: 'fixed', label: '全体で決まった数' },
];

const STORAGE_OPTIONS: { value: StockStorage; label: string }[] = [
  { value: 'home', label: STORAGE_LABEL.home },
  { value: 'carry', label: STORAGE_LABEL.carry },
];

const initialState = (item: StockItem | null, defaultStorage: StockStorage): FormState =>
  item
    ? {
        name: item.name,
        category: item.category,
        quantity: formatQuantity(item.quantity),
        unit: item.unit,
        expiry: formatExpiry(item),
        note: item.note,
        targetId: item.targetId,
        amountPerUnit: formatQuantity(item.amountPerUnit),
        storage: item.storage,
        inspectedOn: formatExpiry({ expiresOn: item.inspectedOn, expiresMonthOnly: false }),
        inspectInterval: item.inspectIntervalMonths,
        ...NEW_TARGET_FIELDS,
      }
    : {
        name: '',
        category: '',
        quantity: '1',
        unit: '',
        expiry: '',
        note: '',
        targetId: null,
        amountPerUnit: '1',
        storage: defaultStorage,
        inspectedOn: '',
        inspectInterval: DEFAULT_INSPECT_MONTHS,
        ...NEW_TARGET_FIELDS,
      };

/** 入力を確かめて保存する形にする。だめなら突き返す文言。 */
function toStockDraft(form: FormState): { draft: StockItemDraft; newTarget?: StockTargetDraft } | string {
  if (form.name.trim() === '') return '品名を入れてください';
  const quantity = Number(form.quantity.trim());
  if (form.quantity.trim() === '' || !Number.isFinite(quantity) || quantity < 0) {
    return '数は0以上の数字で入れてください';
  }
  const expiry = parseExpiryInput(form.expiry);
  if (!expiry) return '期限は「2031.08.25」か「2027.06」の形で入れてください';
  const amountPerUnit = form.targetId === null ? 1 : Number(form.amountPerUnit.trim());
  if (!Number.isFinite(amountPerUnit) || amountPerUnit <= 0) {
    return '1つあたりの量は0より大きい数字で入れてください';
  }
  const inspected = parseExpiryInput(form.inspectedOn);
  if (!inspected || inspected.expiresMonthOnly) return '点検日は「2026.10.07」の形で入れてください';
  const isNew = form.targetId === NEW_TARGET;
  const newQuantity = Number(form.newQuantity.trim());
  if (isNew && (form.newQuantity.trim() === '' || !Number.isFinite(newQuantity) || newQuantity <= 0)) {
    return '必要数は0より大きい数字で入れてください';
  }
  const draft: StockItemDraft = {
    name: form.name,
    category: form.category,
    quantity,
    unit: form.unit,
    expiresOn: expiry.expiresOn,
    expiresMonthOnly: expiry.expiresMonthOnly,
    note: form.note,
    // 新しく決める必要数は、保存のときに作ってから数える（呼び出し側）。
    targetId: isNew ? null : form.targetId,
    amountPerUnit,
    storage: form.storage,
    inspectedOn: inspected.expiresOn,
    // 点検の間隔は期限の無い備品だけ（期限のあるものは期限で見る）。
    inspectIntervalMonths: expiry.expiresOn === null ? form.inspectInterval : null,
  };
  if (!isNew) return { draft };
  return {
    draft,
    newTarget: {
      name: form.name,
      category: form.category,
      quantity: newQuantity,
      perPersonDay: form.newPerPersonDay,
      carry: form.newCarry,
      unit: form.newUnit.trim() || form.unit.trim(),
      note: '',
    },
  };
}

interface StockItemModalProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す（初期値をそのとき決めるため）。 */
  item: StockItem | null;
  /** カテゴリの候補（既にある値）。 */
  categories: string[];
  /** 数える先の候補（必要数）。 */
  targets: StockTarget[];
  onClose: () => void;
  /** 新しく決める必要数の目安（○人×○日分）に使う。 */
  plan: StockPlan;
  /** newTarget があれば、先にその必要数を作ってから、それに数える。 */
  onSubmit: (draft: StockItemDraft, newTarget?: StockTargetDraft) => void;
  onDelete?: () => void;
  /** 追加のときの保管場所（持ち出しで絞っているときは持ち出し）。 */
  defaultStorage?: StockStorage;
  /** 一部（count個）をもう一方の保管場所へ移す。編集のときだけ。 */
  onMove?: (count: number) => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

export default function StockItemModal({
  item,
  categories,
  targets,
  plan,
  onClose,
  onSubmit,
  onDelete,
  defaultStorage = 'home',
  onMove,
}: StockItemModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(item, defaultStorage));
  const [moveCount, setMoveCount] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));
  const selectedTarget = targets.find((target) => target.id === form.targetId) ?? null;
  const isNewTarget = form.targetId === NEW_TARGET;
  // 新しく決める必要数の単位（空なら品の単位）と、○人×○日分の目安。
  const newUnit = form.newUnit.trim() || form.unit.trim();
  const newQuantity = Number(form.newQuantity.trim());
  const newHint =
    isNewTarget && Number.isFinite(newQuantity) && newQuantity > 0
      ? (() => {
          const shape = { id: '', quantity: newQuantity, perPersonDay: form.newPerPersonDay };
          const total = requiredQuantity(shape, plan);
          const bag = requiredQuantity(shape, { people: plan.people, days: plan.carryDays });
          const head = form.newPerPersonDay ? `${plan.people}人×${plan.days}日分＝` : '全体で';
          return `${head}${formatQuantity(total)}${newUnit}${form.newCarry ? `（バッグに ${formatQuantity(bag)}${newUnit}）` : ''}`;
        })()
      : null;
  // 点検は期限の無い備品だけ。期限の欄が空のあいだ出す。
  const isInspectable = form.expiry.trim() === '';

  /** 「使った」「足した」を1つずつ。数の欄が読めないときは0から数える。 */
  const step = (delta: number) => {
    const current = Number(form.quantity);
    const base = Number.isFinite(current) ? current : 0;
    update({ quantity: formatQuantity(Math.max(0, base + delta)) });
  };

  const handleSubmit = () => {
    const result = toStockDraft(form);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    onSubmit(result.draft, result.newTarget);
  };

  /**
   * 寝室のロットを持ち出し用へ分ける／持ち出し用のロットを寝室へ戻す（docs/home.md §10.2.2）。
   * 移せるのは1以上、今の数まで（全部なら場所ごと変わる）。1つだけのロットも移せる。
   */
  const moveLabel = item?.storage === 'carry' ? '寝室へ戻す' : '持ち出し用へ分ける';
  const stepMove = (delta: number) =>
    setMoveCount((prev) => Math.min(Math.max(1, Math.floor(item?.quantity ?? 1)), Math.max(1, prev + delta)));
  const handleMove = () => {
    if (!item || moveCount <= 0 || moveCount > item.quantity) return;
    onMove?.(moveCount);
  };

  const handleDelete = () => {
    if (window.confirm('この備蓄を削除しますか？')) onDelete?.();
  };

  return (
    <ModalShell
      title={item ? '備蓄を編集' : '備蓄を追加'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
          >
            {item ? '保存する' : '追加する'}
          </button>
          {item && onDelete && (
            <button type="button" onClick={handleDelete} className="w-full py-2 text-sm text-red-500">
              削除する
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className={labelClass}>品名</span>
          <input
            className={inputClass}
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="例: 水 500ml"
          />
        </label>

        <div>
          <label className="block">
            <span className={labelClass}>カテゴリ</span>
            <input
              className={inputClass}
              value={form.category}
              onChange={(event) => update({ category: event.target.value })}
              placeholder="例: 飲料・水"
            />
          </label>
          {categories.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pt-2 pb-0.5">
              {categories.map((category) => {
                const selected = category === form.category.trim();
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => update({ category })}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
                      selected ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <span className={labelClass}>数</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="1つ減らす"
                onClick={() => step(-1)}
                className="w-10 h-10 shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
              >
                <Minus size={16} />
              </button>
              <input
                className={`${inputClass} text-center`}
                value={form.quantity}
                onChange={(event) => update({ quantity: event.target.value })}
                inputMode="decimal"
                aria-label="数"
              />
              <button
                type="button"
                aria-label="1つ増やす"
                onClick={() => step(1)}
                className="w-10 h-10 shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <label className="block w-24">
            <span className={labelClass}>単位</span>
            <input
              className={inputClass}
              value={form.unit}
              onChange={(event) => update({ unit: event.target.value })}
              placeholder="本"
            />
          </label>
        </div>

        <div>
          <span className={labelClass}>保管場所</span>
          <Segmented options={STORAGE_OPTIONS} value={form.storage} onChange={(storage) => update({ storage })} />
          {item && onMove && item.quantity >= 1 && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-orange-50 p-1.5">
              <span className="flex-1 pl-1 text-xs font-bold text-orange-800">{moveLabel}</span>
              <button
                type="button"
                aria-label="移す数を減らす"
                onClick={() => stepMove(-1)}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-orange-100 bg-white text-orange-800"
              >
                <Minus size={14} />
              </button>
              <span className="min-w-11 text-center text-[15px] font-bold text-gray-900 tabular-nums">
                {formatQuantity(moveCount)}
                <span className="ml-0.5 text-[11px] text-gray-400">{item.unit}</span>
              </span>
              <button
                type="button"
                aria-label="移す数を増やす"
                onClick={() => stepMove(1)}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-orange-100 bg-white text-orange-800"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={handleMove}
                className="rounded-lg bg-orange-100 px-3 py-1.5 text-[13px] font-bold text-orange-800 hover:bg-orange-200"
              >
                {item.storage === 'carry' ? '戻す' : '分ける'}
              </button>
            </div>
          )}
        </div>

        <label className="block">
          <span className={labelClass}>期限</span>
          <input
            className={inputClass}
            value={form.expiry}
            onChange={(event) => update({ expiry: event.target.value })}
            placeholder="2031.08.25 / 2027.06"
            inputMode="decimal"
          />
          <span className="block text-[11px] text-gray-400 mt-1">
            月までのものは「2027.06」。期限が無いものは空のまま
          </span>
        </label>

        <div>
          <span className={labelClass}>必要数</span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: null, name: 'なし' },
              ...targets.map((target) => ({ id: target.id, name: target.name })),
              { id: NEW_TARGET, name: '＋ 新しく決める' },
            ].map(({ id, name }) => {
              const selected = form.targetId === id;
              return (
                <button
                  key={id ?? 'none'}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update({ targetId: id })}
                  className={`px-2.5 py-1 rounded-full text-xs font-bold transition ${
                    selected ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {isNewTarget && (
            <div className="mt-2 space-y-2 rounded-xl bg-orange-50 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-700">必要数</span>
                <input
                  className="w-18 border border-gray-300 rounded-lg px-2 py-1.5 text-sm tabular-nums text-center bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                  value={form.newQuantity}
                  onChange={(event) => update({ newQuantity: event.target.value })}
                  inputMode="decimal"
                  aria-label="必要数"
                />
                <input
                  className="w-18 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                  value={form.newUnit}
                  onChange={(event) => update({ newUnit: event.target.value })}
                  placeholder={form.unit || '単位'}
                  aria-label="必要数の単位"
                />
              </div>
              <Segmented
                options={MODE_OPTIONS}
                value={form.newPerPersonDay ? 'day' : 'fixed'}
                onChange={(mode) => update({ newPerPersonDay: mode === 'day' })}
              />
              <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                <span
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border ${
                    form.newCarry ? 'border-orange-300 bg-orange-100 text-orange-800' : 'border-gray-300 bg-white text-transparent'
                  }`}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={form.newCarry}
                  onChange={(event) => update({ newCarry: event.target.checked })}
                />
                持ち出しバッグにも入れる
              </label>
            </div>
          )}
          {(selectedTarget || isNewTarget) && (
            <>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-gray-700">この品1{form.unit || 'つ'}あたり</span>
                <input
                  className="w-22 border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.amountPerUnit}
                  onChange={(event) => update({ amountPerUnit: event.target.value })}
                  inputMode="decimal"
                  aria-label="1つあたりの量"
                />
                <span className="text-sm text-gray-700">{selectedTarget ? selectedTarget.unit : newUnit}</span>
              </div>
              <span className="block text-[11px] text-gray-400 mt-1">
                {newHint ?? '単位が同じなら1のまま。水 500ml の本を L で数えるなら 0.5'}
              </span>
            </>
          )}
        </div>

        {isInspectable && (
          <div>
            <span className={labelClass}>点検（動作を確かめる間隔）</span>
            <div className="flex flex-wrap gap-1.5">
              {[null, ...INSPECT_INTERVAL_OPTIONS].map((months) => {
                const selected = form.inspectInterval === months;
                return (
                  <button
                    key={months ?? 'none'}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => update({ inspectInterval: months })}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold transition ${
                      selected ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {months === null ? '点検しない' : `${months}か月`}
                  </button>
                );
              })}
            </div>
            {form.inspectInterval !== null && (
              <label className="block mt-2">
                <span className="block text-[11px] text-gray-500 mb-1">最後に点検した日</span>
                <input
                  className={inputClass}
                  value={form.inspectedOn}
                  onChange={(event) => update({ inspectedOn: event.target.value })}
                  placeholder="2026.10.07"
                  inputMode="decimal"
                  aria-label="点検日"
                />
                <span className="block text-[11px] text-gray-400 mt-1">
                  空のままなら、追加した日から数えます
                </span>
              </label>
            )}
          </div>
        )}

        <label className="block">
          <span className={labelClass}>メモ</span>
          <input
            className={inputClass}
            value={form.note}
            onChange={(event) => update({ note: event.target.value })}
            placeholder="置き場所など"
          />
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
