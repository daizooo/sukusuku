import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { CircleQuestionMark, Ticket } from 'lucide-react-native';
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
import LotteryBall from '@/components/living/LotteryBall';
import LotteryHelpSheet from '@/components/living/LotteryHelpSheet';

// 補助くじの「くじ」の面（docs/home.md §9）。PWA版の
// `src/components/sukusuku/living/LotteryDrawView.tsx` と同じ項目・並び・文言。
// ルール・今月の福引券・今回の救済・入力・補助率ごとの確率。

interface LotteryDrawViewProps {
  plan: DrawPlan;
  isLoading: boolean;
  /** 今月引ける回数（誕生月は3回）と、あと何回か。 */
  allowance: number;
  remaining: number;
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
      <View style={styles.card}>
        <View style={styles.ruleRow}>
          <Text style={[styles.rule, styles.flex]}>
            趣味以外で必要なもの・税込{PRICE_MIN.toLocaleString('ja-JP')}〜{PRICE_MAX.toLocaleString('ja-JP')}円なら、
            月{MONTHLY_LIMIT}回（誕生月は{MONTHLY_LIMIT + 1}回）まで、家族のお金から補助が出ます
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="補助くじのルールを見る"
            onPress={() => setHelpOpen(true)}
            hitSlop={8}
            style={styles.helpButton}
          >
            <CircleQuestionMark size={22} color={colors.navActive} />
          </Pressable>
        </View>
        <View style={styles.ticketRow}>
          <Text style={styles.ticketLabel}>今月の福引券</Text>
          <View style={styles.tickets}>
            {Array.from({ length: allowance }, (_, index) => (
              <Ticket
                key={index}
                size={22}
                color={index < remaining ? colors.milkMark : colors.borderStrong}
                fill={index < remaining ? colors.milkBadge : 'transparent'}
              />
            ))}
          </View>
          <Text style={styles.ticketCount}>
            {isLoading ? '…' : remaining > 0 ? `あと${remaining}回` : '使い切りました'}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.luckyRow}>
          <LotteryBall ball={plan.luckyBall} size={18} />
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
          <Text style={styles.floor}>
            今回は{plan.floor === 100 ? '100%が確定！' : `${plan.floor}%以上が確定！`}
          </Text>
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
        <View style={styles.priceRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={priceText}
            onChangeText={onPriceText}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="税込の価格（円）"
            placeholderTextColor={colors.textFaint}
            editable={remaining > 0}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canDraw }}
            disabled={!canDraw}
            onPress={onSubmit}
            style={[styles.spinButton, !canDraw && styles.spinButtonDisabled]}
          >
            <Text style={styles.spinButtonText}>ガラポン！</Text>
          </Pressable>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.odds}>
          {plan.odds.map((entry) => {
            const ball = BALLS.find((item) => item.rate === entry.rate) ?? BALLS[0];
            return (
              <View key={entry.rate} style={styles.oddsItem}>
                <LotteryBall ball={ball.id} size={14} />
                <Text style={styles.oddsText}>
                  {entry.rate}% {entry.percent}%
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.oddsNote}>左が補助率、右が今回の出る確率（救済を含む）</Text>
      </View>
      {helpOpen && <LotteryHelpSheet onClose={() => setHelpOpen(false)} />}
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
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rule: { fontSize: 12, fontWeight: '500', color: colors.textSubtle },
  helpButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  tickets: { flexDirection: 'row', gap: 4 },
  ticketCount: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  luckyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  luckyText: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.milkText },
  note: { fontSize: 12, fontWeight: '500', color: colors.textSubtle },
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
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spinButton: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.navActive },
  spinButtonDisabled: { backgroundColor: colors.borderStrong },
  spinButtonText: { fontSize: 14, fontWeight: '700', color: colors.primaryText },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  odds: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  oddsItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  oddsText: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  oddsNote: { fontSize: 10, fontWeight: '500', color: colors.textFaint },
});
