import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MoneyCategory, MoneyRecord, MoneyWallet, SpecialItem } from '@/types/app';
import { colors } from '@/lib/theme';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  categoryPath,
  formatYen,
  groupItems,
  groupRecordsByDay,
  recordTotal,
  recordsInMonth,
  topCategoryIdOf,
} from '@/lib/moneyUtils';
import { CategoryBadge, MonthBar } from '@/components/money/moneyVisual';

// 家計タブの「記録」（docs/kakei.md §2・§3）。PWA版の `src/components/sukusuku/money/MoneyRecordsView.tsx` と同じ並び・文言。
// その月の記録を日ごと（新しい日から）に並べる。1行＝1件の記録（種類・お店・出金元・合計）。押すと記録の詳細。
// 月の送りは固定で、スクロールするのは一覧だけ。

interface MoneyRecordsViewProps {
  monthKey: string;
  onMonth: (monthKey: string) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  specialItems: SpecialItem[];
  isLoading: boolean;
  onOpen: (record: MoneyRecord) => void;
}

const dayLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日（${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]}）`;
};

export default function MoneyRecordsView({
  monthKey,
  onMonth,
  records,
  categories,
  wallets,
  specialItems,
  isLoading,
  onOpen,
}: MoneyRecordsViewProps) {
  const inMonth = useMemo(() => recordsInMonth(records, monthKey), [records, monthKey]);
  const days = useMemo(() => groupRecordsByDay(inMonth), [inMonth]);
  const totals = useMemo(() => {
    let expense = 0;
    let income = 0;
    for (const record of inMonth) {
      if (record.kind === 'expense') expense += recordTotal(record);
      if (record.kind === 'income') income += recordTotal(record);
    }
    return { expense, income };
  }, [inMonth]);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';

  const describe = (record: MoneyRecord) => {
    if (record.kind === 'transfer') {
      return {
        badge: '振',
        title: `振替 ${walletName(record.walletId) || '?'} → ${walletName(record.toWalletId) || '?'}`,
        sub: '',
      };
    }
    const groups = groupItems(record.items);
    const first = groups[0];
    const top = first?.categoryId ? topCategoryIdOf(categories, first.categoryId) : null;
    const firstTitle = first?.categoryId
      ? categoryPath(categories, first.categoryId)
      : first?.specialItemId
        ? `${record.kind === 'income' ? '特別収入' : '特別費'} › ${specialItems.find((item) => item.id === first.specialItemId)?.name ?? ''}`
        : '';
    return {
      badge: top ? categories.find((category) => category.id === top)?.name ?? '' : '特',
      title: groups.length > 1 ? `${firstTitle} ほか${groups.length - 1}種類` : firstTitle,
      sub: [record.store, walletName(record.walletId)].filter((text) => text !== '').join('・'),
    };
  };

  return (
    <View style={styles.flex}>
      <MonthBar
        monthKey={monthKey}
        onChange={onMonth}
        right={
          <Text style={styles.monthTotals}>
            支出 {formatYen(totals.expense)}
            {totals.income > 0 ? `　収入 ${formatYen(totals.income)}` : ''}
          </Text>
        }
      />
      {isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
      ) : days.length === 0 ? (
        <Text style={styles.message}>この月の記録はまだありません。右下の「＋」で記録します</Text>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          {days.map((day) => (
            <View key={day.date} style={styles.day}>
              <Text style={styles.dayTitle}>{dayLabel(day.date)}</Text>
              <View style={styles.card}>
                {day.records.map((record, index) => {
                  const { badge, title, sub } = describe(record);
                  const total = recordTotal(record);
                  return (
                    <Pressable
                      key={record.id}
                      accessibilityRole="button"
                      onPress={() => onOpen(record)}
                      style={[styles.row, index > 0 && styles.rowDivided]}
                    >
                      <CategoryBadge label={badge} />
                      <View style={styles.flex}>
                        <Text style={styles.title} numberOfLines={1}>
                          {title}
                        </Text>
                        {sub !== '' && (
                          <Text style={styles.sub} numberOfLines={1}>
                            {sub}
                          </Text>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.amount,
                          record.kind === 'income' && styles.income,
                          record.kind === 'transfer' && styles.transfer,
                        ]}
                      >
                        {record.kind === 'income' ? '+' : ''}
                        {formatYen(total)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  monthTotals: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', padding: 32 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  day: { marginBottom: 12 },
  dayTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, paddingBottom: 4 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  title: { fontSize: 14, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text },
  income: { color: colors.moneyIncome },
  transfer: { color: colors.textMuted },
});
