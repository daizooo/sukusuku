import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ClipboardCheck, ListPlus, PackageCheck, Trash2, Utensils, Wrench, type LucideIcon } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import {
  daysBetween,
  expiryCountdown,
  formatQuantity,
  formatYen,
  spanText,
  STORAGE_LABEL,
  type buildStockBoard,
} from '@/lib/stockUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { SOFT, StockIcon, TONE } from './stockVisual';

// 「確認が必要なもの」（docs/home.md §10.2）。期限・不足・点検は品目に付く補助の情報なので、
// 一覧の主役にはせず、上の帯から開くこの画面に集める。PWA版の
// `src/components/sukusuku/living/StockAttention.tsx` と同じ項目・文言。

type Board = ReturnType<typeof buildStockBoard<StockItem, StockTarget>>;

interface StockAttentionProps {
  board: Board;
  /** 備品（期限なし）のうち、点検する設定のもの。「まとめて点検した」の対象。 */
  inspectable: StockItem[];
  today: string;
  onClose: () => void;
  onEditItem: (item: StockItem) => void;
  onSendShortage: (target: StockTarget, shortage: number) => void;
  onRestock: (item: StockItem) => void;
  onUse: (item: StockItem) => void;
  onDiscard: (item: StockItem) => void;
  onInspect: (items: StockItem[]) => void;
  /** 持ち出しバッグのチェック表を開く。 */
  onOpenBag: () => void;
}

