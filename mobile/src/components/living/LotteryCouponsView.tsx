import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LotteryCoupon } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  COLLECTION_SLOTS,
  COUPON_INFO,
  collectionProgress,
  daysLeft,
  isCouponUsable,
  isLotteryCoupon,
} from '@/lib/subsidyLotteryUtils';

// 補助くじの「券」と「金コレ」（金賞コレクション）の枠（docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryCouponsView.tsx` と同じ項目・並び・文言。
// - 券: 自分の使える券（アカウントごと）。持っているときだけホームにボタンが出る
// - 金コレ: 金玉の箱から出た特典の6枠と、使った券・期限切れの券。そろえたごほうびは書かない（出たときのお楽しみ）

interface LotteryCouponsViewProps {
  /** どちらを出すか（券＝使える券、金コレ＝6枠と使った・期限切れの券）。 */
  section: 'coupons' | 'collection';
  coupons: LotteryCoupon[];
  isLoading: boolean;
  now: Date;
  /** 「使った」にする（ひと押し券・補助率アップ券以外）。 */
  onUse: (coupon: LotteryCoupon) => void;
}

const limitText = (coupon: LotteryCoupon, now: Date) => {
  const days = daysLeft(coupon, now);
  if (days === null) return '期限なし';
  const date = new Date(coupon.expiresAt as string);
  return `${date.getMonth() + 1}/${date.getDate()}まで（あと${days}日）`;
};

export default function LotteryCouponsView({ section, coupons, isLoading, now, onUse }: LotteryCouponsViewProps) {
  const progress = collectionProgress(coupons);
  const usable = coupons.filter((coupon) => isCouponUsable(coupon, now));
  const past = coupons.filter((coupon) => !isCouponUsable(coupon, now)).slice(0, 10);

  const confirmUse = (coupon: LotteryCoupon) =>
    Alert.alert(`「${COUPON_INFO[coupon.kind].name}」を使いましたか？`, '使った券にします。元には戻せません。', [
      { text: 'やめる', style: 'cancel' },
      { text: '使った', onPress: () => onUse(coupon) },
    ]);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {section === 'collection' && (
        <View style={styles.card}>
          <View style={styles.head}>
            <Text style={[styles.sub, styles.flex]}>金玉の箱から出た特典を集めよう。6つそろうと…？</Text>
            <Text style={styles.count}>
              {progress.cycle}周目 {progress.collected.length} / 6
            </Text>
          </View>
          <View style={styles.grid}>
            {COLLECTION_SLOTS.map((entry) => {
              const got = progress.collected.includes(entry.slot);
              return (
                <View key={entry.slot} style={[styles.slot, got && styles.slotGot]}>
                  <Text style={[styles.slotNumber, got && styles.slotTextGot]}>{entry.slot}</Text>
                  <Text style={[styles.slotName, got && styles.slotTextGot]} numberOfLines={2}>
                    {got ? COUPON_INFO[entry.kind].name : '？'}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {section === 'coupons' && (isLoading ? (
        <Text style={styles.empty}>読み込み中...</Text>
      ) : usable.length === 0 ? (
        <Text style={styles.empty}>使える券はありません</Text>
      ) : (
        <View style={styles.list}>
          {usable.map((coupon, index) => (
            <View key={coupon.id} style={[styles.row, index > 0 && styles.rowDivided]}>
              <View style={styles.flex}>
                <Text style={styles.name}>{COUPON_INFO[coupon.kind].name}</Text>
                <Text style={styles.desc}>{COUPON_INFO[coupon.kind].description}</Text>
                <Text style={styles.limit}>{limitText(coupon, now)}</Text>
              </View>
              {isLotteryCoupon(coupon.kind) ? (
                <Text style={styles.hint}>くじで使う</Text>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => confirmUse(coupon)} style={styles.useButton}>
                  <Text style={styles.useButtonText}>使った</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ))}

      {section === 'collection' && past.length > 0 && (
        <>
          <Text style={styles.heading}>使用済み・期限切れ</Text>
          <View style={styles.list}>
            {past.map((coupon, index) => (
              <View key={coupon.id} style={[styles.row, index > 0 && styles.rowDivided]}>
                <Text style={[styles.name, styles.nameDone, styles.flex]}>{COUPON_INFO[coupon.kind].name}</Text>
                <Text style={styles.hint}>{coupon.usedAt ? '使用済み' : '期限切れ'}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  card: {
    padding: 12,
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  count: { fontSize: 13, fontWeight: '700', color: colors.milkText, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  slot: {
    width: '31.5%',
    minHeight: 64,
    padding: 8,
    gap: 2,
    borderRadius: 10,
    backgroundColor: colors.neutralSurface,
  },
  slotGot: { backgroundColor: colors.milkSurface, borderWidth: 1, borderColor: colors.milkBorder },
  slotNumber: { fontSize: 10, fontWeight: '700', color: colors.textFaint },
  slotName: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  slotTextGot: { color: colors.milkText },
  heading: { fontSize: 12, fontWeight: '700', color: colors.textMuted, paddingTop: 4, paddingHorizontal: 4 },
  empty: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  nameDone: { color: colors.textFaint },
  desc: { fontSize: 11, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
  limit: { fontSize: 11, fontWeight: '700', color: colors.milkText, marginTop: 2, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  useButton: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.navActive },
  useButtonText: { fontSize: 12, fontWeight: '700', color: colors.primaryText },
});
