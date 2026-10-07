import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { buildYearSummary, formatSignedYen, formatYen, monthKeyOfDate } from '@/lib/moneyUtils';
import { formatFiscalYear } from '@/lib/specialUtils';
import SpecialPanel from '@/components/living/SpecialPanel';

// 家計タブの「年」（docs/kakei.md §4.2）。PWA版の `src/components/sukusuku/money/MoneyYearView.tsx` と同じ並び・文言。
//
// 上に年度の収支（収入 − 生活費 − 貯金。特別費は入れない）と、月ごとの表（押すとその月の「月」へ）。
// その下に特別費の予定と実績（SpecialPanel）。年度の送りは固定で、下はまとめてスクロールする。

interface MoneyYearViewProps {
  fiscalYear: number;
  onFiscalYear: (fiscalYear: number) => void;
  familyId: string | null;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  onSelectMonth: (monthKey: string) => void;
  onRecordsChanged: () => void;
}

export default function MoneyYearView({
  fiscalYear,
  onFiscalYear,
  familyId,
  records,
  categories,
  budgets,
  wallets,
  onSelectMonth,
  onRecordsChanged,
}: MoneyYearViewProps) {
  const today = monthKeyOfDate(new Date());
  const summary = useMemo(
    () => buildYearSummary(records, categories, budgets, wallets, fiscalYear, today),
    [records, categories, budgets, wallets, fiscalYear, today],
  );
  const { total } = summary;

  return (
    <View style={styles.flex}>
      <View style={styles.yearBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="前の年度"
          onPress={() => onFiscalYear(fiscalYear - 1)}
          hitSlop={8}
          style={styles.yearButton}
        >
          <ChevronLeft size={18} color={colors.textSubtle} />
        </Pressable>
        <Text style={styles.yearLabel}>{formatFiscalYear(fiscalYear)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="次の年度"
          onPress={() => onFiscalYear(fiscalYear + 1)}
          hitSlop={8}
          style={styles.yearButton}
        >
          <ChevronRight size={18} color={colors.textSubtle} />
        </Pressable>
        <View style={styles.flex} />
        <Text style={styles.yearRange}>
          {fiscalYear}年4月〜{fiscalYear + 1}年3月
        </Text>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <View style={styles.summary}>
            <View style={styles.summaryHead}>
              <Text style={styles.summaryLabel}>年の収支（収入 − 生活費 − 貯金）</Text>
              <Text style={[styles.balance, total.balance < 0 && styles.over]}>{formatSignedYen(total.balance)}</Text>
            </View>
            <View style={styles.line}>
              <Text style={styles.lineLabel}>収入</Text>
              <Text style={styles.lineValue}>{formatYen(total.income)}</Text>
            </View>
            <View style={styles.line}>
              <Text style={styles.lineLabel}>
                生活費<Text style={[styles.lineNote, total.livingDiff < 0 && styles.over]}>
                  {'　'}予算との差 {formatSignedYen(total.livingDiff)}
                </Text>
              </Text>
              <Text style={styles.lineValue}>−{formatYen(total.living)}</Text>
            </View>
            <View style={styles.line}>
              <Text style={styles.lineLabel}>貯金</Text>
              <Text style={styles.lineValue}>−{formatYen(total.saving)}</Text>
            </View>
            <Text style={styles.note}>特別費は年の収支に入れず、下で予定と実績を見ます</Text>
          </View>

          <View style={styles.table}>
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.cellMonth, styles.headText]}>月</Text>
              <Text style={[styles.cell, styles.headText]}>収入</Text>
              <Text style={[styles.cell, styles.headText]}>生活費</Text>
              <Text style={[styles.cell, styles.headText]}>貯金</Text>
              <Text style={[styles.cell, styles.headText]}>収支</Text>
            </View>
            {summary.months.map((row) => {
              const future = row.monthKey > today;
              return (
                <Pressable
                  key={row.monthKey}
                  accessibilityRole="button"
                  accessibilityLabel={`${Number(row.monthKey.slice(5, 7))}月の月の収支を見る`}
                  onPress={() => onSelectMonth(row.monthKey)}
                  style={styles.row}
                >
                  <Text style={styles.cellMonth}>{Number(row.monthKey.slice(5, 7))}月</Text>
                  {future ? (
                    <Text style={[styles.cell, styles.faint]}>−</Text>
                  ) : (
                    <>
                      <Text style={styles.cell}>{formatYen(row.income)}</Text>
                      <Text style={[styles.cell, row.livingDiff < 0 && styles.over]}>{formatYen(row.living)}</Text>
                      <Text style={styles.cell}>{formatYen(row.saving)}</Text>
                      <Text style={[styles.cell, styles.strong, row.balance < 0 && styles.over]}>
                        {formatSignedYen(row.balance)}
                      </Text>
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.note}>生活費が赤い月は、生活費の予算を超えた月。月を押すとその月の内訳へ</Text>
        </View>

        <SpecialPanel
          familyId={familyId}
          fiscalYear={fiscalYear}
          onFiscalYear={onFiscalYear}
          onRecordsChanged={onRecordsChanged}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  yearBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  yearButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  yearLabel: { fontSize: 17, fontWeight: '700', color: colors.text },
  yearRange: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingBottom: 96 },
  section: { paddingHorizontal: 16, paddingBottom: 18, gap: 10 },
  summary: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 6,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summaryLabel: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.textMuted },
  balance: { fontSize: 26, fontWeight: '700', color: colors.text },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  lineLabel: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textSubtle },
  lineNote: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  lineValue: { fontSize: 13, fontWeight: '600', color: colors.text },
  note: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  table: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  headRow: { borderTopWidth: 0, backgroundColor: colors.background },
  headText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  cellMonth: { width: 36, fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  cell: { flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '500', color: colors.textSubtle },
  strong: { fontWeight: '700', color: colors.text },
  faint: { color: colors.textFaint },
  over: { color: colors.moneyOver },
});
