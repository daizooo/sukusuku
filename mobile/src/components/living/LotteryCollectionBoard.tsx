import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  Coffee,
  Gift,
  IceCreamCone,
  Lock,
  Popcorn,
  Sandwich,
  Sparkles,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from 'lucide-react-native';
import type { LotteryCouponKind } from '@/types/app';
import { COLLECTION_SLOTS, COUPON_INFO, collectionTeaser, treasureWhisper } from '@/lib/subsidyLotteryUtils';

// お買いもの福引の「金賞コレクション」の台紙（docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryCollectionBoard.tsx` と同じ項目・並び・文言・動き。
//
// 金色の帯（何周目・いくつ集めたか・6つの目盛り）→ 6枚のメダル → 宝箱。
// - 集めたメダルは金色で、きらりと光る。押すと特典の説明が出る。まだのメダルは鍵がかかっていて、押すと震える
// - 宝箱は、集めた数が多いほど大きく・速く揺れる。押すと一言（中身＝ごほうびは言わない）

const GOLD = '#fbbf24';
const GOLD_LIGHT = '#fde68a';
const GOLD_DARK = '#78350f';

const KIND_ICON: Partial<Record<LotteryCouponKind, LucideIcon>> = {
  snack: IceCreamCone,
  movie: Popcorn,
  cafe: Coffee,
  picnic: Sandwich,
  rate_up: TrendingUp,
};

/** 繰り返し、ゆっくり光る（index ごとにずらす）。 */
function Twinkle({ index }: { index: number }) {
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 400),
        Animated.timing(glow, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(2400 - index * 400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow, index]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.twinkle,
        { opacity: glow, transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] }) }] },
      ]}
    >
      <Sparkles size={16} color="#ffffff" fill={GOLD_LIGHT} />
    </Animated.View>
  );
}

/** 押されたら左右に震える（鍵のかかったメダル・宝箱）。shake を増やすと震える。 */
function Shake({ shake, children }: { shake: number; children: ReactNode }) {
  const move = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (shake === 0) return;
    const step = (toValue: number) =>
      Animated.timing(move, { toValue, duration: 60, easing: Easing.linear, useNativeDriver: true });
    Animated.sequence([step(1), step(-1), step(1), step(-1), step(0)]).start();
  }, [shake, move]);
  return (
    <Animated.View style={{ transform: [{ translateX: move.interpolate({ inputRange: [-1, 1], outputRange: [-5, 5] }) }] }}>
      {children}
    </Animated.View>
  );
}

