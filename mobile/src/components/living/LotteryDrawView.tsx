import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { BookOpen, Check, ChevronRight, CircleQuestionMark, Gift, History, Ticket, type LucideIcon } from 'lucide-react-native';
import type { SubsidyBallId } from '@/types/app';
import { ballOf, type DrawPlan } from '@/lib/subsidyLotteryUtils';
import GaraponMachine from '@/components/living/GaraponMachine';
import LotteryBall from '@/components/living/LotteryBall';

// 福引チャンスのホーム（docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryDrawView.tsx` と同じ項目・並び・文言。
//
// 福引所の1枚の面にまとめる: 福引券（残り回数）・ガラポン・今月のラッキーカラーなど・買いたいものと金額・「ガラポン！」。
// 賞品一覧・金コレ（金賞コレクション）・履歴・ヘルプは下のボタンから、画面の中央の枠で開く。持っている券は、あるときだけ右上のボタンから開く。
// 「ガラポン！」を押すと、この面のガラポンが回り、受け皿に玉が出てから結果の枠が開く。
// 入力中はキーボードの高さ分だけ中身を縮め、入力欄（買いたいもの・金額）が見える位置までスクロールする。

export type LotteryDialogKind = 'prizes' | 'coupons' | 'collection' | 'history' | 'help';

/** 面の地の色（左上→右下）。 */
const HERO_FROM = '#dc2626';
const HERO_TO = '#f97316';
const GOLD = '#fbbf24';
const GOLD_LIGHT = '#fde68a';
/** キーボードが出たとき、フォームの上に残す余白。 */
const FORM_MARGIN = 12;

const MENU: { id: LotteryDialogKind; label: string; icon: LucideIcon }[] = [
  { id: 'prizes', label: '賞品一覧', icon: Gift },
  { id: 'collection', label: '金コレ', icon: BookOpen },
  { id: 'history', label: '履歴', icon: History },
  { id: 'help', label: 'ヘルプ', icon: CircleQuestionMark },
];

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
  /** 今月あと何回引けるか。 */
  remaining: number;
  /** テストモード中か（回数が減らないので、枚数の表示を変える）。 */
  testMode: boolean;
  /** 使えるひと押し券の枚数と、使うか。 */
  pushCount: number;
  usePush: boolean;
  /** 使える券の枚数（1枚以上のときだけ「持っている券」のボタンを出す）。 */
  couponCount: number;
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
  remaining,
  testMode,
  pushCount,
  usePush,
  onUsePush,
  couponCount,
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

  // 画面全体を使う作り（edge-to-edge）では、キーボードが出ても面は縮まず、入力欄が隠れる。
  // KeyboardAvoidingViewで中身を縮め、キーボードが出たら入力欄（フォーム）の位置までスクロールする。
  const scrollRef = useRef<ScrollView>(null);
  const formY = useRef(0);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      scrollRef.current?.scrollTo({ y: Math.max(0, formY.current - FORM_MARGIN), animated: true });
    });
    return () => sub.remove();
  }, []);

  return (
    <KeyboardAvoidingView style={styles.surface} behavior="padding">
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
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <View style={[styles.ticketBadge, remaining <= 0 && !isLoading && styles.ticketBadgeEmpty]}>
            <Ticket size={18} color={remaining > 0 || isLoading ? '#7f1d1d' : '#ffffff'} />
            <Text style={[styles.ticketText, remaining <= 0 && !isLoading && styles.ticketTextEmpty]}>
              {isLoading
                ? '福引券 …'
                : testMode
                  ? '福引券 テスト中'
                  : remaining > 0
                    ? `福引券 あと${remaining}回`
                    : '今月の福引券は使い切りました'}
            </Text>
          </View>
          {couponCount > 0 && (
            <Pressable
              accessibilityRole="button"
              disabled={spinning}
              onPress={() => onOpen('coupons')}
              style={({ pressed }) => [styles.couponButton, pressed && styles.menuItemPressed]}
            >
              <Text style={styles.couponText}>持っている券 {couponCount}</Text>
              <ChevronRight size={14} color="#ffffff" />
            </Pressable>
          )}
        </View>

        <View style={styles.machine}>
          <GaraponMachine width={180} mode={spinning ? 'spin' : 'idle'} ball={dropBall} />
        </View>

        <View style={styles.chips}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>今月のラッキーカラー</Text>
            <LotteryBall ball={plan.luckyBall} size={14} />
            <Text style={styles.chipText}>{lucky.ball}</Text>
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

        <View style={styles.form} onLayout={(event) => (formY.current = event.nativeEvent.layout.y)}>
          <TextInput
            style={styles.input}
            value={itemName}
            onChangeText={onItemName}
            placeholder="買いたいもの"
            placeholderTextColor="#9ca3af"
            editable={editable}
          />
          <TextInput
            style={styles.input}
            value={priceText}
            onChangeText={onPriceText}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="金額（例：2000）"
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, marginHorizontal: 16, marginBottom: 12, borderRadius: 20, overflow: 'hidden' },
  content: { flexGrow: 1, justifyContent: 'space-between', padding: 16, gap: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ticketBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: GOLD_LIGHT,
    borderWidth: 2,
    borderColor: GOLD,
  },
  ticketBadgeEmpty: { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.35)' },
  ticketText: { fontSize: 15, fontWeight: '800', color: '#7f1d1d', fontVariant: ['tabular-nums'] },
  ticketTextEmpty: { fontSize: 13, color: '#ffffff' },
  couponButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  couponText: { fontSize: 12, fontWeight: '700', color: '#ffffff', fontVariant: ['tabular-nums'] },
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