export default function StockAttention({
  board,
  inspectable,
  today,
  onClose,
  onEditItem,
  onSendShortage,
  onRestock,
  onUse,
  onDiscard,
  onInspect,
  onOpenBag,
}: StockAttentionProps) {
  const { attention } = board;
  const bagDue = attention.bag?.due === true;
  const bagAge = attention.bag?.lastOn
    ? `${spanText(daysBetween(attention.bag.lastOn, today))}前に点検`
    : 'まだ点検していません';

  const bubble = (name: string, category: string) => (
    <View style={styles.bubble}>
      <StockIcon name={name} category={category} size={22} color={SOFT.icon} />
    </View>
  );

  const button = (label: string, onPress: () => void, Icon: LucideIcon, kind: 'main' | 'sub') => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.action, kind === 'main' ? styles.actionMain : styles.actionSub]}
    >
      <Icon size={14} color={kind === 'main' ? SOFT.buttonText : colors.textSubtle} />
      <Text style={[styles.actionText, { color: kind === 'main' ? SOFT.buttonText : colors.textSubtle }]}>{label}</Text>
    </Pressable>
  );

  const confirmDiscard = (item: StockItem) =>
    Alert.alert(`${item.name}を処分しますか？`, '備蓄から削除します。', [
      { text: 'やめる', style: 'cancel' },
      { text: '処分する', style: 'destructive', onPress: () => onDiscard(item) },
    ]);

  const empty =
    attention.replacement.lots.length === 0 && attention.short.length === 0 && attention.inspect.length === 0 && !bagDue;

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title="確認が必要なもの"
        onClose={onClose}
        footer={
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.footerButton}>
            <Text style={styles.footerButtonText}>閉じる</Text>
          </Pressable>
        }
      >
        {empty && <Text style={styles.empty}>いまのところ、ありません</Text>}

        {attention.replacement.lots.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              期限が近い・切れた
              {attention.replacement.total > 0 && (
                <Text style={styles.sectionSub}>　見込み {formatYen(attention.replacement.total)}</Text>
              )}
            </Text>
            {attention.replacement.lots.map(({ item, amount }) => (
              <View key={item.id} style={styles.card}>
                <Pressable accessibilityRole="button" onPress={() => onEditItem(item)} style={styles.cardTop}>
                  {bubble(item.name, item.category)}
                  <View style={styles.flex}>
                    <View style={styles.inline}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.storage === 'carry' && (
                        <View style={styles.tag}>
                          <Text style={styles.tagText}>{STORAGE_LABEL.carry}</Text>
                        </View>
                      )}
                    </View>
                    <View style={[styles.inline, styles.gapTop]}>
                      {item.expiresOn && (
                        <View style={[styles.chip, { backgroundColor: colors.dangerSurface }]}>
                          <Text style={[styles.chipText, { color: colors.alertText }]}>{expiryCountdown(item.expiresOn, today)}</Text>
                        </View>
                      )}
                      <Text style={styles.qty}>
                        {formatQuantity(item.quantity)}
                        {item.unit}
                      </Text>
                    </View>
                  </View>
                  {amount === null ? (
                    <Text style={styles.unpriced}>値段未登録</Text>
                  ) : (
                    <Text style={styles.amount}>{formatYen(amount)}</Text>
                  )}
                </Pressable>
                <View style={styles.actions}>
                  {button('買い替え', () => onRestock(item), PackageCheck, 'main')}
                  {button('使った', () => onUse(item), Utensils, 'sub')}
                  {button('処分', () => confirmDiscard(item), Trash2, 'sub')}
                </View>
              </View>
            ))}
          </View>
        )}

        {attention.short.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>足りないもの</Text>
            {attention.short.map(({ status, cost }) => {
              const { target, required, have, shortage, carry } = status;
              const ratio = required > 0 ? have / required : 1;
              return (
                <View key={target.id} style={[styles.card, styles.cardTop]}>
                  {bubble(target.name, target.category)}
                  <View style={styles.flex}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {target.name}
                    </Text>
                    <View style={styles.miniBar}>
                      <View style={[styles.miniFill, { width: `${Math.round(Math.min(1, ratio) * 100)}%` }]} />
                    </View>
                    <Text style={styles.shortText}>
                      {shortage > 0
                        ? `あと${formatQuantity(shortage)}${target.unit}`
                        : carry
                          ? `バッグにあと${formatQuantity(carry.shortage)}${target.unit}`
                          : ''}
                      {cost.shortageCost !== null && shortage > 0 ? `　${formatYen(cost.shortageCost)}` : ''}
                    </Text>
                  </View>
                  {shortage > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${target.name}の不足を買い出しリストへ`}
                      onPress={() => onSendShortage(target, shortage)}
                      style={styles.toList}
                    >
                      <ListPlus size={18} color={SOFT.buttonText} />
                      <Text style={styles.toListText}>リストへ</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {(attention.inspect.length > 0 || bagDue) && (
          <View style={styles.section}>
            <View style={styles.inline}>
              <Text style={[styles.sectionTitle, styles.flex]}>点検の時期</Text>
              {inspectable.length > 0 && (
                <Pressable accessibilityRole="button" onPress={() => onInspect(inspectable)} style={styles.bulk}>
                  <Wrench size={13} color={colors.textSubtle} />
                  <Text style={styles.bulkText}>まとめて点検した</Text>
                </Pressable>
              )}
            </View>
            {bagDue && (
              <View style={[styles.card, styles.cardTop]}>
                {bubble('バッグ', '')}
                <View style={styles.flex}>
                  <Text style={styles.cardName}>持ち出しバッグ</Text>
                  <Text style={styles.subText}>{bagAge}</Text>
                </View>
                {button('確かめる', onOpenBag, ClipboardCheck, 'main')}
              </View>
            )}
            {attention.inspect.map((item) => (
              <View key={item.id} style={[styles.card, styles.cardTop]}>
                <Pressable accessibilityRole="button" onPress={() => onEditItem(item)} style={[styles.inline, styles.flex, { gap: 12 }]}>
                  {bubble(item.name, item.category)}
                  <View style={styles.flex}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.subText}>
                      {item.inspectedOn ? `${spanText(daysBetween(item.inspectedOn, today))}前に点検` : '未点検'}
                    </Text>
                  </View>
                </Pressable>
                {button('点検した', () => onInspect([item]), Check, 'main')}
              </View>
            ))}
          </View>
        )}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gapTop: { marginTop: 4 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  sectionSub: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  cardName: { fontSize: 14, fontWeight: '700', color: colors.text, flexShrink: 1 },
  bubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SOFT.bg,
  },
  chip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  qty: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  amount: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  unpriced: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  subText: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginTop: 2 },
  tag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: colors.neutralSurface },
  tagText: { fontSize: 10, fontWeight: '700', color: colors.textSubtle },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  actionMain: { backgroundColor: SOFT.button },
  actionSub: { backgroundColor: colors.neutralSurface },
  actionText: { fontSize: 12, fontWeight: '700' },
  miniBar: { height: 6, borderRadius: 3, backgroundColor: colors.neutralSurface, overflow: 'hidden', marginTop: 6 },
  miniFill: { height: 6, borderRadius: 3, backgroundColor: TONE.alert },
  shortText: { fontSize: 11, fontWeight: '700', color: colors.alertText, marginTop: 4, fontVariant: ['tabular-nums'] },
  toList: { alignItems: 'center', gap: 2, borderRadius: 12, backgroundColor: SOFT.button, paddingHorizontal: 12, paddingVertical: 8 },
  toListText: { fontSize: 10, fontWeight: '700', color: SOFT.buttonText },
  bulk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    backgroundColor: colors.neutralSurface,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bulkText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  footerButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.neutralSurface },
  footerButtonText: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
});
