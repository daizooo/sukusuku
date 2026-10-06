import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SubsidyDraw } from '@/types/app';
import { colors } from '@/lib/theme';
import { prizeOf } from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import LotteryBall, { PRIZE_COLOR } from '@/components/living/LotteryBall';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 補助くじの結果（docs/home.md §9）。PWA版の `src/components/sukusuku/living/LotteryResultModal.tsx` と
// 同じ流れ・同じ文言。結果はこの枠を出す前にDBへ記録してある（見てから引き直せない）。
//
// 「ガラガラガラ…」と玉が揺れてから、出た玉が弾むように出る。

/** 玉が揺れている時間（ミリ秒）。 */
const SPIN_MS = 1400;

interface LotteryResultSheetProps {
  draw: SubsidyDraw;
  onClose: () => void;
}

export default function LotteryResultSheet({ draw, onClose }: LotteryResultSheetProps) {
  const [revealed, setRevealed] = useState(false);
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

  const prize = prizeOf(draw.prize);
  const tone = PRIZE_COLOR[draw.prize];
  const rotate = shake.interpolate({ inputRange: [-1, 1], outputRange: ['-14deg', '14deg'] });
  const own = draw.price - draw.subsidy;

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
              <LotteryBall prize={draw.prize} size={120} />
            </Animated.View>
          ) : (
            <Animated.View style={{ transform: [{ rotate }] }}>
              <LotteryBall prize={null} size={120} />
            </Animated.View>
          )}
        </View>

        {revealed ? (
          <View style={styles.result}>
            <Text style={[styles.prizeName, { color: tone.text }]}>
              {prize.ball}！ {prize.name}
            </Text>
            <Text style={styles.message}>{prize.message}</Text>
            <View style={styles.breakdown}>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>家族のお金から</Text>
                <Text style={[styles.breakdownValue, draw.subsidy > 0 && styles.family]}>
                  {formatPrice(draw.subsidy)}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>あなたのお小遣いから</Text>
                <Text style={styles.breakdownValue}>{formatPrice(own)}</Text>
              </View>
            </View>
            {prize.amount !== null && prize.amount > draw.price && (
              <Text style={styles.note}>商品代が{formatPrice(prize.amount)}より安いので、全額になりました</Text>
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
  note: { fontSize: 11, fontWeight: '500', color: colors.textFaint, textAlign: 'center' },
  close: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.navActive },
  closeText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
});
