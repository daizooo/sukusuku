import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { buildYearSummary, formatSignedYen, formatYen, monthKeyOfDate } from '@/lib/moneyUtils';
import { Hero, SectionHeader, StatRow, YearBar, type } from '@/components/money/moneyVisual';

// 家計タブの「年」（docs/kakei.md §4.2）。PWA版の `src/components/sukusuku/money/MoneyYearView.tsx` と同じ並び・文言。
//
// 結論は年度の収支（収入 − 生活費 − 貯金。特別費は入れず「特別費」の面で見る）。内訳に収入・生活費・貯金。
// その下に月ごとの収支（新しい月から。まだ来ていない月は出さない）。月を押すとその月の「月」へ。

interface MoneyYearViewProps {
  fiscalYear: number;
  onFiscalYear: (fiscalYear: number) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  onSelectMonth: (monthKey: string) => void;
}

export default function MoneyYearView({
  fiscalYear,
  onFiscalYear,
  records,
  categories,
  budgets,
  wallets,
  onSelectMonth,
}: MoneyYearViewProps) {
  const today = monthKeyOfDate(new Date());
  const summary = useMemo(
    () => buildYearSummary(records, categories, budgets, wallets, fiscalYear, today),
    [records, categories, budgets, wallets, fiscalYear, today],
  );
  const { total } = summary;
  const months = summary.months.filter((row) => row.monthKey <= today).reverse();

  return (
    <View style={styles.flex}>
      <YearBar fiscalYear={fiscalYear} onChange={onFiscalYear} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Hero
          label="年の収支"
          value={formatSignedYen(total.balance)}
          minus={total.balance < 0}
          note={`記録のある${summary.recordedMonths}か月ぶん・特別費は入れない`}
        >
          <StatRow label="収入" value={`+${formatYen(total.income)}`} />
          <StatRow
            label="生活費"
            note={total.livingDiff < 0 ? `予算より ${formatYen(total.livingDiff)} 多い` : `予算より ${formatYen(total.livingDiff)} 少ない`}
            noteMinus={total.livingDiff < 0}
            value={`−${formatYen(total.living)}`}
          />
          <StatRow label="貯金" value={`−${formatYen(total.saving)}`} />
        </Hero>

        <SectionHeader title="月ごと" hint="押すとその月へ" />
        {months.length === 0 ? (
          <Text style={styles.message}>この年度はまだ始まっていません</Text>
        ) : (
          <View style={styles.card}>
            {months.map((row, index) => {
              const month = Number(row.monthKey.slice(5, 7));
              return (
                <Pressable
                  key={row.monthKey}
                  accessibilityRole="button"
                  accessibilityLabel={`${month}月の月の収支を見る`}
                  onPress={() => onSelectMonth(row.monthKey)}
                  style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                >
                  <Text style={styles.month}>{month}月</Text>
                  {row.recorded ? (
                    <>
                      <View style={styles.flex}>
                        <Text style={type.faint}>収入 {formatYen(row.income)}</Text>
                        <Text style={[type.faint, row.livingDiff < 0 && type.minus]}>
                          生活費 {formatYen(row.living)}
                          {row.livingDiff < 0 ? '（予算超え）' : ''}
                        </Text>
                      </View>
                      <Text style={[type.amount, row.balance < 0 && type.minus]}>{formatSignedYen(row.balance)}</Text>
                    </>
                  ) : (
                    <Text style={[type.faint, styles.flex]}>記録なし</Text>
                  )}
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  month: { width: 40, fontSize: 15, fontWeight: '700', color: colors.text },
});
