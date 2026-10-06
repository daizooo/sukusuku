import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gift } from 'lucide-react-native';
import type { LotteryCoupon, SubsidyDraw } from '@/types/app';
import { colors } from '@/lib/theme';
import { COUPON_INFO, ballOf, collectionProgress } from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import LotteryBall, { BALL_COLOR } from '@/components/living/LotteryBall';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 補助くじの結果（docs/home.md §9）。PWA版の `src/components/sukusuku/living/LotteryResultModal.tsx` と
// 同じ流れ・同じ文言。結果はこの枠を出す前にDBへ記録してある（見てから引き直せない）。
//
// 「ガラガラガラ…」と玉が揺れてから、出た玉が弾むように出る。
// 25%か50%なら、補助率アップ券があれば「使う」で1段上げられる。
// 100%なら、3つの箱から1つ選んで開ける（中身は図鑑でまだ集めていない特典）。

/** 玉が揺れている時間（ミリ秒）。 */
const SPIN_MS = 1400;

const BOX_TONES = [colors.milkMark, colors.diaper, colors.pumping];

const formatLimit = (iso: string | null) => {
  if (!iso) return '期限なし';
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日まで`;
};

interface LotteryResultSheetProps {
  draw: SubsidyDraw;
  /** ラッキーカラーで1段上がったか。 */
  luckyUp: boolean;
  /** 25%でひと押し券を1枚もらったか。 */
  earnedPush: boolean;
  /** 使える補助率アップ券（なければ null）。 */
  rateUpCoupon: LotteryCoupon | null;
  /** 今までの券（図鑑の進み具合を出すのに使う）。 */
  coupons: LotteryCoupon[];
  onRateUp: (draw: SubsidyDraw, coupon: LotteryCoupon) => Promise<SubsidyDraw>;
  onOpenBox: (draw: SubsidyDraw) => Promise<LotteryCoupon[]>;
  onClose: () => void;
}

export default function LotteryResultSheet({
  draw: initialDraw,
  luckyUp,
  earnedPush,
  rateUpCoupon,
  coupons,
  onRateUp,
  onOpenBox,
  onClose,
}: LotteryResultSheetProps) {
  const [draw, setDraw] = useState(initialDraw);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rateUpDone, setRateUpDone] = useState(false);
  const [opened, setOpened] = useState<LotteryCoupon[] | null>(null);
  const shake = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 90, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 180, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 90, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    loop.start();
    const timer = setTimeout(() => {
      loop.stop();
      shake.setValue(0);
      setRevealed(true);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
    }, SPIN_MS);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [shake, pop]);

  const ball = ballOf(draw.ball);
  const tone = BALL_COLOR[draw.ball];
  const rotate = shake.interpolate({ inputRange: [-1, 1], outputRange: ['-14deg', '14deg'] });
  const full = draw.rate === 100;
  const canRateUp = revealed && !rateUpDone && !draw.rateUpUsed && rateUpCoupon !== null && draw.rate <= 50;

  const rateUp = () => {
    if (!rateUpCoupon || busy) return;
    Alert.alert('補助率アップ券を使いますか？', `${draw.rate}%の結果が1段上がります。`, [
      { text: 'やめる', style: 'cancel' },
      {
        text: '使う',
        onPress: () => {
          setBusy(true);
          onRateUp(draw, rateUpCoupon)
            .then((updated) => {
              setDraw(updated);
              setRateUpDone(true);
            })
            .catch(() => Alert.alert('使えませんでした', 'もう一度お試しください。'))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  const openBox = () => {
    if (busy) return;
    setBusy(true);
    onOpenBox(draw)
      .then((created) => setOpened(created))
      .catch(() => Alert.alert('箱を開けられませんでした', 'もう一度お試しください。'))
      .finally(() => setBusy(false));
  };

  const perk = opened?.find((coupon) => coupon.slot !== null) ?? null;
  const trip = opened?.find((coupon) => coupon.kind === 'trip') ?? null;
  const progress = collectionProgress([...(opened ?? []), ...coupons.filter((coupon) => !opened?.some((o) => o.id === coupon.id))]);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title="補助くじの結果"
        onClose={onClose}
        footer={
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>{revealed ? 'とじる' : 'スキップ'}</Text>
          </Pressable>
        }
      >
        <View style={styles.item}>
          <Text style={styles.itemName} numberOfLines={2}>
            {draw.itemName || '（名前なし）'}
          </Text>
          <Text style={styles.itemPrice}>税込 {formatPrice(draw.price)}</Text>
        </View>

        <View style={styles.stage}>
          {revealed ? (
            <Animated.View style={{ transform: [{ scale: pop }] }}>
              <LotteryBall ball={draw.ball} size={120} />
            </Animated.View>
          ) : (
            <Animated.View style={{ transform: [{ rotate }] }}>
              <LotteryBall ball={null} size={120} />
            </Animated.View>
          )}
        </View>

        {revealed ? (
          <View style={styles.result}>
            <Text style={[styles.prizeName, { color: tone.text }]}>
              {ball.ball}！ {ball.name}
            </Text>
            <Text style={styles.rate}>補助率 {draw.rate}%</Text>
            {luckyUp && !draw.rateUpUsed && (
              <Text style={styles.lucky}>
                ラッキーカラー！ {ball.ball}が1段アップ（{ball.rate}% → {draw.rate}%）
              </Text>
            )}
            {draw.rateUpUsed && <Text style={styles.lucky}>補助率アップ券を使いました</Text>}
            <Text style={styles.message}>{ball.message}</Text>
            <View style={styles.breakdown}>
              {full ? (
                <Text style={styles.fullText}>全額、家族のお金で買えます</Text>
              ) : (
                <>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>家族のお金から</Text>
                    <Text style={[styles.breakdownValue, styles.family]}>{formatPrice(draw.subsidy)}</Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>あなたのお小遣いから</Text>
                    <Text style={styles.breakdownValue}>{formatPrice(draw.price - draw.subsidy)}</Text>
                  </View>
                </>
              )}
            </View>
            {earnedPush && <Text style={styles.note}>ひと押し券を1枚もらいました（次のガラポンで25%が出なくなります）</Text>}

            {canRateUp && (
              <Pressable accessibilityRole="button" onPress={rateUp} disabled={busy} style={styles.rateUp}>
                <Text style={styles.rateUpText}>補助率アップ券を使う（{draw.rate}% → {draw.rate + 25}%）</Text>
              </Pressable>
            )}

            {full && opened === null && (
              <View style={styles.boxes}>
                <Text style={styles.boxTitle}>福の神の箱を1つ選んでください</Text>
                <View style={styles.boxRow}>
                  {BOX_TONES.map((tint, index) => (
                    <Pressable
                      key={index}
                      accessibilityRole="button"
                      accessibilityLabel={`箱${index + 1}を開ける`}
                      onPress={openBox}
                      disabled={busy}
                      style={[styles.box, { borderColor: tint }]}
                    >
                      {busy ? <ActivityIndicator color={tint} /> : <Gift size={30} color={tint} />}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {perk && (
              <View style={styles.perk}>
                <Text style={styles.perkHead}>箱の中身</Text>
                <Text style={styles.perkName}>{COUPON_INFO[perk.kind].name}</Text>
                <Text style={styles.perkLimit}>{formatLimit(perk.expiresAt)}</Text>
                <Text style={styles.perkCount}>図鑑 {trip ? 6 : progress.collected.length} / 6</Text>
                {trip && (
                  <Text style={styles.trip}>6つそろいました！ {COUPON_INFO.trip.name}をゲット（券の画面にあります）</Text>
                )}
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.spinning}>ガラガラガラ…</Text>
        )}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 2 },
  itemName: { fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'center' },
  itemPrice: { fontSize: 13, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  stage: { alignItems: 'center', justifyContent: 'center', height: 140 },
  spinning: { fontSize: 15, fontWeight: '700', color: colors.textMuted, textAlign: 'center', paddingBottom: 16 },
  result: { alignItems: 'center', gap: 8 },
  prizeName: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  rate: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  lucky: { fontSize: 12, fontWeight: '700', color: colors.milkText, textAlign: 'center' },
  message: { fontSize: 13, fontWeight: '500', color: colors.textSubtle, textAlign: 'center' },
  breakdown: {
    alignSelf: 'stretch',
    gap: 6,
    marginTop: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.neutralSurface,
  },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  breakdownLabel: { fontSize: 13, fontWeight: '500', color: colors.textSubtle },
  breakdownValue: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  family: { color: colors.navActiveText },
  fullText: { fontSize: 15, fontWeight: '700', color: colors.milkText, textAlign: 'center' },
  note: { fontSize: 11, fontWeight: '500', color: colors.textFaint, textAlign: 'center' },
  rateUp: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.milkSurface,
    borderWidth: 1,
    borderColor: colors.milkBorder,
  },
  rateUpText: { fontSize: 14, fontWeight: '700', color: colors.milkText },
  boxes: { alignSelf: 'stretch', alignItems: 'center', gap: 8, marginTop: 4 },
  boxTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  boxRow: { flexDirection: 'row', gap: 12 },
  box: {
    width: 84,
    height: 84,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  perk: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.milkSurface,
    borderWidth: 1,
    borderColor: colors.milkBorder,
  },
  perkHead: { fontSize: 11, fontWeight: '700', color: colors.milkText },
  perkName: { fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
  perkLimit: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  perkCount: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  trip: { fontSize: 13, fontWeight: '700', color: colors.doneText, textAlign: 'center' },
  close: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.navActive },
  closeText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
});
