'use client';

import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { StockItem, StockItemDraft, StockTarget, StockTargetDraft } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import {
  deleteStockItem,
  deleteStockTarget,
  insertStockItem,
  insertStockTarget,
  loadStockItems,
  loadStockPlan,
  loadStockTargets,
  updateStockItem,
  updateStockPlan,
  updateStockTarget,
} from '@/lib/api/stockItems';
import {
  categoryOptions,
  countByLevel,
  DEFAULT_STOCK_PLAN,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  sortStockItems,
  targetStatuses,
  type ExpiryLevel,
  type StockPlan,
} from '@/lib/stockUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import StockItemModal from '../modals/StockItemModal';
import StockTargetModal from '../modals/StockTargetModal';

/**
 * 暮らしタブ（docs/home.md）。いまは防災備蓄だけ。
 * mobile版の `mobile/app/(tabs)/living.tsx` と同じ項目・並び・文言にしてある。
 *
 * 防災備蓄の困りごとは数を数えることではなく、期限切れに気づかないこと。
 * そこで**期限の近い順**に並べ、上に「期限切れ・3か月以内・1年以内」の件数を出す。
 * 1行＝品名×期限（ロット）。同じ品でも期限が違えば別の行になる。
 *
 * 「必要数」の面では、品目ごとに「家族の何日分」が要るかを決めておき（stock_targets）、
 * 期限切れでないロットの合計と比べて**足りないものを赤で出す**（docs/home.md §3.5）。
 * 必要数は「1人1日あたり × 人数 × 日数」か「決まった数」。人数・日数は家族で1つ。
 *
 * 見出し・要約・面の切り替え・カテゴリは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 他のタブと違い、読み書きはこのタブの中で完結させる（アプリ全体の状態に持たない）。
 */

/** 「すべて」を表すカテゴリの絞り込み。 */
const ALL = '';

