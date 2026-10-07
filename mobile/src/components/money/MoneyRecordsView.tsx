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
  iconKeyOf,
  recordTotal,
  recordsInMonth,
  topCategoryIdOf,
} from '@/lib/moneyUtils';
import { CategoryIcon, Hero, MonthBar, type } from '@/components/money/moneyVisual';

// 家計タブの「記録」（docs/kakei.md §2・§3）。PWA版の `src/components/sukusuku/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 結論はその月に使った額（生活費。特別費は「特別費」の面だけで見る）。その下に記録を日ごと（新しい日から）。
// 1行＝1件の記録（種類・お店・出金元・合計）。押すと記録の詳細。月の送りは固定で、スクロールするのは下だけ。

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
    // 特別費の品目は数えない（特別費は「特別費」の面だけで見る）。
    for (const record of inMonth) {
      const amount = record.items.filter((item) => item.specialItemId === null).reduce((sum, item) => sum + item.amount, 0);
      if (record.kind === 'expense') expense += amount;
      if (record.kind === 'income') income += amount;
    }
    return { expense, income };
  }, [inMonth]);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';

  const describe = (record: MoneyRecord) => {
    if (record.kind === 'transfer') {
      return {
        icon: 'wallet',
        title: '振替',
        sub: `${walletName(record.walletId) || '?'} → ${walletName(record.toWalletId) || '?'}`,
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
      icon: top ? iconKeyOf(categories.find((category) => category.id === top)) : 'receipt',
      title: groups.length > 1 ? `${firstTitle} ほか${groups.length - 1}` : firstTitle,
      sub: [record.store, walletName(record.walletId)].filter((text) => text !== '').join('・'),
    };
  };

  return (
    <View style={styles.flex}>
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Hero
          label="この月に使った額（生活費）"
          value={formatYen(totals.expense)}
          note={totals.income > 0 ? `収入 +${formatYen(totals.income)}` : undefined}
        />

        {isLoading ? (
          <Text style={styles.message}>読み込み中...</Text>
        ) : days.length === 0 ? (
          <Text style={styles.message}>この月の記録はまだありません。右下の「＋」で記録します</Text>
        ) : (
          days.map((day) => {
            const spent = day.records
              .filter((record) => record.kind === 'expense')
              .flatMap((record) => record.items)
              .filter((item) => item.specialItemId === null)
              .reduce((sum, item) => sum + item.amount, 0);
            return (
              <View key={day.date} style={styles.day}>
                <View style={styles.dayHead}>
                  <Text style={styles.dayTitle}>{dayLabel(day.date)}</Text>
                  {spent > 0 && <Text style={type.faint}>{formatYen(spent)}</Text>}
                </View>
                <View style={styles.card}>
                  {day.records.map((record, index) => {
                    const { icon, title, sub } = describe(record);
                    const total = recordTotal(record);
                    return (
                      <Pressable
                        key={record.id}
                        accessibilityRole="button"
                        onPress={() => onOpen(record)}
                        style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                      >
                        <CategoryIcon iconKey={icon} />
                        <View style={styles.flex}>
                          <Text style={type.row} numberOfLines={1}>
                            {title}
                          </Text>
                          {sub !== '' && (
                            <Text style={type.sub} numberOfLines={1}>
                              {sub}
                            </Text>
                          )}
                        </View>
                        <Text style={[type.amount, record.kind === 'transfer' && styles.muted, record.kind === 'income' && styles.income]}>
                          {record.kind === 'income' ? '+' : ''}
                          {formatYen(total)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  day: { marginTop: 20 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 6 },
  dayTitle: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  muted: { color: colors.textMuted },
  // 収入の額は緑（支出と見分けがつくように）。
  income: { color: colors.moneyIncome },
});
