'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ListPlus, Minus, Plus } from 'lucide-react';
import type { StockItem, StockItemDraft, StockTarget, StockTargetDraft } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { useBackLayer } from '@/lib/browserHistory';
import {
  deleteStockItem,
  deleteStockTarget,
  insertStockItem,
  insertStockTarget,
  loadStockItems,
  moveStockItem,
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
  isShort,
  sortStockItems,
  STORAGE_LABEL,
  targetStatuses,
  type ExpiryLevel,
  type StockPlan,
  type StockStorage,
} from '@/lib/stockUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import StockItemModal from '../modals/StockItemModal';
import StockTargetModal from '../modals/StockTargetModal';
import ProductsPanel, { type EditingProduct } from '../living/ProductsPanel';
import LivingMenu, { LIVING_SECTIONS, type LivingSection } from '../living/LivingMenu';
import LotteryPanel from '../living/LotteryPanel';
import { useShoppingSender } from '../living/useShoppingSender';
import { shortageTitle } from '@/lib/shoppingUtils';

/**
 * 暮らしタブ（docs/home.md）。防災備蓄（期限順・必要数）と日用品の台帳。
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
 * 暮らしタブを開くと、まずアイコンのメニュー（LivingMenu）。防災備蓄・日用品・補助くじは
 * 持つデータも見方も別物で、頻繁に開くタブでもないため、切り替えではなく押して入る形にし、
 * 画面ごとの色・見出し・追加ボタンにする。期限順/必要数の切り替えは防災備蓄の中だけ。
 *
 * 「日用品」の画面は、よく買うものの台帳（docs/home.md §4）。行の「＋」で買い出しリストへ送る。
 * 備蓄の不足も「リストへ」で同じリストへ送れる（送る仕組みは living/useShoppingSender）。
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

/** 防災備蓄の中の面。期限の近い順に並べる面と、必要数に足りているかを見る面。 */
type StockView = 'expiry' | 'targets';

const VIEW_OPTIONS: { id: StockView; label: string }[] = [
  { id: 'expiry', label: '期限順' },
  { id: 'targets', label: '必要数' },
];

/** 人数・日数の上限（DBの check と同じ）。 */
const PLAN_LIMIT: StockPlan = { people: 20, days: 60, carryDays: 7 };

/** 絞り込みのチップ。保管場所（持ち出し・寝室）とカテゴリを1列に並べる。 */
const storageFilter = (storage: StockStorage) => `storage:${storage}`;
const STORAGE_FILTERS = (['carry', 'home'] as StockStorage[]).map(storageFilter);

