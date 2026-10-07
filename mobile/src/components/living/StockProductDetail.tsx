import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StockItem, StockTarget } from '@/types/app';
import {
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  STORAGE_LABEL,
  unitPriceOf,
  type StockPlan,
  type StockProduct,
  type StockStorage,
} from '@/lib/stockUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { Ring, StockIcon, TONE } from './stockVisual';

// 品目1つの詳しい画面（docs/home.md §10.2）。PWA版の
// `src/components/sukusuku/living/StockProductDetail.tsx` と同じ項目・文言。
// 一覧のタイルには出さない費用と、その品目に数えるロットを期限順に並べる。
// 目標（必要数）がある品目は、必要数・不足・費用も出す。

interface StockProductDetailProps {
  product: StockProduct<StockItem, StockTarget>;
  plan: StockPlan;
  today: string;
  onClose: () => void;
  onEditTarget: (target: StockTarget) => void;
  onEditItem: (item: StockItem) => void;
}

const LEVEL_COLOR = {
  expired: colors.alertText,
  soon: colors.alertText,
  year: colors.textSubtle,
  ok: colors.textMuted,
  none: colors.textFaint,
};

const STORAGE_ORDER: StockStorage[] = ['home', 'carry'];

export default function StockProductDetail({
  product,
  plan,
  today,
  onClose,
  onEditTarget,
  onEditItem,
}: StockProductDetailProps) {
  const target = product.target;
  const status = target?.status ?? null;
  const cost = target?.cost ?? null;
  const shortage = status?.shortage ?? 0;
  const required = status?.required ?? 0;
  const ratio = status && required > 0 ? status.have / required : 1;
  const ringColor = shortage > 0 ? TONE.alert : TONE.ok;
  const unitLabel = status?.target.unit ?? product.unit;
  const facts: [string, string][] =
    status && cost
      ? [
          ['必要数', `${formatQuantity(required)}${unitLabel}`],
          [`${plan.days}日分の費用`, cost.total === null ? '値段未登録' : formatYen(cost.total)],
          ['買い足し', cost.shortageCost === null ? '—' : shortage > 0 ? formatYen(cost.shortageCost) : '不要'],
          [`1${unitLabel}あたり`, cost.unitPrice === null ? '—' : formatYen(cost.unitPrice)],
        ]
      : [];
  const ordered = STORAGE_ORDER.flatMap((storage) => product.lots.filter((item) => item.storage === storage));

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={product.name}
        onClose={onClose}
        footer={
          <Pressable
            accessibilityRole="button"
            onPress={() => (status ? onEditTarget(status.target) : onClose())}
            style={styles.footerButton}
          >
            <Text style={styles.footerButtonText}>{status ? '必要数を直す' : '閉じる'}</Text>
          </Pressable>
        }
      >
        <View style={styles.hero}>
          <Ring size={88} stroke={9} ratio={ratio} color={ringColor}>
            <StockIcon name={product.name} category={product.category} size={30} color={ringColor} />
          </Ring>
          <View style={styles.flex}>
            <Text style={styles.big}>
              {formatQuantity(product.total)}
              <Text style={styles.bigSub}> {unitLabel}</Text>
            </Text>
            {shortage > 0 && (
              <Text style={[styles.state, { color: colors.alertText }]}>
                あと{formatQuantity(shortage)}
                {unitLabel}
              </Text>
            )}
            {status?.carry && (
              <Text style={[styles.carry, { color: status.carry.shortage > 0 ? colors.alertText : colors.textMuted }]}>
                持ち出し {formatQuantity(status.carry.have)} / {formatQuantity(status.carry.required)}
                {unitLabel}
              </Text>
            )}
            {!status && product.carryTotal > 0 && (
              <Text style={[styles.carry, { color: colors.textMuted }]}>
                持ち出し {formatQuantity(product.carryTotal)}
                {unitLabel}
              </Text>
            )}
          </View>
        </View>

        {facts.length > 0 && (
          <View style={styles.facts}>
            {facts.map(([label, value]) => (
              <View key={label} style={styles.fact}>
                <Text style={styles.factLabel}>{label}</Text>
                <Text style={styles.factValue}>{value}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.lots}>
          <Text style={styles.lotsTitle}>ロット（期限の近い順）</Text>
          {ordered.length === 0 ? (
            <Text style={styles.empty}>まだありません</Text>
          ) : (
            <View style={styles.card}>
              {ordered.map((item, index) => {
                const level = expiryLevel(item.expiresOn, today);
                const unit = unitPriceOf(item);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => onEditItem(item)}
                    style={[styles.lot, index > 0 && styles.divided]}
                  >
                    <View style={styles.flex}>
                      <View style={styles.inline}>
                        {item.storage === 'carry' && (
                          <View style={styles.tag}>
                            <Text style={styles.tagText}>{STORAGE_LABEL.carry}</Text>
                          </View>
                        )}
                        <Text style={styles.lotName}>{item.name}</Text>
                      </View>
                      {item.price !== null && (
                        <Text style={styles.lotSub}>
                          {formatYen(item.price)}/{item.unit || '個'}
                          {unit !== null && status && (item.unit !== status.target.unit || item.amountPerUnit !== 1)
                            ? `（${formatYen(unit)}/${status.target.unit}）`
                            : ''}
                        </Text>
                      )}
                    </View>
                    <View style={styles.right}>
                      <Text style={styles.quantity}>
                        {formatQuantity(item.quantity)}
                        {item.unit}
                      </Text>
                      <Text style={[styles.expiry, { color: LEVEL_COLOR[level] }]}>
                        {item.expiresOn ? `${formatExpiry(item)}・${expiryCountdown(item.expiresOn, today)}` : '期限なし'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  big: { fontSize: 30, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  bigSub: { fontSize: 14, fontWeight: '700', color: colors.textFaint },
  state: { fontSize: 14, fontWeight: '700' },
  carry: { fontSize: 12, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: { width: '48.5%', borderRadius: 12, backgroundColor: colors.neutralSurface, paddingHorizontal: 12, paddingVertical: 8 },
  factLabel: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  factValue: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  lots: { gap: 6 },
  lotsTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  card: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface },
  lot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  lotName: { fontSize: 14, fontWeight: '700', color: colors.text },
  lotSub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2, fontVariant: ['tabular-nums'] },
  right: { alignItems: 'flex-end' },
  quantity: { fontSize: 13, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  expiry: { fontSize: 11, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  tag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: colors.neutralSurface },
  tagText: { fontSize: 10, fontWeight: '700', color: colors.textSubtle },
  footerButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.neutralSurface },
  footerButtonText: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
});
