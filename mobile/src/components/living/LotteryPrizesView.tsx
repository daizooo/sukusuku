import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { BALLS, NOTE_TEXT, upRate, type DrawPlan } from '@/lib/subsidyLotteryUtils';
import LotteryBall, { BALL_COLOR } from '@/components/living/LotteryBall';

// 福引チャンスの「賞品一覧」（ホームのボタンから中央の枠で開く。docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryPrizesView.tsx` と同じ項目・並び・文言。
// 玉の絵・賞の名前・補助率だけを出す（玉の色の名前は文字にしない。確率は出さない。％が確率に見えないよう「補助率」と添える）。今月のラッキーカラーの玉には印を付け、
// いま効いている救済があれば下に並べる。

export default function LotteryPrizesView({ plan }: { plan: DrawPlan }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {BALLS.map((ball) => {
        const lucky = ball.id === plan.luckyBall;
        return (
          <View key={ball.id} style={[styles.row, lucky && styles.rowLucky]}>
            <LotteryBall ball={ball.id} size={32} />
            <View style={styles.names}>
              <Text style={[styles.name, { color: BALL_COLOR[ball.id].text }]}>{ball.name}</Text>
              {lucky && <Text style={styles.lucky}>ラッキー！今月は補助率{upRate(ball.rate)}%</Text>}
            </View>
            <View style={styles.rateBox}>
              <Text style={styles.rateLabel}>補助率</Text>
              <Text style={styles.rate}>{ball.rate}%</Text>
            </View>
          </View>
        );
      })}
      {plan.notes.length > 0 && (
        <View style={styles.notes}>
          <Text style={styles.notesTitle}>今回のおまけ</Text>
          {plan.notes.map((note) => (
            <Text key={note} style={styles.note}>
              {NOTE_TEXT[note]}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.neutralSurface,
  },
  rowLucky: { backgroundColor: colors.milkSurface, borderWidth: 1, borderColor: colors.milkBorder },
  names: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '800' },
  lucky: { fontSize: 11, fontWeight: '700', color: colors.milkText },
  rateBox: { alignItems: 'flex-end' },
  rateLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  rate: { fontSize: 20, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  notes: { gap: 4, paddingTop: 8 },
  notesTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  note: { fontSize: 12, fontWeight: '500', color: colors.textSubtle },
});
