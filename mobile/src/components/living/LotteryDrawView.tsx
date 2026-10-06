import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { CircleQuestionMark, Sparkles } from 'lucide-react-native';
import type { SubsidyBallId } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  BALLS,
  MONTHLY_LIMIT,
  NOTE_TEXT,
  PRICE_MAX,
  PRICE_MIN,
  ballOf,
  type DrawPlan,
} from '@/lib/subsidyLotteryUtils';
import GaraponMachine from '@/components/living/GaraponMachine';
import LotteryBall, { BALL_COLOR } from '@/components/living/LotteryBall';
import LotteryHelpSheet from '@/components/living/LotteryHelpSheet';
import useReduceMotion from '@/components/living/useReduceMotion';

// 補助くじの「くじ」の面（docs/home.md §9）。PWA版の
// `src/components/sukusuku/living/LotteryDrawView.tsx` と同じ項目・並び・文言。
// ルール・今月の福引券・今回の救済・入力・補助率ごとの確率。
//
// 福引所らしく見せる: 上は紅白ののれん色の看板（ガラポンの絵・福引券）、ラッキーカラーの玉は光り、
// 「ガラポン！」は脈打つ大きなボタン、確率は賞品一覧（玉・賞の名前・補助率・確率の棒）にする。

/** 看板の地の色（左上→右下）。 */
const HERO_FROM = '#dc2626';
const HERO_TO = '#f97316';

/** 福引券1枚（左右に切り欠きのある券）。残っている券は金色、使った券は薄く。 */
function FukubikiTicket({ active }: { active: boolean }) {
  return (
    <View style={styles.ticket}>
      <Svg width={40} height={26} viewBox="0 0 40 26" style={StyleSheet.absoluteFill}>
        <Path
          d="M0,0 H40 V8 A5,5 0 0 0 40,18 V26 H0 V18 A5,5 0 0 0 0,8 Z"
          fill={active ? '#fde68a' : 'rgba(255,255,255,0.18)'}
          stroke={active ? '#b45309' : 'rgba(255,255,255,0.5)'}
          strokeWidth={1.5}
          strokeDasharray={active ? undefined : '3,2'}
        />
      </Svg>
      <Text style={[styles.ticketMark, !active && styles.ticketMarkUsed]}>福</Text>
    </View>
  );
}

/** ラッキーカラーの玉。まわりに光の輪が広がる。 */
function GlowingBall({ ball }: { ball: SubsidyBallId }) {
  const reduceMotion = useReduceMotion();
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, ring]);
  return (
    <View style={styles.glowingBall}>
      {!reduceMotion && (
        <Animated.View
          style={[
            styles.glowRing,
            {
              borderColor: BALL_COLOR[ball].edge,
              opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
            },
          ]}
        />
      )}
      <LotteryBall ball={ball} size={26} />
    </View>
  );
}

/** 押せるあいだ、ゆっくり脈打つ「ガラポン！」。 */
function SpinButton({ canDraw, onPress }: { canDraw: boolean; onPress: () => void }) {
  const reduceMotion = useReduceMotion();
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!canDraw || reduceMotion) {
      beat.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [canDraw, reduceMotion, beat]);
  return (
    <Animated.View style={{ transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canDraw }}
        disabled={!canDraw}
        onPress={onPress}
        style={({ pressed }) => [styles.spinButton, !canDraw && styles.spinButtonDisabled, pressed && styles.spinButtonPressed]}
      >
        <Sparkles size={20} color={canDraw ? '#fde68a' : colors.surface} />
        <Text style={styles.spinButtonText}>ガラポン！</Text>
        <Sparkles size={20} color={canDraw ? '#fde68a' : colors.surface} />
      </Pressable>
    </Animated.View>
  );
}


interface LotteryDrawViewProps {
  plan: DrawPlan;
  isLoading: boolean;
  /** 今月引ける回数（誕生月は3回）と、あと何回か。 */
  allowance: number;
  remaining: number;
  /** テストモード中か（回数が減らないので、枚数の表示を変える）。 */
  testMode: boolean;
  /** 使えるひと押し券の枚数と、使うか。 */
  pushCount: number;
  usePush: boolean;
  onUsePush: (value: boolean) => void;
  itemName: string;
  priceText: string;
  onItemName: (value: string) => void;
  onPriceText: (value: string) => void;
  error: string | null;
  canDraw: boolean;
  onSubmit: () => void;
}

