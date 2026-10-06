import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Check, CircleQuestionMark, Gift, History, Ticket, type LucideIcon } from 'lucide-react-native';
import type { SubsidyBallId } from '@/types/app';
import { ballOf, type DrawPlan } from '@/lib/subsidyLotteryUtils';
import GaraponMachine from '@/components/living/GaraponMachine';
import LotteryBall from '@/components/living/LotteryBall';

// 補助くじのホーム（docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryDrawView.tsx` と同じ項目・並び・文言。
//
// 福引所の1枚の面にまとめる: 福引券・ガラポン・今月のラッキーカラーなど・買うものと税込価格・「ガラポン！」。
// 賞品一覧・券・履歴・ヘルプは下のボタンから、画面の中央の枠で開く。
// 「ガラポン！」を押すと、この面のガラポンが回り、受け皿に玉が出てから結果の枠が開く。

export type LotteryDialogKind = 'prizes' | 'coupons' | 'history' | 'help';

/** 面の地の色（左上→右下）。 */
const HERO_FROM = '#dc2626';
const HERO_TO = '#f97316';
const GOLD = '#fbbf24';
const GOLD_LIGHT = '#fde68a';

const MENU: { id: LotteryDialogKind; label: string; icon: LucideIcon }[] = [
  { id: 'prizes', label: '賞品一覧', icon: Gift },
  { id: 'coupons', label: '券', icon: Ticket },
  { id: 'history', label: '履歴', icon: History },
  { id: 'help', label: 'ヘルプ', icon: CircleQuestionMark },
];

/** 福引券1枚（左右に切り欠きのある券）。残っている券は金色、使った券は薄く。 */
function FukubikiTicket({ active }: { active: boolean }) {
  return (
    <View style={styles.ticket}>
      <Svg width={40} height={26} viewBox="0 0 40 26" style={StyleSheet.absoluteFill}>
        <Path
          d="M0,0 H40 V8 A5,5 0 0 0 40,18 V26 H0 V18 A5,5 0 0 0 0,8 Z"
          fill={active ? GOLD_LIGHT : 'rgba(255,255,255,0.18)'}
          stroke={active ? '#b45309' : 'rgba(255,255,255,0.5)'}
          strokeWidth={1.5}
          strokeDasharray={active ? undefined : '3,2'}
        />
      </Svg>
      <Text style={[styles.ticketMark, !active && styles.ticketMarkUsed]}>福</Text>
    </View>
  );
}

