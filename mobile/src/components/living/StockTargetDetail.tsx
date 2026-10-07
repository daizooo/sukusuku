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
  type StockStorage,
  type TargetCost,
  type TargetStatus,
} from '@/lib/stockUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { Ring, StockIcon, TONE } from './stockVisual';

// 目標（水・ご飯など）1つの詳しい画面（docs/home.md §10.2）。PWA版の
// `src/components/sukusuku/living/StockTargetDetail.tsx` と同じ項目・文言。
// 一覧のタイルには出さない費用と、その目標に数えるロットを期限順に並べる。

interface StockTargetDetailProps {
  status: TargetStatus<StockTarget>;
  cost: TargetCost;
  lots: StockItem[];
  plan: StockPlan;
  today: string;
  onClose: () => void;
  onEditTarget: () => void;
  onEditItem: (item: StockItem) => void;
}

const LEVEL_COLOR = {
  expired: colors.alertText,
  soon: colors.alertText,
  year: colors.temperatureText,
  ok: colors.textMuted,
  none: colors.textFaint,
};

const STORAGE_ORDER: StockStorage[] = ['home', 'carry'];

export default function StockTargetDetail({
  status,
  cost,
  lots,
  plan,
  today,
  onClose,
  onEditTarget,
  onEditItem,
}: StockTargetDetailProps) {
  const { target, required, have, shortage, carry } = status;
  const ratio = required > 0 ? have / required : 1;
  const color = shortage > 0 ? TONE.alert : TONE.ok;
  const facts: [string, string][] = [
    ['1日あたり', cost.daily === null ? '決まった数' : `${formatQuantity(cost.daily)}${target.unit}`],
    [`${plan.days}日分の費用`, cost.total === null ? '値段未登録' : formatYen(cost.total)],
    ['買い足し', cost.shortageCost === null ? '—' : shortage > 0 ? formatYen(cost.shortageCost) : '不要'],
    [`1${target.unit}あたり`, cost.unitPrice === null ? '—' : formatYen(cost.unitPrice)],
  ];
  const ordered = STORAGE_ORDER.flatMap((storage) => lots.filter((item) => item.storage === storage));

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={target.name}
        onClose={onClose}
        footer={
          <Pressable accessibilityRole="button" onPress={onEditTarget} style={styles.footerButton}>
            <Text style={styles.footerButtonText}>必要数を直す</Text>
          </Pressable>
        }
      >
        <View style={styles.hero}>
          <Ring size={88} stroke={9} ratio={ratio} color={color}>
            <StockIcon name={target.name} category={target.category} size={30} color={color} />
          </Ring>
          <View style={styles.flex}>
            <Text style={styles.big}>
              {formatQuantity(have)}
              <Text style={styles.bigSub}>
                {' '}
                / {formatQuantity(required)}
                {target.unit}
              </Text>
            </Text>
            <Text style={[styles.state, { color: shortage > 0 ? colors.alertText : colors.doneText }]}>
              {shortage > 0 ? `あと${formatQuantity(shortage)}${target.unit}` : '足りています'}
            </Text>
            {carry && (
              <Text style={[styles.carry, { color: carry.shortage > 0 ? colors.alertText : colors.textMuted }]}>
                持ち出し {formatQuantity(carry.have)} / {formatQuantity(carry.required)}
                {target.unit}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.facts}>
          {facts.map(([label, value]) => (
            <View key={label} style={styles.fact}>
              <Text style={styles.factLabel}>{label}</Text>
              <Text style={styles.factValue}>{value}</Text>
            </View>
          ))}
        </View>

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
                          {unit !== null && (item.unit !== target.unit || item.amountPerUnit !== 1)
                            ? `（${formatYen(unit)}/${target.unit}）`
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
  big: { fontSize: 26, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
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
  tag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: colors.diaperSurface },
  tagText: { fontSize: 10, fontWeight: '700', color: colors.diaperText },
  footerButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.neutralSurface },
  footerButtonText: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
});
