import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Backpack, ChevronLeft, Plus, ShieldCheck } from 'lucide-react-native';
import type { StockItem, StockItemDraft, StockTarget, StockTargetDraft } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import { getMyMembership } from '@/lib/api/me';
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
import StockBoard from '@/components/living/StockBoard';
import { SOFT, TONE } from '@/components/living/stockVisual';
import StockRestockSheet, { type RestockInput } from '@/components/living/StockRestockSheet';
import StockItemSheet from '@/components/living/StockItemSheet';
import StockTargetSheet from '@/components/living/StockTargetSheet';
import { useShoppingSender } from '@/components/living/useShoppingSender';
import { shortageTitle } from '@/lib/shoppingUtils';

/**
 * 防災備蓄の画面（docs/home.md §10.2）。リストタブの下の「防災備蓄」の行から開く
 * （以前は暮らしタブのメニュー。2026-10-10に暮らしタブを廃止）。戻る操作（端末の戻るボタン・左上の矢印）で
 * 前の画面へ戻る。Web版の `src/components/sukusuku/tabs/StockScreen.tsx` と同じ項目・並び・文言にしてある。
 *
 * 画面の組み立ては「点検盤」（StockBoard）。上に備えの状況、その下に要対応（不足・期限が近い・点検の時期）、
 * 目標ごとの塊（期限順と必要数を1つに）、備品（期限なし）。保管場所（寝室／持ち出し）は切り替えで、
 * 持ち出しはバッグの中身のチェック表。必要数は「1人1日あたり × 人数 × 日数」か「決まった数」。
 * 人数・日数は家族で1つ（§3.5）。
 *
 * 備蓄の不足は「リストへ」で買い出しリストへ送れる（送る仕組みは useShoppingSender）。
 *
 * 見出し・要約・面の切り替え・カテゴリは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 */

/** 編集の対象。null は閉じている、'new' は追加。 */
type Editing = StockItem | 'new' | null;
type EditingTarget = StockTarget | 'new' | null;

export default function StockScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editing, setEditing] = useState<Editing>(null);
  const [targets, setTargets] = useState<StockTarget[]>([]);
  const [plan, setPlan] = useState<StockPlan>(DEFAULT_STOCK_PLAN);
  const [restocking, setRestocking] = useState<StockItem | null>(null);
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  const [bagOpen, setBagOpen] = useState(false);
  const sender = useShoppingSender(familyId);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const [loadedItems, loadedTargets, loadedPlan] = await Promise.all([
          loadStockItems(supabase, membership.familyId),
          loadStockTargets(supabase, membership.familyId),
          loadStockPlan(supabase, membership.familyId),
        ]);
        if (!isMounted) return;
        setItems(loadedItems);
        setTargets(loadedTargets);
        setPlan(loadedPlan);
      } catch {
        // 圏外でも画面は出す。読めなかったぶんは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  // 計画（loadStockPlan）は families の列から読む。
  useFamilyRefresh(['stock_items', 'stock_targets', 'families'], () => {
    if (!familyId) return;
    void Promise.all([
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

  const today = toDateString(new Date());
  const categories = useMemo(() => categoryOptions(items), [items]);
  const stockBoard = useMemo(() => buildStockBoard(items, targets, plan, today), [items, targets, plan, today]);
  const bagDue = stockBoard.attention.bag?.due === true;

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  /** 備蓄を保存する。必要数を新しく決めたときは、先に必要数を作ってから、それに数える（docs/home.md §10.2.2）。 */
  const save = async (input: StockItemDraft, newTarget?: StockTargetDraft) => {
    const target = editing;
    setEditing(null);
    if (!familyId || target === null) return;
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
    if (!familyId) return;
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
    if (!familyId || base === null) return;
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
    if (!familyId || target === null) return;
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

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  /** 前の画面へ戻る。通知から開いたときなど戻り先が無ければ、リストタブへ。 */
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/list'));

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          onPress={goBack}
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeft size={22} color={colors.textMuted} />
          <ShieldCheck size={20} color={colors.livingStock} />
          <Text style={styles.title}>防災備蓄</Text>
        </Pressable>
        {/* 持ち出しバッグの点検と追加だけ（淡い橙の丸。点検の時期はバッグに赤い点）。 */}
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bagDue ? '持ち出しバッグを点検する（点検の時期です）' : '持ち出しバッグを点検する'}
            onPress={() => setBagOpen(true)}
            disabled={isLoading}
            style={styles.roundButton}
          >
            <Backpack size={17} color={SOFT.buttonText} />
            {bagDue && <View style={styles.roundDot} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="備蓄を追加"
            onPress={() => setEditing('new')}
            disabled={!familyId}
            style={styles.roundButton}
          >
            <Plus size={18} color={SOFT.buttonText} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
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
        <StockItemSheet
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
        <StockRestockSheet
          key={restocking.id}
          item={restocking}
          expired={restocking.expiresOn !== null && restocking.expiresOn < today}
          onClose={() => setRestocking(null)}
          onSubmit={(input) => void restock(input)}
        />
      )}

      {editingTarget !== null && (
        <StockTargetSheet
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.button },
  roundDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: TONE.alert,
  },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
});
