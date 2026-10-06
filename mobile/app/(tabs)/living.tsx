import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ListPlus, Minus, Plus } from 'lucide-react-native';
import type { StockItem, StockItemDraft, StockTarget, StockTargetDraft } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import { getMyMembership } from '@/lib/api/me';
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
  expiryLevel,
  formatExpiry,
  formatQuantity,
  DEFAULT_STOCK_PLAN,
  isShort,
  STORAGE_LABEL,
  sortStockItems,
  targetStatuses,
  type ExpiryLevel,
  type StockPlan,
  type StockStorage,
} from '@/lib/stockUtils';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import StockItemSheet from '@/components/living/StockItemSheet';
import StockTargetSheet from '@/components/living/StockTargetSheet';
import LivingSectionTabs, { LIVING_SECTIONS, type LivingSection } from '@/components/living/LivingSectionTabs';
import ProductsPanel, { type EditingProduct } from '@/components/living/ProductsPanel';
import { useShoppingSender } from '@/components/living/useShoppingSender';
import { shortageTitle } from '@/lib/shoppingUtils';

/**
 * 暮らしタブ（docs/home.md）。防災備蓄（期限順・必要数）と日用品の台帳。
 * Web版の `src/components/sukusuku/tabs/LivingTab.tsx` と同じ項目・並び・文言にしてある。
 *
 * 防災備蓄の困りごとは数を数えることではなく、期限切れに気づかないこと。
 * そこで**期限の近い順**に並べ、上に「期限切れ・3か月以内・1年以内」の件数を出す。
 * 1行＝品名×期限（ロット）。同じ品でも期限が違えば別の行になる。
 *
 * 「必要数」の面では、品目ごとに「家族の何日分」が要るかを決めておき（stock_targets）、
 * 期限切れでないロットの合計と比べて**足りないものを赤で出す**（docs/home.md §3.5）。
 * 必要数は「1人1日あたり × 人数 × 日数」か「決まった数」。人数・日数は家族で1つ。
 *
 * 「防災備蓄」と「日用品」は持つデータも見方も別物なので、一番上の区分の切り替えで分け、
 * 区分ごとの色・見出し・追加ボタンにする（期限順/必要数の切り替えは防災備蓄の中だけ）。
 *
 * 「日用品」の区分は、よく買うものの台帳（docs/home.md §4）。行の「＋」で買い出しリストへ送る。
 * 備蓄の不足も「リストへ」で同じリストへ送れる（送る仕組みは useShoppingSender）。
 *
 * 見出し・要約・面の切り替え・カテゴリは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 */

/** 「すべて」を表すカテゴリの絞り込み。 */
const ALL = '';

