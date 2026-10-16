import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { formatBalance, type YearMonthRow } from '@/lib/moneyUtils';
import { type } from '@/components/money/moneyVisual';

// 年の月ごとの収支の推移（docs/kakei.md §0.4）。PWA版の `src/components/sukusuku/money/YearFlowChart.tsx` と同じ並び・文言。
// 2026-10-16に作り直した（棒と折れ線を重ねた縦のグラフは見にくかったため）: 月を1行ずつ縦に並べ、
// 中央の線（0）から、増えた月は右へ緑、減った月は左へ濃い灰の棒を伸ばし、右に収支の額を大きく出す。行を押すと、その月の実績（月の振り返り）へ飛ぶ。
// 数える月だけを出す（記録の無い月・使い始める前の月は出さない）。年末の着地見込み（§4.6）を出すときは、
// 締めていない月（forecast）を見込みとして、棒を枠だけの点線にして「見込み」と添える。

const BAR_HEIGHT = 22;

export type YearFlowMonth = Pick<YearMonthRow, 'monthKey' | 'recorded' | 'balance' | 'cumulative'> & {
  /** 見込みの月（点線）。 */
  forecast?: boolean;
};

export default function YearFlowChart({
  months,
  onSelectMonth,
}: {
  months: YearFlowMonth[];
  onSelectMonth: (monthKey: string) => void;
}) {
  const rows = useMemo(() => months.filter((month) => month.recorded), [months]);
  const scale = useMemo(() => {
    const negative = Math.max(0, ...rows.map((month) => -month.balance));
    const positive = Math.max(0, ...rows.map((month) => month.balance));
    const total = Math.max(negative + positive, 1);
    return { total, axis: negative / total };
  }, [rows]);

  return (
    <View style={styles.wrap}>
      {rows.map((month, index) => {
        const number = Number(month.monthKey.slice(5, 7));
        const gain = month.balance >= 0;
        const fill = gain ? colors.moneyIncome : colors.textSubtle;
        const length = Math.abs(month.balance) / scale.total;
        const left = gain ? scale.axis : scale.axis - length;
        return (
          <Pressable
            key={month.monthKey}
            accessibilityRole="button"
            accessibilityLabel={`${number}月の実績を見る`}
            onPress={() => onSelectMonth(month.monthKey)}
            style={({ pressed }) => [styles.row, index > 0 && styles.divided, pressed && styles.pressed]}
          >
            <Text style={styles.month}>{number}月</Text>
            <View style={styles.plot}>
              <View style={[styles.axis, { left: `${scale.axis * 100}%` }]} />
              <View
                style={[
                  styles.bar,
                  { left: `${left * 100}%`, width: `${Math.max(length * 100, 0.8)}%` },
                  month.forecast ? { borderColor: fill, borderWidth: 1.5, borderStyle: 'dashed' } : { backgroundColor: fill },
                ]}
              />
            </View>
            <View style={styles.valueBox}>
              <Text style={[styles.value, month.balance > 0 && styles.plus]}>{formatBalance(month.balance)}</Text>
              {month.forecast && <Text style={type.faint}>見込み</Text>}
            </View>
            <ChevronRight size={16} color={colors.textFaint} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  // 数字を出す Text は fontWeight を必ず付ける（CLAUDE.md）。
  month: { width: 34, fontSize: 14, fontWeight: '700', color: colors.text },
  plot: { flex: 1, height: BAR_HEIGHT, justifyContent: 'center' },
  axis: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.borderStrong },
  bar: { position: 'absolute', top: 2, bottom: 2, borderRadius: 3 },
  valueBox: { width: 92, alignItems: 'flex-end' },
  value: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  plus: { color: colors.moneyIncome },
});
