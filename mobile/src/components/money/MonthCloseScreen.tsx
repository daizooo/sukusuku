import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord } from '@/types/app';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  buildMonthSummary,
  categoryPath,
  estimatesInMonth,
  formatBalance,
  formatShortDate,
  formatYen,
  itemSummary,
  recordTotal,
} from '@/lib/moneyUtils';
import { Hero, PrimaryButton, ScreenHeader, SectionHeader, StatRow, type } from '@/components/money/moneyVisual';

// 月の締め（振り返りの確定。docs/kakei.md §4.5）。PWA版の `src/components/sukusuku/money/MonthCloseScreen.tsx` と同じ並び・文言。
//
// その月の収支を、見込みの額も含めてすべて出し、「この月を締める」で確定する。片づいていないものが残っていても締められる。
// 見込みのままの記録はその場で「確定」でき（今の額のまま）、未確認の明細は件数を出して一覧を開ける。
// 年初からの累計は出さない（その月の締めなので）。

interface MonthCloseScreenProps {
  monthKey: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  /** その月の日付の、未確認の明細の件数。 */
  feedCount: number;
  closed: boolean;
  /** 締めた日時（締めた月だけ）。 */
  closedAt: string | null;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  onOpenFeed: () => void;
  onCloseMonth: () => void;
  onReopenMonth: () => void;
  onClose: () => void;
}

/** 見込みの記録の見出し。お店、無ければ品名、無ければ種類。 */
function recordTitle(record: MoneyRecord, categories: MoneyCategory[]): string {
  if (record.store.trim() !== '') return record.store;
  const names = itemSummary(record.items);
  if (names !== '') return names;
  return categoryPath(categories, record.items[0]?.categoryId ?? null) || (record.kind === 'income' ? '収入' : '支出');
}

const closedDateLabel = (closedAt: string) => {
  const date = new Date(closedAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

export default function MonthCloseScreen({
  monthKey,
  records,
  categories,
  budgets,
  feedCount,
  closed,
  closedAt,
  onConfirmEstimate,
  onOpenRecord,
  onOpenFeed,
  onCloseMonth,
  onReopenMonth,
  onClose,
}: MonthCloseScreenProps) {
  const insets = useSafeAreaInsets();
  const month = useMemo(() => buildMonthSummary(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  const estimates = useMemo(() => estimatesInMonth(records, monthKey), [records, monthKey]);
  // 確定を押した記録（読み直しが届くまで、二度押せないように）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const label = `${Number(monthKey.slice(5, 7))}月`;

  const confirm = async (record: MoneyRecord) => {
    setConfirming(record.id);
    try {
      await onConfirmEstimate(record);
    } finally {
      setConfirming(null);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title={`${label}の締め`} icon="back" onClose={onClose} />
        <ScrollView contentContainerStyle={styles.content}>
          <Hero compact label={`収支（${label}）`} value={formatBalance(month.balance)} plus={month.balance > 0} note="収入 − 支出（見込みの額も含む）">
            <StatRow compact label="収入" value={formatYen(month.income)} plus={month.income > 0} />
            <StatRow compact label="支出" value={`−${formatYen(month.living)}`} />
          </Hero>

          <SectionHeader compact title="見込みのままの記録" hint={`${estimates.length}件`} />
          {estimates.length === 0 ? (
            <Text style={styles.message}>見込みのままの記録はありません</Text>
          ) : (
            <View style={styles.card}>
              {estimates.map((record, index) => (
                <View key={record.id} style={[styles.row, index > 0 && styles.rowDivided]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${recordTitle(record, categories)}の記録を開く`}
                    onPress={() => onOpenRecord(record)}
                    style={styles.rowMain}
                  >
                    <Text style={styles.date}>{formatShortDate(record.occurredOn)}</Text>
                    <Text style={[styles.rowName, styles.flex]} numberOfLines={1}>
                      {recordTitle(record, categories)}
                    </Text>
                    <Text style={[styles.amount, record.kind === 'income' && styles.plus]}>{formatYen(recordTotal(record))}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${recordTitle(record, categories)}をこの額で確定する`}
                    disabled={confirming !== null}
                    onPress={() => void confirm(record)}
                    hitSlop={6}
                    style={[styles.confirm, confirming === record.id && styles.confirmBusy]}
                  >
                    <Text style={styles.confirmText}>確定</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {estimates.length > 0 && (
            <Text style={type.faint}>額が違うものは、押して記録の詳細で直してください。「確定」は今の額のまま確定します</Text>
          )}

          <SectionHeader compact title="未確認の明細" hint={`${feedCount}件`} />
          {feedCount === 0 ? (
            <Text style={styles.message}>未確認の明細はありません</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={onOpenFeed}
              style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}
            >
              <Text style={[styles.rowName, styles.flex]}>未確認の明細 {feedCount}件を片づける</Text>
              <ChevronRight size={16} color={colors.textFaint} />
            </Pressable>
          )}
        </ScrollView>
        <View style={styles.footer}>
          {closed ? (
            <>
              <Text style={styles.closedNote}>{closedAt ? `${closedDateLabel(closedAt)}に締めました` : '締めた月です'}</Text>
              <Pressable accessibilityRole="button" onPress={onReopenMonth} style={styles.secondary}>
                <Text style={styles.reopenText}>締めを外す</Text>
              </Pressable>
            </>
          ) : (
            <>
              <PrimaryButton label="この月を締める" onPress={onCloseMonth} />
              <Text style={styles.footerNote}>見込みのままの記録や未確認の明細が残っていても締められます</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 4 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  date: { width: 44, fontSize: 13, fontWeight: '600', color: colors.textMuted },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.text },
  amount: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  plus: { color: colors.moneyIncome },
  confirm: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.moneySoft },
  confirmBusy: { opacity: 0.5 },
  confirmText: { fontSize: 13, fontWeight: '700', color: colors.moneyText },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  footerNote: { fontSize: 12, fontWeight: '500', color: colors.textFaint, textAlign: 'center' },
  closedNote: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  reopenText: { fontSize: 13, fontWeight: '700', color: colors.danger },
});