const LEVEL_STYLE: Record<ExpiryLevel, { color: string; surface?: string }> = {
  expired: { color: colors.alertText, surface: colors.alertSurface },
  soon: { color: colors.alertText, surface: colors.alertSurface },
  year: { color: colors.temperatureText, surface: colors.temperatureSurface },
  ok: { color: colors.textMuted },
  none: { color: colors.textFaint },
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

export default function LivingScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState(ALL);
  const [editing, setEditing] = useState<Editing>(null);
  const [targets, setTargets] = useState<StockTarget[]>([]);
  const [plan, setPlan] = useState<StockPlan>(DEFAULT_STOCK_PLAN);
  const [section, setSection] = useState<LivingSection>('stock');
  const [view, setView] = useState<StockView>('expiry');
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  const [editingProduct, setEditingProduct] = useState<EditingProduct>(null);
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

  const today = toDateString(new Date());
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

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  const save = async (draft: StockItemDraft) => {
    const target = editing;
    setEditing(null);
    if (!familyId || target === null) return;
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

  /** 人数・日数を1つずつ変える。家族の設定なので、保存できなければ元に戻す。 */
  const stepPlan = async (key: keyof StockPlan, delta: number) => {
    if (!familyId) return;
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

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  const current = LIVING_SECTIONS.find((entry) => entry.id === section) ?? LIVING_SECTIONS[0];

  const summary = [
    shortCount > 0 && { key: 'short', tone: LEVEL_STYLE.soon, text: `不足 ${shortCount}品目` },
    counts.expired > 0 && { key: 'expired', tone: LEVEL_STYLE.expired, text: `期限切れ ${counts.expired}件` },
    counts.soon > 0 && { key: 'soon', tone: LEVEL_STYLE.soon, text: `3か月以内 ${counts.soon}件` },
    counts.year > 0 && { key: 'year', tone: LEVEL_STYLE.year, text: `1年以内 ${counts.year}件` },
  ].filter((entry) => entry !== false);

  const expiryList =
    items.length === 0 ? (
      <View style={[styles.centered, styles.flex]}>
        <Text style={styles.message}>備蓄はまだありません</Text>
      </View>
    ) : (
      <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
        <View style={styles.card}>
          {visibleItems.map((item, index) => {
            const level = expiryLevel(item.expiresOn, today);
            const tone = LEVEL_STYLE[level];
            const sub = [item.category, item.note].filter((text) => text !== '').join('・');
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => setEditing(item)}
                style={[styles.row, index > 0 && styles.rowDivided]}
              >
                <View style={styles.flex}>
                  <Text style={styles.name}>{item.name}</Text>
                  <View style={styles.subRow}>
                    {item.storage === 'carry' && (
                      <View style={styles.carryTag}>
                        <Text style={styles.carryTagText}>{STORAGE_LABEL.carry}</Text>
                      </View>
                    )}
                    {sub !== '' && <Text style={styles.sub}>{sub}</Text>}
                  </View>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.quantity}>
                    {formatQuantity(item.quantity)}
                    {item.unit}
                  </Text>
                  {item.expiresOn ? (
                    <Text style={[styles.expiry, { color: tone.color }]}>
                      {level === 'expired' ? '切れ ' : ''}
                      {formatExpiry(item)}
                    </Text>
                  ) : (
                    <Text style={[styles.expiry, { color: tone.color }]}>期限なし</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    );

  const planStepper = (key: keyof StockPlan, label: string, suffix: string) => (
    <View style={styles.planItem}>
      <Text style={styles.planLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}を減らす`}
        onPress={() => void stepPlan(key, -1)}
        style={styles.planButton}
      >
        <Minus size={14} color={colors.textSubtle} />
      </Pressable>
      <Text style={styles.planValue}>
        {plan[key]}
        {suffix}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}を増やす`}
        onPress={() => void stepPlan(key, 1)}
        style={styles.planButton}
      >
        <Plus size={14} color={colors.textSubtle} />
      </Pressable>
    </View>
  );

  const targetList = (
    <>
      <View style={styles.plan}>
        {planStepper('people', '人数', '人')}
        {planStepper('days', '日数', '日')}
        {planStepper('carryDays', '持ち出し', '日')}
      </View>
      {statuses.length === 0 ? (
        <View style={[styles.centered, styles.flex]}>
          <Text style={styles.message}>必要数はまだありません</Text>
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
          <View style={styles.card}>
            {statuses.map((status, index) => {
              const { target, required, have, shortage, carry } = status;
              const rule = target.perPersonDay
                ? `1人1日 ${formatQuantity(target.quantity)}${target.unit}`
                : '決まった数';
              const sub = [rule, target.note].filter((text) => text !== '').join('・');
              return (
                <Pressable
                  key={target.id}
                  accessibilityRole="button"
                  onPress={() => setEditingTarget(target)}
                  style={[styles.row, index > 0 && styles.rowDivided, isShort(status) && styles.rowShort]}
                >
                  <View style={styles.flex}>
                    <Text style={styles.name}>{target.name}</Text>
                    <Text style={styles.sub}>{sub}</Text>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={styles.quantity}>
                      {formatQuantity(have)} / {formatQuantity(required)}
                      {target.unit}
                    </Text>
                    {shortage > 0 ? (
                      <Text style={[styles.expiry, styles.shortText]}>
                        あと{formatQuantity(shortage)}
                        {target.unit} 不足
                      </Text>
                    ) : (
                      <Text style={[styles.expiry, styles.enoughText]}>足りています</Text>
                    )}
                    {carry && (
                      <Text style={[styles.expiry, carry.shortage > 0 ? styles.shortText : styles.carryOk]}>
                        持ち出し {formatQuantity(carry.have)} / {formatQuantity(carry.required)}
                        {target.unit}
                        {carry.shortage > 0 ? ' 不足' : ''}
                      </Text>
                    )}
                  </View>
                  {shortage > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${target.name}の不足を買い出しリストへ`}
                      onPress={() => sender.send(shortageTitle(target.name, shortage, target.unit), '')}
                      hitSlop={8}
                      style={styles.toListButton}
                    >
                      <ListPlus size={16} color={colors.alertText} />
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.footnote}>期限切れの備蓄は数えません</Text>
        </ScrollView>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <LivingSectionTabs value={section} onChange={setSection} />
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.hint}>
          {current.hint}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            section === 'products'
              ? setEditingProduct('new')
              : view === 'expiry'
                ? setEditing('new')
                : setEditingTarget('new')
          }
          style={[styles.addButton, { backgroundColor: current.color }]}
          disabled={!familyId}
        >
          <Plus size={16} color={colors.primaryText} />
          <Text style={styles.addButtonText}>追加</Text>
        </Pressable>
      </View>

      {section === 'stock' && !isLoading && items.length > 0 && (
        <View style={styles.summary}>
          {summary.length === 0 ? (
            <Text style={styles.summaryCalm}>不足も、1年以内に期限が来るものもありません</Text>
          ) : (
            summary.map((entry) => (
              <View key={entry.key} style={[styles.summaryBadge, { backgroundColor: entry.tone.surface }]}>
                <Text style={[styles.summaryText, { color: entry.tone.color }]}>{entry.text}</Text>
              </View>
            ))
          )}
        </View>
      )}

      {section === 'stock' && (
        <SegmentedTabs
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          accessibilityLabel="防災備蓄の表示"
          style={styles.views}
        />
      )}

      {section === 'stock' && view === 'expiry' && items.length > 0 && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {[ALL, ...STORAGE_FILTERS, ...categories].map((value) => {
              const selected = value === activeCategory;
              return (
                <Pressable
                  key={value || 'all'}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCategory(value)}
                  style={[styles.chip, selected && { backgroundColor: current.color }]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {value === ALL
                      ? 'すべて'
                      : STORAGE_FILTERS.includes(value)
                        ? STORAGE_LABEL[value.slice('storage:'.length) as StockStorage]
                        : value}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {section === 'products' ? (
        <ProductsPanel familyId={familyId} sender={sender} editing={editingProduct} onEdit={setEditingProduct} />
      ) : isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
      ) : view === 'expiry' ? (
        expiryList
      ) : (
        targetList
      )}

      {editing !== null && (
        <StockItemSheet
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
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  hint: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textMuted, marginRight: 12 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: { fontSize: 13, fontWeight: '700', color: colors.primaryText },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  summaryBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  summaryText: { fontSize: 12, fontWeight: '700' },
  summaryCalm: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  chips: { gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.neutralSurface,
  },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextSelected: { color: colors.primaryText },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  quantity: { fontSize: 13, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  expiry: { fontSize: 11, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  rowShort: { backgroundColor: colors.dangerSurface },
  toListButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.alertSurface,
  },
  shortText: { color: colors.alertText },
  enoughText: { color: colors.doneText },
  footnote: { fontSize: 11, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingTop: 12 },
  views: { marginHorizontal: 16, marginBottom: 8 },
  plan: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  carryTag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: colors.diaperSurface },
  carryTagText: { fontSize: 10, fontWeight: '700', color: colors.diaperText },
  carryOk: { color: colors.textMuted },
  planItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  planButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  planValue: {
    minWidth: 32,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
