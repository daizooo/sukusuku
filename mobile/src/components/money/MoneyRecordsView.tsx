import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MoneyCategory, MoneyRecord, MoneyWallet, SpecialItem } from '@/types/app';
import { colors } from '@/lib/theme';
import { recordsInMonth } from '@/lib/moneyUtils';
import { MonthBar } from '@/components/money/moneyVisual';
import RecordDayList from '@/components/money/RecordDayList';

// 家計タブの「記録」（docs/kakei.md §2・§3）。PWA版の `src/components/sukusuku/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 記録を日ごと（新しい日から）に並べる（一覧そのものは RecordDayList）。その月に使った額は「振り返り」で見るので、
// ここには出さない（2026-10-08）。押すと記録の詳細。月の送りは固定で、スクロールするのは下だけ。

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

  return (
    <View style={styles.flex}>
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {isLoading ? (
          <Text style={styles.message}>読み込み中...</Text>
        ) : inMonth.length === 0 ? (
          <Text style={styles.message}>この月の記録はまだありません。右下の「＋」で記録します</Text>
        ) : (
          <RecordDayList records={inMonth} categories={categories} wallets={wallets} specialItems={specialItems} onOpen={onOpen} />
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
});
