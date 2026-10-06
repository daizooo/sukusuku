import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gift } from 'lucide-react-native';
import type { LotteryCoupon, SubsidyBallId, SubsidyDraw } from '@/types/app';
import { colors } from '@/lib/theme';
import { COUPON_INFO, ballOf, collectionProgress } from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import { BALL_COLOR } from '@/components/living/LotteryBall';
import LotteryCelebration, { LotteryComplete, PopIn } from '@/components/living/LotteryCelebration';
import LotteryDialog from '@/components/living/LotteryDialog';

// 補助くじの結果（docs/home.md §9.5）。PWA版の `src/components/sukusuku/living/LotteryResultModal.tsx` と
// 同じ流れ・同じ文言。結果はこの枠を出す前にDBへ記録してある（見てから引き直せない）。
//
// ガラポンはホームの面で回し、玉が受け皿に出てからこの枠を開く。ここでは出た玉が弾むように出て、
// 後ろで光の筋が回り、紙吹雪が舞う。並びは「賞・補助率 → いくら出るか → 買うもの」だけにまとめる。
// 25%か50%なら、補助率アップ券があれば「使う」で1段上げられる。
// 100%なら、3つの箱から1つ選んで開ける（中身は図鑑でまだ集めていない特典）。

/** 当たりの演出の高さ。 */
const STAGE_HEIGHT = 170;

const BOX_TONES = [colors.milkMark, colors.diaper, colors.pumping];

/** 補助率の札の文字の色（白玉・金玉は地が明るいので濃い色）。 */
const RATE_TEXT: Record<SubsidyBallId, string> = {
  white: colors.textSubtle,
  blue: colors.primaryText,
  red: colors.primaryText,
  gold: '#78350f',
};