/** 宝箱。集めた数（0〜5）が多いほど、大きく・せわしなく揺れる。 */
function TreasureBox({ collected }: { collected: number }) {
  const wiggle = useRef(new Animated.Value(0)).current;
  const angle = 3 + collected * 2;
  const pause = Math.max(500, 2400 - collected * 380);
  useEffect(() => {
    const step = (toValue: number) =>
      Animated.timing(wiggle, { toValue, duration: 80, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([step(1), step(-1), step(1), step(-1), step(0), Animated.delay(pause)]));
    loop.start();
    return () => loop.stop();
  }, [wiggle, pause]);
  return (
    <Animated.View
      style={[
        styles.treasureBox,
        {
          transform: [
            { rotate: wiggle.interpolate({ inputRange: [-1, 1], outputRange: [`-${angle}deg`, `${angle}deg`] }) },
            { translateY: wiggle.interpolate({ inputRange: [-1, 0, 1], outputRange: [-2, 0, -2] }) },
          ],
        },
      ]}
    >
      <Gift size={40} color={GOLD} />
      <Text style={styles.treasureMark}>？</Text>
    </Animated.View>
  );
}

interface LotteryCollectionBoardProps {
  /** 何周目か。 */
  cycle: number;
  /** 今の周で集めた枠（1〜6）。 */
  collected: number[];
}

export default function LotteryCollectionBoard({ cycle, collected }: LotteryCollectionBoardProps) {
  /** 押したメダルの枠（説明を出す）。 */
  const [selected, setSelected] = useState<number | null>(null);
  /** 鍵のかかったメダルを押した回数（枠ごと。震わせるのに使う）。 */
  const [locked, setLocked] = useState<Record<number, number>>({});
  const [taps, setTaps] = useState(0);
  const count = collected.length;
  const selectedEntry = COLLECTION_SLOTS.find((entry) => entry.slot === selected) ?? null;

  const pressSlot = (slot: number, got: boolean) => {
    if (got) {
      setSelected((prev) => (prev === slot ? null : slot));
      return;
    }
    setSelected(null);
    setLocked((prev) => ({ ...prev, [slot]: (prev[slot] ?? 0) + 1 }));
  };

  return (
    <View style={styles.board}>
      <View style={styles.banner}>
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="collectionBanner" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#f59e0b" />
              <Stop offset="1" stopColor={GOLD_LIGHT} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#collectionBanner)" />
        </Svg>
        <View style={styles.bannerTop}>
          <View style={styles.cycleChip}>
            <Trophy size={14} color={GOLD_DARK} />
            <Text style={styles.cycleText}>{cycle}周目</Text>
          </View>
          {cycle > 1 && <Text style={styles.completedText}>コンプリート {cycle - 1}回</Text>}
        </View>
        <View style={styles.countRow}>
          <Text style={styles.countValue}>{count}</Text>
          <Text style={styles.countTotal}> / 6</Text>
        </View>
        <View style={styles.meter}>
          {COLLECTION_SLOTS.map((entry) => (
            <View key={entry.slot} style={[styles.meterCell, collected.includes(entry.slot) && styles.meterCellOn]} />
          ))}
        </View>
      </View>

      <View style={styles.grid}>
        {COLLECTION_SLOTS.map((entry, index) => {
          const got = collected.includes(entry.slot);
          const Icon = KIND_ICON[entry.kind] ?? Gift;
          return (
            <Pressable
              key={entry.slot}
              accessibilityRole="button"
              accessibilityLabel={got ? COUPON_INFO[entry.kind].name : `${entry.slot}番（まだ）`}
              onPress={() => pressSlot(entry.slot, got)}
              style={[styles.slot, selected === entry.slot && styles.slotSelected]}
            >
              <Shake shake={locked[entry.slot] ?? 0}>
                <View style={[styles.medal, got ? styles.medalGot : styles.medalLocked]}>
                  {got ? <Icon size={24} color={GOLD_DARK} /> : <Lock size={20} color="#9ca3af" />}
                  {got && <Twinkle index={index} />}
                </View>
              </Shake>
              <Text style={styles.slotNumber}>No.{entry.slot}</Text>
              <Text style={[styles.slotName, got && styles.slotNameGot]} numberOfLines={2}>
                {got ? COUPON_INFO[entry.kind].name : '？？？'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {selectedEntry && (
        <Text style={styles.detail}>{COUPON_INFO[selectedEntry.kind].description}</Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="宝箱"
        onPress={() => setTaps((prev) => prev + 1)}
        style={styles.treasure}
      >
        <Shake shake={taps}>
          <TreasureBox collected={count} />
        </Shake>
        <Text style={styles.teaser}>{collectionTeaser(count)}</Text>
        {taps > 0 && <Text style={styles.whisper}>{treasureWhisper(taps - 1)}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { gap: 10 },
  banner: { borderRadius: 16, overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  bannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cycleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  cycleText: { fontSize: 12, fontWeight: '800', color: GOLD_DARK, fontVariant: ['tabular-nums'] },
  completedText: { fontSize: 11, fontWeight: '800', color: GOLD_DARK, fontVariant: ['tabular-nums'] },
  countRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  countValue: { fontSize: 36, fontWeight: '800', color: GOLD_DARK, fontVariant: ['tabular-nums'] },
  countTotal: { fontSize: 18, fontWeight: '800', color: GOLD_DARK, fontVariant: ['tabular-nums'] },
  meter: { flexDirection: 'row', gap: 4 },
  meterCell: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(120,53,15,0.18)' },
  meterCellOn: { backgroundColor: GOLD_DARK },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, justifyContent: 'space-between' },
  slot: {
    width: '32%',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 14,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fef3c7',
  },
  slotSelected: { borderColor: GOLD, borderWidth: 2 },
  medal: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  medalGot: { backgroundColor: GOLD, borderColor: GOLD_LIGHT },
  medalLocked: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb', borderStyle: 'dashed' },
  twinkle: { position: 'absolute', top: -4, right: -4 },
  slotNumber: { fontSize: 10, fontWeight: '800', color: '#b45309', fontVariant: ['tabular-nums'] },
  slotName: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textAlign: 'center' },
  slotNameGot: { color: GOLD_DARK },
  detail: {
    fontSize: 12,
    fontWeight: '500',
    color: GOLD_DARK,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#fffbeb',
  },
  treasure: { alignItems: 'center', gap: 6, paddingVertical: 16, borderRadius: 16, backgroundColor: '#991b1b' },
  treasureBox: {
    width: 76,
    height: 76,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7f1d1d',
    borderWidth: 2,
    borderColor: GOLD,
  },
  treasureMark: { position: 'absolute', top: 2, right: 8, fontSize: 16, fontWeight: '800', color: GOLD_LIGHT },
  teaser: { fontSize: 14, fontWeight: '800', color: GOLD_LIGHT, textAlign: 'center', fontVariant: ['tabular-nums'] },
  whisper: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
});
