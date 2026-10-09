import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { Pencil, Plus } from 'lucide-react-native';
import type { HouseholdProduct } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import { formatAxisYen, niceTicks } from '@/lib/moneyUtils';
import { loadProductPurchases } from '@/lib/api/householdProducts';
import {
  MIN_PURCHASES_FOR_COST,
  compactYen,
  costEstimate,
  formatPriceChange,
  monthlyPurchases,
  priceHistory,
  priceSummary,
  priceTrend,
  purchaseTotals,
  type PricePoint,
  type PurchaseLine,
} from '@/lib/productPurchases';
import { formatPrice } from '@/lib/shoppingUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 日用品1品の詳しい画面（docs/home.md §4.6）。PWA版の
// `src/components/sukusuku/living/ProductDetail.tsx` と同じ項目・文言。
// 上に品名の下のお店・カテゴリと鉛筆（編集）、いつもの値段と「買い出しリストへ」。
// 下に家計の記録から数えた費用の目安・月ごとの個数・買った記録。
// 数えるのは、家計で「日用品から選ぶ」で入れた記録だけ（品名が同じでも数えない）。

interface ProductDetailProps {
  product: HouseholdProduct;
  onClose: () => void;
  onEdit: () => void;
  /** 行の「＋」と同じ送り方。 */
  onSend: () => void;
  /** 送ったあとの一言（モーダルの上に出すため、呼び出し側から受け取る）。 */
  banner: ReactNode;
}

/** 月ごとの棒の高さ（最大）。 */
const BAR_MAX = 56;

/** 値段の推移の折れ線（買った日ごとの単価）。PWA版の同名の部品と同じ並び。 */
const CHART_HEIGHT = 120;
const PAD = { left: 40, right: 10, top: 10, bottom: 22 };

const dayNumber = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};
const shortDate = (key: string) => {
  const [, month, day] = key.split('-').map(Number);
  return `${month}/${day}`;
};

function PriceChart({ points }: { points: PricePoint[] }) {
  const [width, setWidth] = useState(0);
  const geometry = useMemo(() => {
    if (width === 0) return null;
    const ticks = niceTicks(Math.min(...points.map((p) => p.unitPrice)), Math.max(...points.map((p) => p.unitPrice)));
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    const plotWidth = width - PAD.left - PAD.right;
    const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
    const start = dayNumber(points[0].on);
    const span = dayNumber(points[points.length - 1].on) - start;
    const x = (on: string) => PAD.left + (span === 0 ? plotWidth / 2 : ((dayNumber(on) - start) / span) * plotWidth);
    const y = (value: number) => PAD.top + (high === low ? plotHeight / 2 : (1 - (value - low) / (high - low)) * plotHeight);
    return { ticks, x, y, line: points.map((p) => `${x(p.on)},${y(p.unitPrice)}`).join(' ') };
  }, [points, width]);

  return (
    <View style={styles.chart} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {geometry && (
        <Svg width={width} height={CHART_HEIGHT}>
          {geometry.ticks.map((tick) => (
            <Line
              key={tick}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              stroke={colors.borderStrong}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ))}
          {geometry.ticks.map((tick) => (
            <SvgText
              key={`label-${tick}`}
              x={PAD.left - 6}
              y={geometry.y(tick) + 4}
              fontSize={10}
              fontWeight="500"
              fill={colors.textFaint}
              textAnchor="end"
            >
              {formatAxisYen(tick)}
            </SvgText>
          ))}
          {points.length > 1 && (
            <Polyline points={geometry.line} fill="none" stroke={colors.livingProducts} strokeWidth={2} strokeLinejoin="round" />
          )}
          {points.map((point, index) => (
            <Circle key={`${point.on}-${index}`} cx={geometry.x(point.on)} cy={geometry.y(point.unitPrice)} r={3.5} fill={colors.livingProducts} />
          ))}
          <SvgText x={PAD.left} y={CHART_HEIGHT - 6} fontSize={10} fontWeight="500" fill={colors.textFaint} textAnchor="start">
            {shortDate(points[0].on)}
          </SvgText>
          {points.length > 1 && (
            <SvgText x={width - PAD.right} y={CHART_HEIGHT - 6} fontSize={10} fontWeight="500" fill={colors.textFaint} textAnchor="end">
              {shortDate(points[points.length - 1].on)}
            </SvgText>
          )}
        </Svg>
      )}
    </View>
  );
}