const formatLimit = (iso: string | null) => {
  if (!iso) return '期限なし';
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日まで`;
};

/** 箱が「開けて」と言っているように、順番にぴょこぴょこ揺れる。 */
function WiggleBox({ index, still, children }: { index: number; still: boolean; children: ReactNode }) {
  const wiggle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) {
      wiggle.setValue(0);
      return;
    }
    const step = (toValue: number) =>
      Animated.timing(wiggle, { toValue, duration: 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const loop = Animated.loop(
      Animated.sequence([Animated.delay(index * 350), step(1), step(-1), step(1), step(0), Animated.delay(1400 - index * 350)]),
    );
    loop.start();
    return () => loop.stop();
  }, [index, still, wiggle]);
  return (
    <Animated.View
      style={{
        transform: [
          { rotate: wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }) },
          { translateY: wiggle.interpolate({ inputRange: [-1, 0, 1], outputRange: [-3, 0, -3] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

interface LotteryResultSheetProps {
  draw: SubsidyDraw;
  /** ラッキーカラーで1段上がったか。 */
  luckyUp: boolean;
  /** 25%でひと押し券を1枚もらったか。 */
  earnedPush: boolean;
  /** 使える補助率アップ券（なければ null）。 */
  rateUpCoupon: LotteryCoupon | null;
  /** 今までの券（金コレの進み具合を出すのに使う）。 */
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
  const [busy, setBusy] = useState(false);
  const [rateUpDone, setRateUpDone] = useState(false);
  const [opened, setOpened] = useState<LotteryCoupon[] | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const ball = ballOf(draw.ball);
  const tone = BALL_COLOR[draw.ball];
  const full = draw.rate === 100;
  const canRateUp = !rateUpDone && !draw.rateUpUsed && rateUpCoupon !== null && draw.rate <= 50;

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
  // 金コレが6つそろったら、下に出る演出まで送る。
  useEffect(() => {
    if (!trip) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
    return () => clearTimeout(timer);
  }, [trip]);

  const bonus = draw.rateUpUsed ? '補助率アップ券で1段アップ！' : luckyUp ? 'ラッキーカラーで1段アップ！' : null;

  return (
    <LotteryDialog
      onClose={onClose}
      footer={
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>とじる</Text>
        </Pressable>
      }
    >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
        <LotteryCelebration ball={draw.ball} rate={draw.rate} height={STAGE_HEIGHT} />

        <PopIn delay={150}>
          <Text style={[styles.prizeName, { color: tone.text }]}>
            {ball.ball}！ {ball.name}
          </Text>
        </PopIn>
        {/* 補助率アップ券で上がったら、札をもう一度弾ませる。 */}
        <PopIn key={draw.rate} delay={300}>
          <View style={[styles.ratePill, { backgroundColor: tone.fill, borderColor: tone.edge }]}>
            <Text style={[styles.rate, { color: RATE_TEXT[draw.ball] }]}>補助率 {draw.rate}%</Text>
          </View>
        </PopIn>
        {bonus && <Text style={styles.bonus}>{bonus}</Text>}

        <View style={styles.money}>
          {full ? (
            <Text style={styles.fullText}>全額、家族のお金で買えます</Text>
          ) : (
            <>
              <View style={styles.moneyRow}>
                <Text style={styles.moneyLabel}>家族のお金から</Text>
                <Text style={[styles.moneyValue, styles.family]}>{formatPrice(draw.subsidy)}</Text>
              </View>
              <View style={styles.moneyRow}>
                <Text style={styles.moneyLabel}>あなたのお小遣いから</Text>
                <Text style={styles.moneyValue}>{formatPrice(draw.price - draw.subsidy)}</Text>
              </View>
            </>
          )}
          <Text style={styles.item} numberOfLines={1}>
            {draw.itemName || '（名前なし）'}・税込 {formatPrice(draw.price)}
          </Text>
        </View>

        {earnedPush && <Text style={styles.note}>ひと押し券をもらいました（次回以降、使うと25%が出なくなります）</Text>}

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
                <WiggleBox key={index} index={index} still={busy}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`箱${index + 1}を開ける`}
                    onPress={openBox}
                    disabled={busy}
                    style={[styles.box, { borderColor: tint }]}
                  >
                    {busy ? <ActivityIndicator color={tint} /> : <Gift size={30} color={tint} />}
                  </Pressable>
                </WiggleBox>
              ))}
            </View>
          </View>
        )}

        {perk && (
          <PopIn style={styles.stretch}>
            <View style={styles.perk}>
              <Text style={styles.perkHead}>箱の中身</Text>
              <Text style={styles.perkName}>{COUPON_INFO[perk.kind].name}</Text>
              <Text style={styles.perkLimit}>{formatLimit(perk.expiresAt)}</Text>
              <Text style={styles.perkCount}>金コレ {trip ? 6 : progress.collected.length} / 6</Text>
            </View>
          </PopIn>
        )}
        {/* 6つそろったら、ごほうびの演出（見えるところまで送る）。 */}
        {trip && <LotteryComplete rewardName={COUPON_INFO.trip.name} />}
      </ScrollView>
    </LotteryDialog>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  prizeName: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  ratePill: { borderRadius: 999, borderWidth: 2, paddingHorizontal: 18, paddingVertical: 6 },
  rate: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bonus: { fontSize: 12, fontWeight: '700', color: colors.milkText, textAlign: 'center' },
  money: {
    alignSelf: 'stretch',
    gap: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.neutralSurface,
  },
  moneyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moneyLabel: { fontSize: 13, fontWeight: '500', color: colors.textSubtle },
  moneyValue: { fontSize: 17, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  family: { color: colors.navActiveText },
  fullText: { fontSize: 15, fontWeight: '700', color: colors.milkText, textAlign: 'center' },
  item: { fontSize: 11, fontWeight: '500', color: colors.textFaint, textAlign: 'center', fontVariant: ['tabular-nums'] },
  note: { fontSize: 11, fontWeight: '500', color: colors.textMuted, textAlign: 'center' },
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
  boxes: { alignSelf: 'stretch', alignItems: 'center', gap: 8 },
  boxTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  boxRow: { flexDirection: 'row', gap: 12 },
  box: {
    width: 76,
    height: 76,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stretch: { alignSelf: 'stretch' },
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
  close: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: '#dc2626' },
  closeText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
});