/** 押せるあいだ、ゆっくり脈打つ「ガラポン！」。回しているあいだは「ガラガラガラ…」。 */
function SpinButton({ canDraw, spinning, onPress }: { canDraw: boolean; spinning: boolean; onPress: () => void }) {
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!canDraw) {
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
  }, [canDraw, beat]);
  return (
    <Animated.View style={{ transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canDraw }}
        disabled={!canDraw}
        onPress={onPress}
        style={({ pressed }) => [
          styles.spinButton,
          !canDraw && !spinning && styles.spinButtonDisabled,
          pressed && styles.spinButtonPressed,
        ]}
      >
        <Text style={[styles.spinButtonText, !canDraw && !spinning && styles.spinButtonTextDisabled]}>
          {spinning ? 'ガラガラガラ…' : 'ガラポン！'}
        </Text>
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
  /** ガラポンを回しているか。 */
  spinning: boolean;
  /** 受け皿に出た玉（回し終わる直前だけ）。 */
  dropBall: SubsidyBallId | null;
  onOpen: (dialog: LotteryDialogKind) => void;
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
  spinning,
  dropBall,
  onOpen,
}: LotteryDrawViewProps) {
  const lucky = ballOf(plan.luckyBall);
  const editable = remaining > 0 && !spinning;
  return (
    <View style={styles.surface}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="lotteryHome" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={HERO_FROM} />
            <Stop offset="1" stopColor={HERO_TO} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#lotteryHome)" />
        <Circle cx="92%" cy="8%" r={70} fill="#ffffff" opacity={0.08} />
        <Circle cx="4%" cy="46%" r={48} fill="#ffffff" opacity={0.07} />
        <Circle cx="80%" cy="62%" r={30} fill={GOLD_LIGHT} opacity={0.14} />
      </Svg>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.ticketRow}>
          <View style={styles.tickets}>
            {Array.from({ length: allowance }, (_, index) => (
              <FukubikiTicket key={index} active={index < remaining} />
            ))}
          </View>
          <Text style={styles.ticketCount}>
            {isLoading ? '…' : testMode ? 'テスト中' : remaining > 0 ? `あと${remaining}回` : '使い切りました'}
          </Text>
        </View>

        <View style={styles.machine}>
          <GaraponMachine width={180} mode={spinning ? 'spin' : 'idle'} ball={dropBall} />
        </View>

        <View style={styles.chips}>
          <View style={styles.chip}>
            <LotteryBall ball={plan.luckyBall} size={14} />
            <Text style={styles.chipText}>ラッキーカラー {lucky.ball}</Text>
          </View>
          {plan.floor > 25 && (
            <View style={[styles.chip, styles.chipGold]}>
              <Text style={[styles.chipText, styles.chipTextGold]}>
                {plan.floor === 100 ? '100%確定！' : `${plan.floor}%以上確定！`}
              </Text>
            </View>
          )}
          {pushCount > 0 && (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: usePush, disabled: !editable }}
              disabled={!editable}
              onPress={() => onUsePush(!usePush)}
              style={[styles.chip, usePush && styles.chipGold]}
            >
              {usePush && <Check size={14} color="#7f1d1d" />}
              <Text style={[styles.chipText, usePush && styles.chipTextGold]}>ひと押し券を使う（{pushCount}）</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={itemName}
            onChangeText={onItemName}
            placeholder="買うもの（例: 洗濯ネット）"
            placeholderTextColor="#9ca3af"
            editable={editable}
          />
          <TextInput
            style={styles.input}
            value={priceText}
            onChangeText={onPriceText}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="税込の価格（円）"
            placeholderTextColor="#9ca3af"
            editable={editable}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <SpinButton canDraw={canDraw} spinning={spinning} onPress={onSubmit} />
        </View>

        <View style={styles.menu}>
          {MENU.map((entry) => {
            const Icon = entry.icon;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={entry.label}
                disabled={spinning}
                onPress={() => onOpen(entry.id)}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              >
                <View style={styles.menuIcon}>
                  <Icon size={20} color="#ffffff" />
                </View>
                <Text style={styles.menuText}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, marginHorizontal: 16, marginBottom: 12, borderRadius: 20, overflow: 'hidden' },
  content: { flexGrow: 1, justifyContent: 'space-between', padding: 16, gap: 12 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tickets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ticket: { width: 40, height: 26, alignItems: 'center', justifyContent: 'center' },
  ticketMark: { fontSize: 13, fontWeight: '800', color: '#b45309' },
  ticketMarkUsed: { color: 'rgba(255,255,255,0.55)' },
  ticketCount: { fontSize: 18, fontWeight: '800', color: '#ffffff', fontVariant: ['tabular-nums'] },
  machine: { alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  chipGold: { backgroundColor: GOLD },
  chipText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  chipTextGold: { color: '#7f1d1d' },
  form: { gap: 8 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
    backgroundColor: 'rgba(255,255,255,0.96)',
    fontVariant: ['tabular-nums'],
  },
  error: { fontSize: 12, fontWeight: '700', color: GOLD_LIGHT, textAlign: 'center' },
  spinButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: GOLD,
    borderWidth: 2,
    borderColor: GOLD_LIGHT,
  },
  spinButtonDisabled: { backgroundColor: 'rgba(255,255,255,0.25)', borderColor: 'rgba(255,255,255,0.35)' },
  spinButtonPressed: { opacity: 0.85 },
  spinButtonText: { fontSize: 20, fontWeight: '800', color: '#7f1d1d', letterSpacing: 2 },
  spinButtonTextDisabled: { color: 'rgba(255,255,255,0.8)' },
  menu: { flexDirection: 'row', justifyContent: 'space-around' },
  menuItem: { alignItems: 'center', gap: 4, minWidth: 60 },
  menuItemPressed: { opacity: 0.7 },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  menuText: { fontSize: 11, fontWeight: '700', color: '#ffffff' },
});
