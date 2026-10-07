import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Backpack, Check, ChevronRight, Clock, Minus, Plus, Settings2, Wrench } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildStockBoard,
  daysBetween,
  expiryCountdown,
  formatQuantity,
  formatYen,
  spanText,
  type StockPlan,
  type StockProduct,
} from '@/lib/stockUtils';
import StockAttention from './StockAttention';
import StockBagCheck from './StockBagCheck';
import StockProductDetail from './StockProductDetail';
import { readinessColor, Ring, SOFT, StockIcon, TONE } from './stockVisual';

// 防災備蓄の画面（docs/home.md §10.2・§10.2.1）。PWA版の
// `src/components/sukusuku/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 主役は「どんな備蓄が、どれだけあるか」。カテゴリごとに品目の行を並べ、全体の数を大きく出す。
// 期限・不足・点検は品目に付く補助の情報なので、行の小さな一行と、上の細い帯から開く
// 「確認が必要なもの」（StockAttention）に置く。色は淡い橙と、対応が要るものの赤だけ。
//   上（固定）: 確認が必要なものの帯と「バッグ」・カテゴリの絞り込み。
//   中（スクロール）: 備え度 → カテゴリごとの品目の行（寝室・持ち出し用の内訳は品目の詳しい画面）。
//   「バッグ」は、バッグの中身を押して確かめるチェック表（StockBagCheck）を開く。

type PlanKey = keyof StockPlan;

