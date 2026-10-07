import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pencil } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import {
  daysBetween,
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  nextInspectionOn,
  spanText,
  storageShares,
  type StockProduct,
  type StockStorage,
  type StorageShare,
} from '@/lib/stockUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { SOFT } from './stockVisual';

// 品目1つの詳しい画面（docs/home.md §10.2.2）。PWA版の
// `src/components/sukusuku/living/StockProductDetail.tsx` と同じ項目・文言。
// 上に全体の数と、その中の寝室・持ち出し用の内訳（帯と1行ずつ。足りない場所は赤）。
// 下にロットを保管場所ごとに並べる。ロットを押すと編集（持ち出し用へ分ける・寝室へ戻すも、そこで行う）。
// 期限の無い備品のロットは、期限の代わりに点検した日・次の点検を出す。

interface StockProductDetailProps {
  product: StockProduct<StockItem, StockTarget>;
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

const PLACES: { storage: StockStorage; label: string; fill: string; text: string }[] = [
  { storage: 'home', label: '寝室', fill: colors.border, text: colors.textSubtle },
  { storage: 'carry', label: '持ち出し用', fill: SOFT.button, text: SOFT.buttonText },
];

/** 帯の片側が細くなりすぎないように、最小の幅（%）。 */
const MIN_ZONE = 18;
/** 塗った部分がこれより細い（%）ときは、帯の中に数を出さない（下の行に出ている）。 */
const LABEL_MIN = 8;

const dateText = (on: string) => formatExpiry({ expiresOn: on, expiresMonthOnly: false });

export default function StockProductDetail({
  product,
  today,
  onClose,
  onEditTarget,
  onEditItem,
}: StockProductDetailProps) {
  const status = product.target?.status ?? null;
  const unit = product.unit;
  const shares = storageShares(product, today);
  const q = (value: number) => `${formatQuantity(value)}${unit}`;

  // 帯: 寝室・持ち出し用を、それぞれ要る量（無ければ持っている量）の幅で並べる。
  const weight = (share: StorageShare) => Math.max(share.required ?? 0, share.have);
  const zones = PLACES.filter(({ storage }) => weight(shares[storage]) > 0);
  const weightSum = zones.reduce((sum, { storage }) => sum + weight(shares[storage]), 0);
  const zoneWidth = (storage: StockStorage) => {
    if (zones.length < 2) return 100;
    const raw = (weight(shares[storage]) / weightSum) * 100;
    return Math.min(100 - MIN_ZONE, Math.max(MIN_ZONE, raw));
  };

  const shareNote = (storage: StockStorage) => {
    const share = shares[storage];
    if (share.required === null) return null;
    if (share.shortage > 0) return { text: `あと ${q(share.shortage)}`, alert: true };
    const other = shares[storage === 'home' ? 'carry' : 'home'];
    if (share.surplus > 0 && other.shortage > 0) return { text: `${q(share.surplus)}多い（分けられます）`, alert: false };
    return share.required > 0 ? { text: '揃っています', alert: false } : null;
  };

  // ロットの1行。期限の無い備品は、期限の代わりに点検した日・次の点検。
  const lotRow = (item: StockItem, index: number) => {
    const level = expiryLevel(item.expiresOn, today);
    const next = nextInspectionOn(item);
    const due = next !== null && next <= today;
    const main = item.expiresOn
      ? `${formatExpiry(item)} まで`
      : next !== null
        ? item.inspectedOn
          ? `${dateText(item.inspectedOn)} に点検`
          : 'まだ点検していません'
        : '期限なし';
    const sub = item.expiresOn
      ? { text: expiryCountdown(item.expiresOn, today), color: LEVEL_COLOR[level] }
      : next !== null
        ? due
          ? { text: '点検の時期です', color: colors.alertText }
          : { text: `次は ${dateText(next)} ごろ・あと${spanText(daysBetween(today, next))}`, color: colors.textMuted }
        : null;
    // 同じ品目にまとめた、品名の違うロット（500mlと2Lなど）は品名を添える。
    const extra = item.name !== product.name ? item.name : '';
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}を編集`}
        onPress={() => onEditItem(item)}
        style={[styles.lot, index > 0 && styles.divided]}
      >
        <View style={styles.flex}>
          <Text style={styles.lotMain}>{main}</Text>
          {sub && <Text style={[styles.lotSub, { color: sub.color }]}>{sub.text}</Text>}
          {extra !== '' && <Text style={styles.lotExtra}>{extra}</Text>}
        </View>
        <Text style={styles.quantity}>
          {formatQuantity(item.quantity)}
          {item.unit}
        </Text>
        <Pencil size={13} color={colors.textFaint} />
      </Pressable>
    );
  };

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
        <View style={styles.total}>
          <View style={styles.totalLine}>
            <Text style={styles.totalLabel}>全体</Text>
            <Text style={styles.big}>
              {formatQuantity(product.total)}
              <Text style={styles.bigUnit}> {unit}</Text>
            </Text>
            <Text style={[styles.need, status && status.shortage > 0 && styles.alertText]}>
              {status
                ? `必要 ${formatQuantity(status.required)}${status.shortage > 0 ? `・あと ${formatQuantity(status.shortage)}` : ''}`
                : '必要数なし'}
            </Text>
          </View>

          {zones.length > 0 && (
            <View style={styles.bar}>
              {zones.map(({ storage, fill, text }) => {
                const share = shares[storage];
                const ratio = share.required ? Math.min(1, share.have / share.required) : 1;
                return (
                  <View key={storage} style={[styles.zone, { width: `${zoneWidth(storage)}%` }]}>
                    {share.have > 0 && (
                      <View style={[styles.zoneFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: fill }]}>
                        {zoneWidth(storage) * ratio >= LABEL_MIN && (
                          <Text style={[styles.zoneText, { color: text }]} numberOfLines={1}>
                            {formatQuantity(share.have)}
                          </Text>
                        )}
                      </View>
                    )}
                    {ratio < 1 && <View style={styles.zoneShort} />}
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.legend}>
            {PLACES.map(({ storage, label, fill }) => {
              const share = shares[storage];
              const note = shareNote(storage);
              return (
                <View key={storage} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: fill }]} />
                  <Text style={styles.legendLabel}>{label}</Text>
                  <Text style={styles.legendValue}>{formatQuantity(share.have)}</Text>
                  <Text style={styles.legendUnit}>
                    {share.required ? ` / ${formatQuantity(share.required)}${unit}` : ` ${unit}`}
                  </Text>
                  {note && <Text style={[styles.legendNote, note.alert && styles.alertText]}>{note.text}</Text>}
                </View>
              );
            })}
          </View>
        </View>


        {product.lots.length === 0 ? (
          <Text style={styles.empty}>まだありません</Text>
        ) : (
          PLACES.map(({ storage, label }) => {
            const lots = product.lots.filter((item) => item.storage === storage);
            if (lots.length === 0) return null;
            return (
              <View key={storage} style={styles.place}>
                <View style={styles.placeHeader}>
                  <Text style={styles.placeName}>{label}</Text>
                  <Text style={styles.placeCount}>
                    {formatQuantity(shares[storage].have)}
                    {unit}
                  </Text>
                </View>
                <View style={styles.card}>{lots.map(lotRow)}</View>
              </View>
            );
          })
        )}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  alertText: { color: colors.alertText },
  total: { borderRadius: 14, backgroundColor: colors.neutralSurface, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  totalLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  totalLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  big: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  bigUnit: { fontSize: 13, fontWeight: '700', color: colors.textFaint },
  need: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', gap: 3, height: 22 },
  zone: { flexDirection: 'row', height: 22, borderRadius: 7, overflow: 'hidden', backgroundColor: colors.surface },
  zoneFill: { height: 22, justifyContent: 'center', paddingLeft: 7 },
  zoneText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  zoneShort: { flex: 1, height: 22, backgroundColor: colors.alertSurface },
  legend: { gap: 3 },
  legendRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  legendDot: { width: 9, height: 9, borderRadius: 3, alignSelf: 'center' },
  legendLabel: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, marginLeft: 2 },
  legendValue: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], marginLeft: 4 },
  legendUnit: { fontSize: 11, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  legendNote: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  place: { gap: 4 },
  placeHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 2 },
  placeName: { fontSize: 13, fontWeight: '700', color: colors.text },
  placeCount: { fontSize: 11, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  card: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface },
  lot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
  divided: { borderTopWidth: 1, borderTopColor: colors.neutralSurface },
  lotMain: { fontSize: 13, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  lotSub: { fontSize: 11, fontWeight: '700', marginTop: 1, fontVariant: ['tabular-nums'] },
  lotExtra: { fontSize: 10, fontWeight: '500', color: colors.textFaint, marginTop: 1, fontVariant: ['tabular-nums'] },
  quantity: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  footerButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.neutralSurface },
  footerButtonText: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
});