export default function LotteryDrawView({
  plan,
  isLoading,
  allowance,
  remaining,
  testMode,
  pushCount,
  usePush,
  onUsePush,
  itemName,
  priceText,
  onItemName,
  onPriceText,
  error,
  canDraw,
  onSubmit,
}: LotteryDrawViewProps) {
  const lucky = ballOf(plan.luckyBall);
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="lotteryHero" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={HERO_FROM} />
              <Stop offset="1" stopColor={HERO_TO} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#lotteryHero)" />
          <Circle cx="88%" cy="18%" r={46} fill="#ffffff" opacity={0.08} />
          <Circle cx="8%" cy="92%" r={34} fill="#ffffff" opacity={0.08} />
          <Circle cx="60%" cy="105%" r={22} fill="#fde68a" opacity={0.18} />
        </Svg>
        <View style={styles.heroTitleRow}>
          <Text style={styles.heroTitle}>✦ ガラポン福引所 ✦</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="補助くじのルールを見る"
            onPress={() => setHelpOpen(true)}
            hitSlop={8}
            style={styles.helpButton}
          >
            <CircleQuestionMark size={22} color={colors.surface} />
          </Pressable>
        </View>
        <Text style={styles.rule}>
          趣味以外で必要なもの・税込{PRICE_MIN.toLocaleString('ja-JP')}〜{PRICE_MAX.toLocaleString('ja-JP')}円なら、
          月{MONTHLY_LIMIT}回（誕生月は{MONTHLY_LIMIT + 1}回）まで、家族のお金から補助が出ます
        </Text>
        <View style={styles.heroBody}>
          <GaraponMachine width={116} mode="idle" />
          <View style={styles.ticketBox}>
            <Text style={styles.ticketLabel}>今月の福引券</Text>
            <View style={styles.tickets}>
              {Array.from({ length: allowance }, (_, index) => (
                <FukubikiTicket key={index} active={index < remaining} />
              ))}
            </View>
            <Text style={styles.ticketCount}>
              {isLoading ? '…' : testMode ? 'テスト中（減りません）' : remaining > 0 ? `あと${remaining}回` : '使い切りました'}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, styles.luckyCard]}>
        <View style={styles.luckyRow}>
          <GlowingBall ball={plan.luckyBall} />
          <Text style={styles.luckyText}>
            今月のラッキーカラーは{lucky.ball}。出たら補助率が1段アップ
          </Text>
        </View>
        {plan.notes.map((note) => (
          <Text key={note} style={styles.note}>
            {NOTE_TEXT[note]}
          </Text>
        ))}
        {plan.floor > 25 && (
          <View style={styles.floorBadge}>
            <Sparkles size={16} color={colors.doneText} />
            <Text style={styles.floor}>
              今回は{plan.floor === 100 ? '100%が確定！' : `${plan.floor}%以上が確定！`}
            </Text>
          </View>
        )}
        {pushCount > 0 && (
          <View style={styles.pushRow}>
            <Text style={styles.pushText}>ひと押し券を使う（{pushCount}枚）</Text>
            <Switch value={usePush} onValueChange={onUsePush} disabled={remaining <= 0} />
          </View>
        )}
      </View>

      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={itemName}
          onChangeText={onItemName}
          placeholder="買うもの（例: 洗濯ネット）"
          placeholderTextColor={colors.textFaint}
          editable={remaining > 0}
        />
        <TextInput
          style={styles.input}
          value={priceText}
          onChangeText={onPriceText}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="税込の価格（円）"
          placeholderTextColor={colors.textFaint}
          editable={remaining > 0}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <SpinButton canDraw={canDraw} onPress={onSubmit} />
      </View>

      <View style={[styles.card, styles.prizeCard]}>
        <Text style={styles.prizeTitle}>賞品一覧</Text>
        {plan.odds.map((entry) => {
          const ball = BALLS.find((item) => item.rate === entry.rate) ?? BALLS[0];
          return (
            <View key={entry.rate} style={[styles.prizeRow, entry.percent === 0 && styles.prizeRowOff]}>
              <LotteryBall ball={ball.id} size={20} />
              <Text style={styles.prizeName} numberOfLines={1}>
                {ball.name}
              </Text>
              <Text style={styles.prizeRate}>{entry.rate}%</Text>
              <View style={styles.oddsTrack}>
                <View style={[styles.oddsFill, { width: `${entry.percent}%`, backgroundColor: BALL_COLOR[ball.id].edge }]} />
              </View>
              <Text style={styles.oddsText}>{entry.percent}%</Text>
            </View>
          );
        })}
        <Text style={styles.oddsNote}>棒と右の数字は今回の出る確率（救済を含む）</Text>
      </View>
      {helpOpen && <LotteryHelpSheet onClose={() => setHelpOpen(false)} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  hero: { borderRadius: 16, overflow: 'hidden', padding: 14, gap: 6 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroTitle: { fontSize: 19, fontWeight: '800', color: colors.surface, letterSpacing: 1 },
  helpButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  rule: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.92)' },
  heroBody: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  ticketBox: { flex: 1, gap: 6 },
  ticketLabel: { fontSize: 12, fontWeight: '700', color: '#fde68a' },
  tickets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ticket: { width: 40, height: 26, alignItems: 'center', justifyContent: 'center' },
  ticketMark: { fontSize: 13, fontWeight: '800', color: '#b45309' },
  ticketMarkUsed: { color: 'rgba(255,255,255,0.55)' },
  ticketCount: { fontSize: 18, fontWeight: '800', color: colors.surface, fontVariant: ['tabular-nums'] },
  card: {
    padding: 12,
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  luckyCard: { backgroundColor: colors.milkSurface, borderColor: colors.milkBorder },
  luckyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  glowingBall: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  glowRing: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 3 },
  luckyText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.milkText },
  note: { fontSize: 12, fontWeight: '500', color: colors.textSubtle },
  floorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
  },
  floor: { fontSize: 14, fontWeight: '700', color: colors.doneText },
  pushRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pushText: { fontSize: 13, fontWeight: '700', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    backgroundColor: colors.surface,
    fontVariant: ['tabular-nums'],
  },
  spinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    backgroundColor: HERO_FROM,
    borderWidth: 2,
    borderColor: '#fbbf24',
  },
  spinButtonDisabled: { backgroundColor: colors.borderStrong, borderColor: colors.borderStrong },
  spinButtonPressed: { opacity: 0.85 },
  spinButtonText: { fontSize: 19, fontWeight: '800', color: colors.primaryText, letterSpacing: 2 },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  prizeCard: { gap: 6 },
  prizeTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  prizeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prizeRowOff: { opacity: 0.4 },
  prizeName: { width: 84, fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  prizeRate: { width: 38, fontSize: 13, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  oddsTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.neutralSurface, overflow: 'hidden' },
  oddsFill: { height: '100%', borderRadius: 4 },
  oddsText: {
    width: 36,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  oddsNote: { fontSize: 10, fontWeight: '500', color: colors.textFaint },
});