interface StockBoardProps {
  items: StockItem[];
  targets: StockTarget[];
  plan: StockPlan;
  /** 日本時間の今日（YYYY-MM-DD）。 */
  today: string;
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

/** 絞り込みの「すべて」。 */
const ALL = '';

export default function StockBoard({
  items,
  targets,
  plan,
  today,
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
  const [showPlan, setShowPlan] = useState(false);
  const [category, setCategory] = useState(ALL);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);

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

  // ---- 帯の右の「バッグ」（持ち出しバッグの点検を開く。点検の時期だけ赤い点） ----
  const bagButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bagDue ? '持ち出しバッグを点検する（点検の時期です）' : '持ち出しバッグを点検する'}
      onPress={() => setBagOpen(true)}
      style={styles.bagButton}
    >
      <Backpack size={14} color={SOFT.buttonText} />
      <Text style={styles.bagButtonText}>バッグ</Text>
      {bagDue && <View style={styles.bagDot} />}
    </Pressable>
  );

  // ---- 備え度（1行） ----
  const ringColor = readinessColor(readiness);
  const summary = (
    <View style={styles.card}>
      <View style={styles.summaryRow}>
        <Ring size={36} stroke={5} ratio={readiness / 100} color={ringColor}>
          <Text style={[styles.ringValue, { color: ringColor }]}>{readiness}</Text>
        </Ring>
        <Text style={styles.summaryLine} numberOfLines={1}>
          {plan.people}人×{plan.days}日分
          <Text style={styles.summarySub}>
            {'  '}
            {overview.shortageTotal > 0
              ? `あと ${formatYen(overview.shortageTotal)}${overview.unpricedTargets > 0 ? '＋' : ''} で揃う`
              : overview.unpricedTargets > 0
                ? '値段を入れると費用が出ます'
                : '必要な量が揃っています'}
          </Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="人数・日数を変える"
          accessibilityState={{ expanded: showPlan }}
          onPress={() => setShowPlan((prev) => !prev)}
          style={styles.gear}
        >
          <Settings2 size={14} color={SOFT.icon} />
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

  // ---- 品目の行（リスト。品名は全部見せ、数量を右に大きく） ----
  const productRow = (product: StockProduct<StockItem, StockTarget>, index: number) => {
    const status = product.target?.status ?? null;
    const shortage = status?.shortage ?? 0;
    const required = status?.required ?? 0;
    const ratio = status && required > 0 ? Math.min(1, status.have / required) : null;
    const nearestLevel = product.nearest?.level;
    const nearestAlert = nearestLevel === 'expired' || nearestLevel === 'soon';
    const hasNotes = shortage > 0 || product.nearest !== null || product.inspect !== null;
    return (
      <Pressable
        key={product.key}
        accessibilityRole="button"
        accessibilityLabel={`${product.name}の詳しい画面を開く`}
        onPress={() => setDetailKey(product.key)}
        style={[styles.row, index > 0 && styles.rowDivided]}
      >
        <View style={styles.tileIcon}>
          <StockIcon name={product.name} category={product.category} size={13} color={SOFT.icon} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.rowName}>{product.name}</Text>
          {hasNotes && (
            <View style={styles.notes}>
              {shortage > 0 && status && (
                <Text style={[styles.tileNote, styles.alertText]}>
                  あと{formatQuantity(shortage)}
                  {status.target.unit}不足
                </Text>
              )}
              {product.nearest && (
                <View style={styles.noteRow}>
                  <Clock size={9} color={nearestAlert ? colors.alertText : colors.textFaint} />
                  <Text style={[styles.tileNote, nearestAlert && styles.alertText]}>
                    {expiryCountdown(product.nearest.on, today)}
                  </Text>
                </View>
              )}
              {product.inspect && (
                <View style={styles.noteRow}>
                  <Wrench size={9} color={product.inspect.due ? colors.alertText : colors.textFaint} />
                  <Text style={[styles.tileNote, product.inspect.due && styles.alertText]}>
                    {product.inspect.due ? '点検の時期' : `点検まで${spanText(daysBetween(today, product.inspect.next))}`}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.rowTotal}>
            {formatQuantity(product.total)}
            <Text style={styles.tileUnit}> {product.unit}</Text>
          </Text>
        </View>
        {ratio !== null && (
          <View style={styles.rowBar}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.round(ratio * 100)}%`, backgroundColor: shortage > 0 ? TONE.alert : SOFT.border },
              ]}
            />
          </View>
        )}
      </Pressable>
    );
  };

  const categoryHeader = (name: string, count: number) => (
    <View style={styles.categoryHeader}>
      <View style={styles.categoryIcon}>
        <StockIcon name={name} size={11} color={SOFT.icon} />
      </View>
      <Text style={styles.categoryName}>{name}</Text>
      <Text style={styles.categoryCount}>{count}</Text>
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
            <View style={styles.card}>{row.products.map(productRow)}</View>
          </View>
        ))
      )}
      <Pressable accessibilityRole="button" onPress={onAddTarget} style={styles.addTarget}>
        <Plus size={14} color={colors.textSubtle} />
        <Text style={styles.addTargetText}>目標（必要数）を追加</Text>
      </Pressable>
    </>
  );

  return (
    <>
      <View style={styles.bannerWrap}>
        <View style={styles.flex}>{banner}</View>
        {bagButton}
      </View>

      {categories.length > 1 && (
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
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          {homeView}
        </ScrollView>
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
            setBagOpen(true);
          }}
        />
      )}

      {bagOpen && (
        <StockBagCheck
          board={board}
          items={items}
          plan={plan}
          today={today}
          onClose={() => setBagOpen(false)}
          onEditItem={(item) => {
            setBagOpen(false);
            onEditItem(item);
          }}
          onInspect={onInspect}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 6 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  redDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TONE.alert },
  bannerTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  bannerSub: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.textFaint },
  calm: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingVertical: 7 },
  bagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 16,
    backgroundColor: SOFT.button,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  bagButtonText: { fontSize: 12, fontWeight: '700', color: SOFT.buttonText },
  bagDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: TONE.alert,
  },
  calmText: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  chips: { gap: 6, paddingHorizontal: 16, paddingBottom: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.neutralSurface },
  chipOn: { backgroundColor: SOFT.button },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: SOFT.buttonText },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  section: { gap: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6 },
  summaryLine: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.text },
  ringValue: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  summarySub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2, fontVariant: ['tabular-nums'] },
  gear: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.bg },
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
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.button },
  categoryName: { fontSize: 13, fontWeight: '700', color: colors.text },
  categoryCount: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.neutralSurface },
  rowName: { fontSize: 13, fontWeight: '700', color: colors.text, lineHeight: 17 },
  rowTotal: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], textAlign: 'right' },
  rowRight: { alignItems: 'flex-end' },
  rowBar: { position: 'absolute', left: 10, right: 10, bottom: 0, height: 2, backgroundColor: colors.neutralSurface, overflow: 'hidden' },
  tileIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: SOFT.bg },
  tileUnit: { fontSize: 10, fontWeight: '700', color: colors.textFaint },
  barFill: { height: 2 },
  notes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 },
  tileNote: { fontSize: 10, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  alertText: { color: colors.alertText },
  addTarget: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4 },
  addTargetText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
});