const LEVEL_CLASS: Record<ExpiryLevel, { text: string; badge: string }> = {
  expired: { text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  soon: { text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  year: { text: 'text-orange-700', badge: 'bg-orange-50 text-orange-700' },
  ok: { text: 'text-gray-500', badge: '' },
  none: { text: 'text-gray-400', badge: '' },
};

/** 編集の対象。null は閉じている、'new' は追加。 */
type Editing = StockItem | 'new' | null;
type EditingTarget = StockTarget | 'new' | null;

/** 期限の近い順に並べる面と、必要数に足りているかを見る面。 */
type StockView = 'expiry' | 'targets';

const VIEW_OPTIONS: { id: StockView; label: string }[] = [
  { id: 'expiry', label: '期限順' },
  { id: 'targets', label: '必要数' },
];

/** 人数・日数の上限（DBの check と同じ）。 */
const PLAN_LIMIT = { people: 20, days: 60 };

export default function LivingTab({ familyId }: { familyId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<StockItem[]>([]);
  const [targets, setTargets] = useState<StockTarget[]>([]);
  const [plan, setPlan] = useState<StockPlan>(DEFAULT_STOCK_PLAN);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState(ALL);
  const [view, setView] = useState<StockView>('expiry');
  const [editing, setEditing] = useState<Editing>(null);
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      loadStockItems(supabase, familyId),
      loadStockTargets(supabase, familyId),
      loadStockPlan(supabase, familyId),
    ])
      .then(([loadedItems, loadedTargets, loadedPlan]) => {
        if (!isMounted) return;
        setItems(loadedItems);
        setTargets(loadedTargets);
        setPlan(loadedPlan);
      })
      .catch(() => {
        // 読めなかったぶんは空のままにする。
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [supabase, familyId]);

  const today = toDateStringInTimeZone(new Date());
  const categories = useMemo(() => categoryOptions(items), [items]);
  const counts = useMemo(() => countByLevel(items, today), [items, today]);
  const statuses = useMemo(() => targetStatuses(targets, items, plan, today), [targets, items, plan, today]);
  const shortCount = statuses.filter((status) => status.shortage > 0).length;
  // 絞り込んでいたカテゴリが無くなったら「すべて」へ戻す。
  const activeCategory = category === ALL || categories.includes(category) ? category : ALL;
  const visibleItems = useMemo(
    () =>
      sortStockItems(activeCategory === ALL ? items : items.filter((item) => item.category === activeCategory)),
    [items, activeCategory],
  );

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);

  const save = async (draft: StockItemDraft) => {
    const target = editing;
    setEditing(null);
    if (target === null) return;
    try {
      if (target === 'new') {
        const created = await insertStockItem(supabase, familyId, draft);
        setItems((prev) => [...prev, created]);
      } else {
        const updated = await updateStockItem(supabase, target.id, draft);
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
    } catch {
      failed('保存');
    }
  };

  const remove = async (id: string) => {
    setEditing(null);
    const previous = items;
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await deleteStockItem(supabase, id);
    } catch {
      setItems(previous);
      failed('削除');
    }
  };

  const saveTarget = async (draft: StockTargetDraft) => {
    const target = editingTarget;
    setEditingTarget(null);
    if (target === null) return;
    try {
      if (target === 'new') {
        const position = targets.reduce((max, row) => Math.max(max, row.position + 1), 0);
        const created = await insertStockTarget(supabase, familyId, draft, position);
        setTargets((prev) => [...prev, created]);
      } else {
        const updated = await updateStockTarget(supabase, target.id, draft);
        setTargets((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      }
    } catch {
      failed('保存');
    }
  };

  const removeTarget = async (id: string) => {
    setEditingTarget(null);
    const previous = { targets, items };
    setTargets((prev) => prev.filter((row) => row.id !== id));
    // 数えていたロットは残し、どこにも数えない状態へ戻す（DBの on delete set null と同じ）。
    setItems((prev) => prev.map((item) => (item.targetId === id ? { ...item, targetId: null } : item)));
    try {
      await deleteStockTarget(supabase, id);
    } catch {
      setTargets(previous.targets);
      setItems(previous.items);
      failed('削除');
    }
  };

  /** 人数・日数を1つずつ変える。家族の設定なので、保存できなければ元に戻す。 */
  const stepPlan = async (key: keyof StockPlan, delta: number) => {
    const previous = plan;
    const next = { ...plan, [key]: Math.min(PLAN_LIMIT[key], Math.max(1, plan[key] + delta)) };
    if (next[key] === plan[key]) return;
    setPlan(next);
    try {
      await updateStockPlan(supabase, familyId, next);
    } catch {
      setPlan(previous);
      failed('保存');
    }
  };

  const summary = [
    shortCount > 0 && { key: 'short', badge: LEVEL_CLASS.soon.badge, text: `不足 ${shortCount}品目` },
    counts.expired > 0 && { key: 'expired', badge: LEVEL_CLASS.expired.badge, text: `期限切れ ${counts.expired}件` },
    counts.soon > 0 && { key: 'soon', badge: LEVEL_CLASS.soon.badge, text: `3か月以内 ${counts.soon}件` },
    counts.year > 0 && { key: 'year', badge: LEVEL_CLASS.year.badge, text: `1年以内 ${counts.year}件` },
  ].filter((entry) => entry !== false);

  const expiryList =
    items.length === 0 ? (
      <p className="text-sm text-gray-400 text-center py-8">備蓄はまだありません</p>
    ) : (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
          {visibleItems.map((item) => {
            const level = expiryLevel(item.expiresOn, today);
            const sub = [item.category, item.note].filter((text) => text !== '').join('・');
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setEditing(item)}
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
                    <p className={`text-[11px] font-bold mt-0.5 ${LEVEL_CLASS[level].text}`}>
                      {item.expiresOn ? `${level === 'expired' ? '切れ ' : ''}${formatExpiry(item)}` : '期限なし'}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );

  const planStepper = (key: keyof StockPlan, label: string, suffix: string) => (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-bold text-gray-500">{label}</span>
      <button
        type="button"
        aria-label={`${label}を減らす`}
        onClick={() => void stepPlan(key, -1)}
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
        onClick={() => void stepPlan(key, 1)}
        className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
      >
        <Plus size={14} />
      </button>
    </div>
  );

  const targetList = (
    <>
      <div className="shrink-0 flex gap-4 pb-2">
        {planStepper('people', '人数', '人')}
        {planStepper('days', '日数', '日')}
      </div>
      {statuses.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">必要数はまだありません</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
            {statuses.map(({ target, required, have, shortage }) => {
              const rule = target.perPersonDay
                ? `1人1日 ${formatQuantity(target.quantity)}${target.unit}`
                : '決まった数';
              const sub = [rule, target.note].filter((text) => text !== '').join('・');
              return (
                <li key={target.id}>
                  <button
                    type="button"
                    onClick={() => setEditingTarget(target)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${
                      shortage > 0 ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900">{target.name}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className="text-[13px] font-bold text-gray-700">
                        {formatQuantity(have)} / {formatQuantity(required)}
                        {target.unit}
                      </p>
                      {shortage > 0 ? (
                        <p className="text-[11px] font-bold mt-0.5 text-red-700">
                          あと{formatQuantity(shortage)}
                          {target.unit} 不足
                        </p>
                      ) : (
                        <p className="text-[11px] font-bold mt-0.5 text-green-700">足りています</p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-gray-400 text-center pt-3">期限切れの備蓄は数えません</p>
        </div>
      )}
    </>
  );

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <h2 className="text-lg font-bold text-gray-900">防災備蓄</h2>
        <button
          type="button"
          onClick={() => (view === 'expiry' ? setEditing('new') : setEditingTarget('new'))}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-500 text-white text-sm font-bold hover:bg-blue-600 transition"
        >
          <Plus size={16} />
          追加
        </button>
      </div>

      {!isLoading && items.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5 pb-2">
          {summary.length === 0 ? (
            <span className="text-xs text-gray-500">不足も、1年以内に期限が来るものもありません</span>
          ) : (
            summary.map((entry) => (
              <span key={entry.key} className={`px-2 py-1 rounded-lg text-xs font-bold ${entry.badge}`}>
                {entry.text}
              </span>
            ))
          )}
        </div>
      )}

      <SegmentedTabs
        ariaLabel="防災備蓄の表示"
        value={view}
        onChange={setView}
        options={VIEW_OPTIONS}
        className="shrink-0 mb-2"
      />

      {view === 'expiry' && categories.length > 1 && (
        <div className="shrink-0 flex gap-1.5 overflow-x-auto pb-2">
          {[ALL, ...categories].map((value) => {
            const selected = value === activeCategory;
            return (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(value)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
                  selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {value || 'すべて'}
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
      ) : view === 'expiry' ? (
        expiryList
      ) : (
        targetList
      )}

      {editing !== null && (
        <StockItemModal
          // 対象が変わるたびに作り直して、書きかけを持ち越さない。
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          categories={categories}
          targets={targets}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
        />
      )}

      {editingTarget !== null && (
        <StockTargetModal
          key={editingTarget === 'new' ? 'new' : editingTarget.id}
          target={editingTarget === 'new' ? null : editingTarget}
          plan={plan}
          onClose={() => setEditingTarget(null)}
          onSubmit={(draft) => void saveTarget(draft)}
          onDelete={editingTarget === 'new' ? undefined : () => void removeTarget(editingTarget.id)}
        />
      )}
    </div>
  );
}
