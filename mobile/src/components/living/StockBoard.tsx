import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight, Clock, Minus, Pencil, Plus, Settings2, Wrench } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import { colors } from '@/lib/theme';
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
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import StockAttention from './StockAttention';
import StockProductDetail from './StockProductDetail';
import { readinessColor, Ring, SOFT, StockIcon, TONE } from './stockVisual';

// 防災備蓄の画面（docs/home.md §10.2・§10.2.1）。PWA版の
// `src/components/sukusuku/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
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
      <Pressable accessibilityRole="button" onPress={() => setAttentionOpen(true)} style={styles.banner}>
        <View style={styles.redDot} />
        <Text style={styles.bannerTitle}>確認が必要 {attentionCount}件</Text>
        <Text style={styles.bannerSub} numberOfLines={1}>
          {[
            expiryCount > 0 && `期限 ${expiryCount}`,
            shortCount > 0 && `不足 ${shortCount}`,
            inspectCount > 0 && `点検 ${inspectCount}`,
          ]
            .filter(Boolean)
            .join('・')}
        </Text>
        <ChevronRight size={16} color={colors.borderStrong} />
      </Pressable>
    ) : (
      <View style={styles.calm}>
        <Check size={14} color={colors.textFaint} />
        <Text style={styles.calmText}>確認が必要なものはありません</Text>
      </View>
    );

  // ---- 備え度（小さく） ----
  const ringColor = readinessColor(readiness);
  const summary = (
    <View style={styles.card}>
      <View style={styles.summaryRow}>
        <Ring size={52} stroke={6} ratio={readiness / 100} color={ringColor}>
          <Text style={[styles.ringValue, { color: ringColor }]}>{readiness}%</Text>
        </Ring>
        <View style={styles.flex}>
          <Text style={styles.summaryTitle}>
            {plan.people}人 × {plan.days}日分の備え
          </Text>
          <Text style={styles.summarySub}>
            {overview.shortageTotal > 0
              ? `あと ${formatYen(overview.shortageTotal)} で揃う${overview.unpricedTargets > 0 ? '（一部未登録）' : ''}`
              : overview.unpricedTargets > 0
                ? '値段を入れると費用が出ます'
                : '必要な量が揃っています'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="人数・日数を変える"
          accessibilityState={{ expanded: showPlan }}
          onPress={() => setShowPlan((prev) => !prev)}
          style={styles.gear}
        >
          <Settings2 size={16} color={SOFT.icon} />
        </Pressable>
      </View>
      {showPlan && (
        <View style={styles.planPanel}>
          {(
            [
              ['people', '人数', '人'],
              ['days', '日数', '日'],
              ['carryDays', 'バッグ', '日'],
            ] as [PlanKey, string, string][]
          ).map(([key, label, suffix]) => (
            <View key={key} style={styles.stepper}>
              <Text style={styles.stepperLabel}>{label}</Text>
              <View style={styles.inline}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label}を減らす`}
                  onPress={() => onStepPlan(key, -1)}
                  style={styles.stepButton}
                >
                  <Minus size={14} color={colors.textSubtle} />
                </Pressable>
                <Text style={styles.stepValue}>
                  {plan[key]}
                  {suffix}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label}を増やす`}
                  onPress={() => onStepPlan(key, 1)}
                  style={styles.stepButton}
                >
                  <Plus size={14} color={colors.textSubtle} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  // ---- 品目のタイル ----
  const productTile = (product: StockProduct<StockItem, StockTarget>) => {
    const status = product.target?.status ?? null;
    const shortage = status?.shortage ?? 0;
    const required = status?.required ?? 0;
    const ratio = status && required > 0 ? Math.min(1, status.have / required) : null;
    const nearestLevel = product.nearest?.level;
    const nearestAlert = nearestLevel === 'expired' || nearestLevel === 'soon';
    return (
      <Pressable
        key={product.key}
        accessibilityRole="button"
        accessibilityLabel={`${product.name}の詳しい画面を開く`}
        onPress={() => setDetailKey(product.key)}
        style={styles.tile}
      >
        <View style={styles.tileTop}>
          <View style={styles.tileIcon}>
            <StockIcon name={product.name} category={product.category} size={18} color={SOFT.icon} />
          </View>
          {product.carryTotal > 0 && (
            <View style={styles.bagTag}>
              <Text style={styles.bagTagText}>バッグ {formatQuantity(product.carryTotal)}</Text>
            </View>
          )}
        </View>
        <Text style={styles.tileName} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.tileTotal}>
          {formatQuantity(product.total)}
          <Text style={styles.tileUnit}> {product.unit}</Text>
        </Text>
        {ratio !== null && (
          <View style={styles.bar}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.round(ratio * 100)}%`, backgroundColor: shortage > 0 ? TONE.alert : SOFT.border },
              ]}
            />
          </View>
        )}
        {status && (
          <Text style={[styles.tileNote, shortage > 0 && styles.alertText]}>
            {shortage > 0
              ? `必要 ${formatQuantity(required)}${status.target.unit}・あと${formatQuantity(shortage)}${status.target.unit}`
              : `必要 ${formatQuantity(required)}${status.target.unit}`}
          </Text>
        )}
        {product.nearest && (
          <View style={styles.noteRow}>
            <Clock size={11} color={nearestAlert ? colors.alertText : colors.textFaint} />
            <Text style={[styles.tileNote, nearestAlert && styles.alertText]}>
              {expiryCountdown(product.nearest.on, today)}
            </Text>
          </View>
        )}
        {product.inspect && (
          <View style={styles.noteRow}>
            <Wrench size={11} color={product.inspect.due ? colors.alertText : colors.textFaint} />
            <Text style={[styles.tileNote, product.inspect.due && styles.alertText]}>
              {product.inspect.due ? '点検の時期' : `点検まで${spanText(daysBetween(today, product.inspect.next))}`}
            </Text>
          </View>
        )}
      </Pressable>
    );
  };

  const categoryHeader = (name: string, count: number) => (
    <View style={styles.categoryHeader}>
      <View style={styles.categoryIcon}>
        <StockIcon name={name} size={15} color={SOFT.icon} />
      </View>
      <Text style={styles.categoryName}>{name}</Text>
      <Text style={styles.categoryCount}>{count}品目</Text>
    </View>
  );

  const homeView = (
    <>
      {summary}
      {shown.length === 0 ? (
        <Text style={styles.empty}>備蓄はまだありません</Text>
      ) : (
        shown.map((row) => (
          <View key={row.category} style={styles.section}>
            {categoryHeader(row.category, row.products.length)}
            <View style={styles.grid}>{row.products.map(productTile)}</View>
          </View>
        ))
      )}
      <Pressable accessibilityRole="button" onPress={onAddTarget} style={styles.addTarget}>
        <Plus size={14} color={colors.textSubtle} />
        <Text style={styles.addTargetText}>目標（必要数）を追加</Text>
      </Pressable>
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
      <View style={[styles.card, styles.summaryRow, { padding: 16 }]}>
        <Ring size={72} stroke={8} ratio={bagLots.length === 0 ? 0 : doneCount / bagLots.length} color={TONE.accent}>
          <View style={styles.ringCenter}>
            <Text style={styles.bagValue}>
              {doneCount}
              <Text style={styles.bagTotal}>/{bagLots.length}</Text>
            </Text>
            <Text style={styles.ringLabel}>確認</Text>
          </View>
        </Ring>
        <View style={styles.flex}>
          <Text style={styles.summaryTitle}>{plan.carryDays}日分のバッグ</Text>
          <Text style={[styles.bagAge, bagDue && styles.alertText]}>{attention.bag ? bagAge : 'バッグは空です'}</Text>
          {attention.bag && (
            <Text style={styles.summarySub}>
              {bagDue ? '点検の時期です' : `次は ${dateText(attention.bag.nextOn)} ごろ`}
            </Text>
          )}
        </View>
      </View>

      {carryShortages.length > 0 && (
        <View style={[styles.card, styles.shortBox]}>
          <Text style={styles.shortBoxTitle}>バッグに足りないもの</Text>
          <View style={styles.pills}>
            {carryShortages.map(({ status }) => (
              <View key={status.target.id} style={styles.shortPill}>
                <Text style={styles.shortPillText}>
                  {status.target.name} あと{formatQuantity(status.carry?.shortage ?? 0)}
                  {status.target.unit}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {bagLots.length === 0 ? (
        <Text style={styles.empty}>持ち出しバッグには何も入っていません</Text>
      ) : (
        Object.entries(bagByCategory).map(([name, rows]) => (
          <View key={name} style={styles.section}>
            {categoryHeader(name, rows.length)}
            <View style={styles.grid}>
              {rows.map((item) => {
                const on = checked.has(item.id);
                const level = expiryLevel(item.expiresOn, today);
                const alert = level === 'expired' || level === 'soon';
                return (
                  <View key={item.id} style={[styles.bagTile, on && styles.bagTileOn]}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${item.name}を確かめた`}
                      onPress={() => toggle(item.id)}
                      style={styles.bagBody}
                    >
                      <View style={[styles.bagIcon, on ? { backgroundColor: SOFT.border } : null]}>
                        {on ? (
                          <Check size={26} color={SOFT.buttonText} strokeWidth={3} />
                        ) : (
                          <StockIcon name={item.name} category={item.category} size={24} color={SOFT.icon} />
                        )}
                      </View>
                      <Text style={styles.bagName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.bagQty}>
                        {formatQuantity(item.quantity)}
                        <Text style={styles.bagUnit}> {item.unit}</Text>
                      </Text>
                      {item.expiresOn && (
                        <Text style={[styles.tileNote, alert && styles.alertText]}>{expiryCountdown(item.expiresOn, today)}</Text>
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${item.name}を編集`}
                      onPress={() => onEditItem(item)}
                      hitSlop={6}
                      style={styles.bagEdit}
                    >
                      <Pencil size={13} color={colors.textFaint} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        ))
      )}
    </>
  );

  return (
    <>
      <View style={styles.bannerWrap}>{banner}</View>

      <SegmentedTabs
        options={STORAGE_OPTIONS}
        value={storage}
        onChange={onStorageChange}
        accessibilityLabel="保管場所"
        style={styles.tabs}
      />

      {storage === 'home' && categories.length > 1 && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {[ALL, ...categories.map((row) => row.category)].map((value) => {
              const selected = value === activeCategory;
              return (
                <Pressable
                  key={value || 'all'}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCategory(value)}
                  style={[styles.chip, selected && styles.chipOn]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextOn]}>{value === ALL ? 'すべて' : value}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, storage === 'carry' && bagLots.length > 0 && styles.contentWithFooter]}
        >
          {storage === 'home' ? homeView : carryView}
        </ScrollView>
        {storage === 'carry' && bagLots.length > 0 && (
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={!allChecked}
              onPress={() => {
                onInspect(bagLots);
                setChecked(new Set());
              }}
              style={[styles.finish, allChecked && styles.finishOn]}
            >
              <Text style={[styles.finishText, allChecked && { color: SOFT.buttonText }]}>
                {allChecked ? '点検完了（今日の日付を残す）' : `あと${bagLots.length - doneCount}つ確かめましょう`}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  redDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TONE.alert },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  bannerSub: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.textFaint },
  calm: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  calmText: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  tabs: { marginHorizontal: 16, marginBottom: 8 },
  chips: { gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.neutralSurface },
  chipOn: { backgroundColor: SOFT.button },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: SOFT.buttonText },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
  contentWithFooter: { paddingBottom: 96 },
  section: { gap: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  ringValue: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ringCenter: { alignItems: 'center' },
  ringLabel: { fontSize: 9, fontWeight: '700', color: colors.textFaint, marginTop: 1 },
  summaryTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  summarySub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2, fontVariant: ['tabular-nums'] },
  gear: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.bg },
  planPanel: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 12,
  },
  stepper: { alignItems: 'center', gap: 4 },
  stepperLabel: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  stepButton: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutralSurface },
  stepValue: { minWidth: 32, textAlign: 'center', fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.button },
  categoryName: { fontSize: 16, fontWeight: '700', color: colors.text },
  categoryCount: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48.4%',
    gap: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
  },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  tileIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.bg },
  bagTag: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: colors.neutralSurface },
  bagTagText: { fontSize: 10, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  tileName: { fontSize: 13, fontWeight: '700', color: colors.text, lineHeight: 16, minHeight: 32, marginTop: 4 },
  tileTotal: { fontSize: 24, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  tileUnit: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.neutralSurface, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  tileNote: { fontSize: 11, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  alertText: { color: colors.alertText },
  addTarget: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  addTargetText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  bagValue: { fontSize: 18, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  bagTotal: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  bagAge: { fontSize: 11, fontWeight: '700', color: colors.textFaint, marginTop: 2 },
  shortBox: { padding: 12, gap: 6 },
  shortBoxTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  shortPill: { borderRadius: 999, backgroundColor: colors.dangerSurface, paddingHorizontal: 10, paddingVertical: 4 },
  shortPillText: { fontSize: 11, fontWeight: '700', color: colors.alertText, fontVariant: ['tabular-nums'] },
  bagTile: { width: '48.4%', borderRadius: 16, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  bagTileOn: { borderColor: SOFT.border, backgroundColor: SOFT.bg },
  bagBody: { alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingTop: 16, paddingBottom: 12 },
  bagIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.bg },
  bagName: { fontSize: 13, fontWeight: '700', color: colors.text, textAlign: 'center', minHeight: 32, lineHeight: 16 },
  bagQty: { fontSize: 18, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  bagUnit: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  bagEdit: { position: 'absolute', top: 8, right: 8 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 8, backgroundColor: colors.background },
  finish: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.neutralSurface },
  finishOn: { backgroundColor: SOFT.button },
  finishText: { fontSize: 14, fontWeight: '700', color: colors.textFaint },
});
