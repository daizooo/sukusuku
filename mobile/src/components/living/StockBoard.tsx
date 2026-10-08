import { useMemo, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import { colors } from '@/lib/theme';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
import {
  buildStockBoard,
  daysBetween,
  expiryCountdown,
  formatQuantity,
  spanText,
  type StockPlan,
  type StockProduct,
} from '@/lib/stockUtils';
import StockAttention from './StockAttention';
import StockBagCheck from './StockBagCheck';
import StockProductDetail from './StockProductDetail';
import { readinessColor, Ring, SOFT } from './stockVisual';

// 防災備蓄の画面（docs/home.md §10.2.2）。PWA版の
// `src/components/sukusuku/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 主役は「どんな備蓄が、どれだけあるか」。上はまとめて静かにし、品目の行で全体の数を大きく出す。
//   上（固定）: 備え度と「確認が必要」を1枚にまとめたカード（押すと「確認が必要なもの」）・カテゴリのタブ。
//     「バッグ」と「＋」は暮らしタブの見出しの右（mobile/app/(tabs)/living.tsx）。人数・日数は画面では変えない。
//   中（スクロール）: カテゴリごとの品目の行（寝室・持ち出し用の内訳は品目の詳しい画面）。
// 色は淡い橙と、対応が要るものの赤だけ。文字は見出し・数を太く大きく、品名は普通の太さ、単位は薄く小さく。

interface StockBoardProps {
  items: StockItem[];
  targets: StockTarget[];
  plan: StockPlan;
  /** 日本時間の今日（YYYY-MM-DD）。 */
  today: string;
  /** 持ち出しバッグの点検を開いているか（見出しの「バッグ」から開く）。 */
  bagOpen: boolean;
  onBagOpenChange: (open: boolean) => void;
  onEditItem: (item: StockItem) => void;
  onEditTarget: (target: StockTarget) => void;
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
  bagOpen,
  onBagOpenChange,
  onEditItem,
  onEditTarget,
  onSendShortage,
  onRestock,
  onUse,
  onDiscard,
  onInspect,
}: StockBoardProps) {
  const board = useMemo(() => buildStockBoard(items, targets, plan, today), [items, targets, plan, today]);
  const { counts, attention, readiness, categories } = board;
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
  // カテゴリは、一覧の上の左右スワイプでも切り替える（一覧が指に合わせて動く）。
  const swipe = useSwipeTabs(
    [ALL, ...categories.map((row) => row.category)],
    activeCategory,
    setCategory,
  );
  const detail = categories.flatMap((row) => row.products).find((product) => product.key === detailKey) ?? null;
  const inspectable = board.equipment.filter((item) => item.inspectIntervalMonths !== null);

  // ---- 備え度と「確認が必要」を1枚に ----
  const ringColor = readinessColor(readiness);
  const breakdown = [
    shortCount > 0 && `不足 ${shortCount}`,
    expiryCount > 0 && `期限 ${expiryCount}`,
    inspectCount > 0 && `点検 ${inspectCount}`,
  ]
    .filter(Boolean)
    .join('・');
  const summary = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="確認が必要なものを開く"
      onPress={() => setAttentionOpen(true)}
      style={styles.summary}
    >
      <Ring size={38} stroke={5} ratio={readiness / 100} color={ringColor}>
        <Text style={[styles.ringValue, { color: ringColor }]}>{readiness}</Text>
      </Ring>
      <View style={styles.flex}>
        <Text style={styles.summaryPlan}>
          {plan.people}人×{plan.days}日分
        </Text>
        {attentionCount > 0 ? (
          <Text style={styles.summaryAlert}>
            確認が必要 {attentionCount}件（{breakdown}）
          </Text>
        ) : (
          <Text style={styles.summaryCalm}>確認が必要なものはありません</Text>
        )}
      </View>
      <ChevronRight size={16} color={colors.borderStrong} />
    </Pressable>
  );

  // ---- 品目の行（品名は全部見せ、全体の数を右に大きく） ----
  const productRow = (product: StockProduct<StockItem, StockTarget>, index: number) => {
    const status = product.target?.status ?? null;
    const shortage = status?.shortage ?? 0;
    const nearestLevel = product.nearest?.level;
    const nearestAlert = nearestLevel === 'expired' || nearestLevel === 'soon';
    // 品名の下の一行は1つだけ。対応が要るものを先に（不足 → 期限 → 点検）。
    const note =
      shortage > 0 && status
        ? { text: `あと${formatQuantity(shortage)}${status.target.unit}不足`, alert: true }
        : product.nearest && nearestAlert
          ? { text: expiryCountdown(product.nearest.on, today), alert: true }
          : product.inspect?.due
            ? { text: '点検の時期', alert: true }
            : product.nearest
              ? { text: expiryCountdown(product.nearest.on, today), alert: false }
              : product.inspect
                ? { text: `点検まで${spanText(daysBetween(today, product.inspect.next))}`, alert: false }
                : null;
    return (
      <Pressable
        key={product.key}
        accessibilityRole="button"
        accessibilityLabel={`${product.name}の詳しい画面を開く`}
        onPress={() => setDetailKey(product.key)}
        style={[styles.row, index > 0 && styles.rowDivided]}
      >
        <View style={styles.flex}>
          <Text style={styles.rowName}>{product.name}</Text>
          {note && <Text style={[styles.rowNote, note.alert && styles.alertText]}>{note.text}</Text>}
        </View>
        <Text style={styles.rowTotal}>
          {formatQuantity(product.total)}
          <Text style={styles.rowUnit}> {product.unit}</Text>
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      <View style={styles.summaryWrap}>{summary}</View>

      {categories.length > 1 && (
        <View style={styles.tabsWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {[ALL, ...categories.map((row) => row.category)].map((value) => {
              const selected = value === activeCategory;
              return (
                <Pressable
                  key={value || 'all'}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCategory(value)}
                  style={[styles.tab, selected && styles.tabOn]}
                >
                  <Text style={[styles.tabText, selected && styles.tabTextOn]}>{value === ALL ? 'すべて' : value}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <Animated.ScrollView
        style={[styles.flex, swipe.style]}
        contentContainerStyle={styles.content}
        {...swipe.handlers}
      >
        {shown.length === 0 ? (
          <Text style={styles.empty}>備蓄はまだありません</Text>
        ) : (
          shown.map((row) => (
            <View key={row.category} style={styles.section}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryName}>{row.category}</Text>
                <Text style={styles.categoryCount}>{row.products.length}</Text>
              </View>
              <View style={styles.card}>{row.products.map(productRow)}</View>
            </View>
          ))
        )}
      </Animated.ScrollView>

      {detail && (
        <StockProductDetail
          product={detail}
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
            onBagOpenChange(true);
          }}
        />
      )}

      {bagOpen && (
        <StockBagCheck
          board={board}
          items={items}
          plan={plan}
          today={today}
          onClose={() => onBagOpenChange(false)}
          onEditItem={(item) => {
            onBagOpenChange(false);
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
  summaryWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ringValue: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  summaryPlan: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  summaryAlert: { fontSize: 12, fontWeight: '700', color: colors.alertText, marginTop: 1, fontVariant: ['tabular-nums'] },
  summaryCalm: { fontSize: 12, fontWeight: '700', color: colors.textFaint, marginTop: 1 },
  tabsWrap: { borderBottomWidth: 1, borderBottomColor: colors.border },
  tabs: { gap: 16, paddingHorizontal: 16 },
  tab: { paddingTop: 4, paddingBottom: 7, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: SOFT.icon },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.textFaint },
  tabTextOn: { color: colors.text },
  content: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 24, gap: 12 },
  section: { gap: 4 },
  categoryHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 2 },
  categoryName: { fontSize: 15, fontWeight: '800', color: colors.text },
  categoryCount: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.neutralSurface },
  rowName: { fontSize: 14, fontWeight: '500', color: colors.text, lineHeight: 19 },
  rowNote: { fontSize: 11, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  rowTotal: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'], textAlign: 'right' },
  rowUnit: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  alertText: { color: colors.alertText },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
});