export default function ProductDetail({ product, onClose, onEdit, onSend, banner }: ProductDetailProps) {
  const [lines, setLines] = useState<PurchaseLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const today = toDateString(new Date());

  useEffect(() => {
    let isMounted = true;
    loadProductPurchases(supabase, product.id)
      .then((loaded) => {
        if (isMounted) setLines(loaded);
      })
      .catch(() => {
        if (isMounted) setFailed(true);
      });
    return () => {
      isMounted = false;
    };
  }, [product.id]);

  const cost = useMemo(() => (lines ? costEstimate(lines, today) : null), [lines, today]);
  const months = useMemo(() => (lines ? monthlyPurchases(lines, today) : []), [lines, today]);
  const maxQuantity = Math.max(1, ...months.map((row) => row.quantity));
  const records = useMemo(() => (lines ? priceHistory(lines) : []), [lines]);
  const trend = useMemo(() => (lines ? priceTrend(lines) : []), [lines]);
  const summary = useMemo(() => priceSummary(trend), [trend]);
  const totals = useMemo(() => purchaseTotals(lines ?? []), [lines]);
  const sub = [product.store, product.category].filter((text) => text !== '').join('・');

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={product.name}
        onClose={onClose}
        footer={
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.footerButton}>
            <Text style={styles.footerButtonText}>閉じる</Text>
          </Pressable>
        }
      >
        <View style={styles.head}>
          <Text style={[styles.sub, styles.flex]}>{sub}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${product.name}を編集`}
            onPress={onEdit}
            hitSlop={10}
            style={styles.edit}
          >
            <Pencil size={14} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.priceRow}>
          <View style={styles.flex}>
            <Text style={styles.priceLabel}>いつもの値段</Text>
            <Text style={styles.price}>{product.price === null ? '—' : formatPrice(product.price)}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onSend} style={styles.send}>
            <Plus size={16} color={colors.primaryText} />
            <Text style={styles.sendText}>買い出しリストへ</Text>
          </Pressable>
        </View>

        {lines === null ? (
          <Text style={styles.message}>{failed ? '記録を読み込めませんでした' : '読み込み中...'}</Text>
        ) : lines.length === 0 ? (
          <Text style={styles.message}>
            家計で記録するときに「日用品から選ぶ」でこの品を選ぶと、ここに買った記録がたまります
          </Text>
        ) : (
          <>
            <View style={styles.costCard}>
              {cost ? (
                <View style={styles.costRow}>
                  {(
                    [
                      ['1日あたり', cost.perDay],
                      ['1か月あたり', cost.perMonth],
                      ['1年あたり', cost.perYear],
                    ] as const
                  ).map(([label, value]) => (
                    <View key={label} style={styles.costCell}>
                      <Text style={styles.costLabel}>{label}</Text>
                      <Text style={styles.costValue}>{formatPrice(value)}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.costWait}>{MIN_PURCHASES_FOR_COST}回買うと費用の目安を出します</Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>月ごと</Text>
              <View style={styles.bars}>
                {months.map((row) => {
                  const height = row.quantity === 0 ? 0 : Math.max(3, Math.round((row.quantity / maxQuantity) * BAR_MAX));
                  return (
                    <View key={row.month} style={styles.barCol}>
                      <Text style={styles.barQuantity}>{row.quantity === 0 ? '' : row.quantity}</Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.bar, { height }]} />
                      </View>
                      <Text style={styles.barMonth}>{Number(row.month.slice(5))}月</Text>
                      <Text style={styles.barAmount}>{row.amount === 0 ? '' : compactYen(row.amount)}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {summary && trend.length >= MIN_PURCHASES_FOR_COST && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>値段の推移</Text>
                <PriceChart points={trend} />
                <Text style={styles.trendNote}>
                  {formatPrice(summary.first.unitPrice)}（{shortDate(summary.first.on)}）→ {formatPrice(summary.latest.unitPrice)}（
                  {shortDate(summary.latest.on)}）
                  {summary.change !== 0 ? `　${formatPriceChange(summary.change)}` : '　変わらず'}
                </Text>
                <Text style={styles.trendNote}>
                  最安 {formatPrice(summary.lowest.unitPrice)}
                  {summary.lowest.store !== '' ? `（${summary.lowest.store}・${shortDate(summary.lowest.on)}）` : `（${shortDate(summary.lowest.on)}）`}
                </Text>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>買った記録</Text>
              <View style={styles.card}>
                {records.map((row, index) => (
                  <View key={`${row.on}-${index}`} style={[styles.record, index > 0 && styles.divided]}>
                    <Text style={styles.recordDate}>{row.on.replace(/-/g, '.')}</Text>
                    <Text style={styles.recordQuantity}>{row.quantity}個</Text>
                    <Text style={styles.recordPrice}>{formatPrice(row.unitPrice)}</Text>
                    <Text style={[styles.recordChange, row.change !== null && row.change > 0 && styles.recordUp]}>
                      {row.change === null ? '' : formatPriceChange(row.change)}
                    </Text>
                    <Text style={styles.recordStore} numberOfLines={1}>
                      {row.store}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.totals}>
                {totals.count}回・合計 {formatPrice(totals.amount)}
              </Text>
            </View>
          </>
        )}
      </LogModalShell>
      {banner}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  edit: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  priceLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  price: { fontSize: 22, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.livingProducts,
  },
  sendText: { fontSize: 13, fontWeight: '700', color: colors.primaryText },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 20 },
  costCard: { borderRadius: 14, backgroundColor: colors.livingProductsSurface, paddingHorizontal: 12, paddingVertical: 10 },
  costRow: { flexDirection: 'row', gap: 8 },
  costCell: { flex: 1, alignItems: 'center', gap: 2 },
  costLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  costValue: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  costWait: { fontSize: 12, fontWeight: '500', color: colors.textFaint, textAlign: 'center' },
  section: { gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  bars: { flexDirection: 'row', gap: 2 },
  barCol: { flex: 1, alignItems: 'center', gap: 2 },
  barQuantity: { height: 14, fontSize: 10, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  barTrack: { height: BAR_MAX, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '60%', borderRadius: 3, backgroundColor: colors.livingProducts },
  barMonth: { fontSize: 9, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  barAmount: { height: 12, fontSize: 8, fontWeight: '500', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  card: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface },
  record: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  divided: { borderTopWidth: 1, borderTopColor: colors.neutralSurface },
  recordDate: { fontSize: 12, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  recordQuantity: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  recordPrice: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  recordChange: { minWidth: 44, fontSize: 10, fontWeight: '700', color: colors.livingProducts, fontVariant: ['tabular-nums'] },
  recordUp: { color: colors.alertText },
  recordStore: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '500', color: colors.textFaint },
  chart: { height: CHART_HEIGHT },
  trendNote: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  totals: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textAlign: 'right', fontVariant: ['tabular-nums'] },
  footerButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.neutralSurface },
  footerButtonText: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
});
