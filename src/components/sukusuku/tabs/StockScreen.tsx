'use client';

import { useEffect, useMemo, useState } from 'react';
import { Backpack, ChevronLeft, Plus, ShieldCheck } from 'lucide-react';
import type { StockItem, StockItemDraft, StockTarget, StockTargetDraft } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { useBackLayer } from '@/lib/browserHistory';
import { useFamilyRefresh } from '@/lib/familySync';
import {
  deleteStockItem,
  deleteStockTarget,
  insertStockItem,
  insertStockTarget,
  loadStockItems,
  markStockInspected,
  moveStockItem,
  setStockQuantity,
  toDraft as stockItemToDraft,
  loadStockPlan,
  loadStockTargets,
  updateStockItem,
  updateStockTarget,
} from '@/lib/api/stockItems';
import {
  buildStockBoard,
  categoryOptions,
  DEFAULT_STOCK_PLAN,
  type StockPlan,
  type StockStorage,
} from '@/lib/stockUtils';
import StockItemModal from '../modals/StockItemModal';
import StockTargetModal from '../modals/StockTargetModal';
import StockRestockModal, { type RestockInput } from '../modals/StockRestockModal';
import StockBoard from '../living/StockBoard';
import { useShoppingSender } from '../living/useShoppingSender';
import { shortageTitle } from '@/lib/shoppingUtils';

/**
 * 防災備蓄の画面（docs/home.md §10.2）。リストタブの下の「防災備蓄」の行から開く
 * （以前は暮らしタブのメニュー。2026-10-10に暮らしタブを廃止）。戻る操作（ブラウザの戻る・左上の矢印）で
 * リストタブの一覧へ戻る。mobile版の `mobile/app/stock.tsx` と同じ項目・並び・文言にしてある。
 *
 * 画面の組み立ては「点検盤」（docs/home.md §10.2。living/StockBoard）。
 * 上に備えの状況、その下に要対応（不足・期限が近い・点検の時期）、目標ごとの塊（期限順と必要数を1つに）、
 * 備品（期限なし）。保管場所（寝室／持ち出し）は切り替えで、持ち出しはバッグの中身のチェック表。
 * 必要数は「1人1日あたり × 人数 × 日数」か「決まった数」。人数・日数は家族で1つ（§3.5）。
 *
 * 備蓄の不足は「リストへ」で買い出しリストへ送れる（送る仕組みは living/useShoppingSender）。
 *
 * 見出し・要約・面の切り替え・カテゴリは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 他のタブと違い、読み書きはこの画面の中で完結させる（アプリ全体の状態に持たない）。
 */

/** 編集の対象。null は閉じている、'new' は追加。 */
type Editing = StockItem | 'new' | null;
type EditingTarget = StockTarget | 'new' | null;