export default function LivingTab({ familyId, userId }: { familyId: string; userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<StockItem[]>([]);
  const [targets, setTargets] = useState<StockTarget[]>([]);
  const [plan, setPlan] = useState<StockPlan>(DEFAULT_STOCK_PLAN);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState(ALL);
  // 開いている画面。null はメニュー（docs/home.md §2）。
  const [section, setSection] = useState<LivingSection | null>(null);
  const [view, setView] = useState<StockView>('expiry');
  // 戻る操作は、開いている画面からメニューへ戻す（メニューのときは1つ前のタブへ）。
  useBackLayer(() => setSection(null), section !== null);
  const [editing, setEditing] = useState<Editing>(null);
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  const [editingProduct, setEditingProduct] = useState<EditingProduct>(null);
  const sender = useShoppingSender(familyId);

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
  const shortCount = statuses.filter(isShort).length;
  // 絞り込んでいたカテゴリが無くなったら「すべて」へ戻す。
  const activeCategory =
    category === ALL || STORAGE_FILTERS.includes(category) || categories.includes(category) ? category : ALL;
  const filterStorage = STORAGE_FILTERS.includes(activeCategory)
    ? (activeCategory.slice('storage:'.length) as StockStorage)
    : null;
  const visibleItems = useMemo(
    () =>
      sortStockItems(
        activeCategory === ALL
          ? items
          : filterStorage
            ? items.filter((item) => item.storage === filterStorage)
            : items.filter((item) => item.category === activeCategory),
      ),
    [items, activeCategory, filterStorage],
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

  /** 一部（count個）をもう一方の保管場所へ移す。 */
  const move = async (item: StockItem, count: number) => {
    setEditing(null);
    try {
      const to: StockStorage = item.storage === 'carry' ? 'home' : 'carry';
      const { updated, removedIds } = await moveStockItem(supabase, familyId, item, count, to, items);
      setItems((prev) => {
        const kept = prev.filter((row) => !removedIds.includes(row.id));
        const known = new Set(kept.map((row) => row.id));
        return [
          ...kept.map((row) => updated.find((next) => next.id === row.id) ?? row),
          ...updated.filter((next) => !known.has(next.id)),
        ];
      });
    } catch {
      failed('移動');
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
                    {(item.storage === 'carry' || sub !== '') && (
                      <p className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-0.5">
                        {item.storage === 'carry' && (
                          <span className="px-1.5 rounded bg-blue-50 text-[10px] font-bold text-blue-700">
                            {STORAGE_LABEL.carry}
                          </span>
                        )}
                        {sub}
                      </p>
                    )}
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
      <div className="shrink-0 flex flex-wrap gap-x-4 gap-y-1.5 pb-2">
        {planStepper('people', '人数', '人')}
        {planStepper('days', '日数', '日')}
        {planStepper('carryDays', '持ち出し', '日')}
      </div>
      {statuses.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">必要数はまだありません</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
            {statuses.map((status) => {
              const { target, required, have, shortage, carry } = status;
              const rule = target.perPersonDay
                ? `1人1日 ${formatQuantity(target.quantity)}${target.unit}`
                : '決まった数';
              const sub = [rule, target.note].filter((text) => text !== '').join('・');
              return (
                <li
                  key={target.id}
                  className={`flex items-center gap-2 pr-3 ${isShort(status) ? 'bg-red-50' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setEditingTarget(target)}
                    className={`flex-1 min-w-0 flex items-center gap-3 pl-3 py-2.5 text-left ${
                      isShort(status) ? 'hover:bg-red-100' : 'hover:bg-gray-50'
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
                      {carry && (
                        <p
                          className={`text-[11px] font-bold mt-0.5 ${
                            carry.shortage > 0 ? 'text-red-700' : 'text-gray-500'
                          }`}
                        >
                          持ち出し {formatQuantity(carry.have)} / {formatQuantity(carry.required)}
                          {target.unit}
                          {carry.shortage > 0 ? ' 不足' : ''}
                        </p>
                      )}
                    </div>
                  </button>
                  {shortage > 0 && (
                    <button
                      type="button"
                      aria-label={`${target.name}の不足を買い出しリストへ`}
                      onClick={() => sender.send(shortageTitle(target.name, shortage, target.unit), '')}
                      className="shrink-0 w-8 h-8 rounded-full bg-red-100 text-red-700 flex items-center justify-center hover:bg-red-200"
                    >
                      <ListPlus size={16} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-gray-400 text-center pt-3">期限切れの備蓄は数えません</p>
        </div>
      )}
    </>
  );

  if (section === null) {
    return (
      <div className="relative p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
        <h2 className="shrink-0 pb-3 text-lg font-bold text-gray-900">暮らし</h2>
        <LivingMenu
          onOpen={setSection}
          attention={{ stock: isLoading ? 0 : shortCount + counts.expired + counts.soon }}
        />
      </div>
    );
  }

  const current = LIVING_SECTIONS.find((entry) => entry.id === section) ?? LIVING_SECTIONS[0];

  return (
    <div className="relative p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <button
          type="button"
          aria-label="暮らしのメニューへ戻る"
          onClick={() => setSection(null)}
          className="flex items-center gap-1.5 -ml-1 rounded-lg py-1 pr-2 hover:bg-gray-100 transition"
        >
          <ChevronLeft size={22} className="text-gray-500" />
          <current.Icon size={20} className={current.icon} />
          <h2 className="text-lg font-bold text-gray-900">{current.label}</h2>
        </button>
        {section !== 'lottery' && (
          <button
            type="button"
            onClick={() =>
              section === 'products'
                ? setEditingProduct('new')
                : view === 'expiry'
                  ? setEditing('new')
                  : setEditingTarget('new')
            }
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-white text-sm font-bold transition ${current.accent}`}
          >
            <Plus size={16} />
            追加
          </button>
        )}
      </div>

      {section === 'stock' && !isLoading && items.length > 0 && (
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

      {section === 'stock' && (
        <SegmentedTabs
          ariaLabel="防災備蓄の表示"
          value={view}
          onChange={setView}
          options={VIEW_OPTIONS}
          className="shrink-0 mb-2"
        />
      )}

      {section === 'stock' && view === 'expiry' && items.length > 0 && (
        <div className="shrink-0 flex gap-1.5 overflow-x-auto pb-2">
          {[ALL, ...STORAGE_FILTERS, ...categories].map((value) => {
            const selected = value === activeCategory;
            return (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(value)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
                  selected ? current.chip : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {value === ALL
                  ? 'すべて'
                  : STORAGE_FILTERS.includes(value)
                    ? STORAGE_LABEL[value.slice('storage:'.length) as StockStorage]
                    : value}
              </button>
            );
          })}
        </div>
      )}

      {section === 'products' ? (
        <ProductsPanel familyId={familyId} sender={sender} editing={editingProduct} onEdit={setEditingProduct} />
      ) : section === 'lottery' ? (
        <LotteryPanel familyId={familyId} userId={userId} />
      ) : isLoading ? (
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
          defaultStorage={filterStorage ?? 'home'}
          onMove={editing === 'new' ? undefined : (count) => void move(editing, count)}
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

      {sender.picker}
      {sender.banner}
    </div>
  );
}
