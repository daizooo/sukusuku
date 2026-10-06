import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LotteryCoupon } from '@/types/app';
import { colors } from '@/lib/theme';
import { COUPON_INFO, collectionProgress, daysLeft, isCouponUsable, isLotteryCoupon } from '@/lib/subsidyLotteryUtils';
import LotteryCollectionBoard from '@/components/living/LotteryCollectionBoard';

// お買いもの福引の「券」と「金賞コレクション」（ホームのボタンは「金コレ」）の枠（docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryCouponsView.tsx` と同じ項目・並び・文言。
// - 券: 自分の使える券（アカウントごと）。持っているときだけホームにボタンが出る
// - 金賞コレクション: 金賞の箱から出た特典の台紙（LotteryCollectionBoard）と、使った券・期限切れの券。
//   そろえたごほうびは書かない（出たときのお楽しみ）

interface LotteryCouponsViewProps {
  /** どちらを出すか（券＝使える券、金賞コレクション＝台紙と使った・期限切れの券）。 */
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
      {section === 'collection' && <LotteryCollectionBoard cycle={progress.cycle} collected={progress.collected} />}

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