export default function StockScreen({ familyId, onClose }: { familyId: string; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<StockItem[]>([]);
  const [targets, setTargets] = useState<StockTarget[]>([]);
  const [plan, setPlan] = useState<StockPlan>(DEFAULT_STOCK_PLAN);
  const [isLoading, setIsLoading] = useState(true);
  const [restocking, setRestocking] = useState<StockItem | null>(null);
  // 戻る操作（ブラウザの戻る）は、リストタブの一覧へ戻す。
  useBackLayer(onClose);
  const [editing, setEditing] = useState<Editing>(null);
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  const [bagOpen, setBagOpen] = useState(false);
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

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  // 計画（loadStockPlan）は families の列から読む。
  useFamilyRefresh(['stock_items', 'stock_targets', 'families'], () => {
    Promise.all([
      loadStockItems(supabase, familyId),
      loadStockTargets(supabase, familyId),
      loadStockPlan(supabase, familyId),
    ])
      .then(([loadedItems, loadedTargets, loadedPlan]) => {
        setItems(loadedItems);
        setTargets(loadedTargets);
        setPlan(loadedPlan);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const today = toDateStringInTimeZone(new Date());
  const categories = useMemo(() => categoryOptions(items), [items]);
  const stockBoard = useMemo(() => buildStockBoard(items, targets, plan, today), [items, targets, plan, today]);
  const bagDue = stockBoard.attention.bag?.due === true;

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);

  /** 備蓄を保存する。必要数を新しく決めたときは、先に必要数を作ってから、それに数える（docs/home.md §10.2.2）。 */
  const save = async (input: StockItemDraft, newTarget?: StockTargetDraft) => {
    const target = editing;
    setEditing(null);
    if (target === null) return;
    try {
      let draft = input;
      if (newTarget) {
        const position = targets.reduce((max, row) => Math.max(max, row.position + 1), 0);
        const createdTarget = await insertStockTarget(supabase, familyId, newTarget, position);
        setTargets((prev) => [...prev, createdTarget]);
        draft = { ...draft, targetId: createdTarget.id };
      }
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

  /** 「食べた・使った」。数を1つ減らす。 */
  const consumeOne = async (item: StockItem) => {
    const previous = items;
    const quantity = Math.max(0, item.quantity - 1);
    setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, quantity } : row)));
    try {
      await setStockQuantity(supabase, item.id, quantity);
    } catch {
      setItems(previous);
      failed('保存');
    }
  };

  /** 「買い替えた」。同じ品の新しいロットを作り、希望があれば古いロットを処分する。 */
  const restock = async (input: RestockInput) => {
    const base = restocking;
    setRestocking(null);
    if (base === null) return;
    try {
      const created = await insertStockItem(supabase, familyId, {
        ...stockItemToDraft(base),
        expiresOn: input.expiresOn,
        expiresMonthOnly: input.expiresMonthOnly,
        quantity: input.quantity,
        inspectedOn: null,
      });
      setItems((prev) => [...prev, created]);
      if (input.discardOld) {
        await deleteStockItem(supabase, base.id);
        setItems((prev) => prev.filter((row) => row.id !== base.id));
      }
    } catch {
      failed('保存');
    }
  };

  /** 点検した日（今日）を記録する。 */
  const inspect = async (rows: StockItem[]) => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    const previous = items;
    setItems((prev) => prev.map((row) => (ids.includes(row.id) ? { ...row, inspectedOn: today } : row)));
    try {
      await markStockInspected(supabase, ids, today);
    } catch {
      setItems(previous);
      failed('保存');
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

  return (
    <div className="relative p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <button
          type="button"
          aria-label="戻る"
          onClick={onClose}
          className="flex items-center gap-1.5 -ml-1 rounded-lg py-1 pr-2 hover:bg-gray-100 transition"
        >
          <ChevronLeft size={22} className="text-gray-500" />
          <ShieldCheck size={20} className="text-orange-600" />
          <h2 className="text-lg font-bold text-gray-900">防災備蓄</h2>
        </button>
        {/* 持ち出しバッグの点検と追加だけ（淡い橙の丸。点検の時期はバッグに赤い点）。 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={bagDue ? '持ち出しバッグを点検する（点検の時期です）' : '持ち出しバッグを点検する'}
            onClick={() => setBagOpen(true)}
            disabled={isLoading}
            className="relative flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-orange-800 hover:bg-orange-200"
          >
            <Backpack size={17} />
            {bagDue && <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-gray-50 bg-red-400" />}
          </button>
          <button
            type="button"
            aria-label="備蓄を追加"
            onClick={() => setEditing('new')}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-orange-800 hover:bg-orange-200"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
      ) : (
        <StockBoard
          items={items}
          targets={targets}
          plan={plan}
          today={today}
          onEditItem={setEditing}
          onEditTarget={setEditingTarget}
          bagOpen={bagOpen}
          onBagOpenChange={setBagOpen}
          onSendShortage={(target, shortage) => sender.send(shortageTitle(target.name, shortage, target.unit), '')}
          onRestock={setRestocking}
          onUse={(item) => void consumeOne(item)}
          onDiscard={(item) => void remove(item.id)}
          onInspect={(rows) => void inspect(rows)}
        />
      )}

      {editing !== null && (
        <StockItemModal
          // 対象が変わるたびに作り直して、書きかけを持ち越さない。
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          categories={categories}
          targets={targets}
          plan={plan}
          onClose={() => setEditing(null)}
          onSubmit={(draft, newTarget) => void save(draft, newTarget)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
          onMove={editing === 'new' ? undefined : (count) => void move(editing, count)}
        />
      )}

      {restocking !== null && (
        <StockRestockModal
          key={restocking.id}
          item={restocking}
          expired={restocking.expiresOn !== null && restocking.expiresOn < today}
          onClose={() => setRestocking(null)}
          onSubmit={(input) => void restock(input)}
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
