import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MoneyCategory, MoneyRecord, MoneyWallet, SpecialItem } from '@/types/app';
import { colors } from '@/lib/theme';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  formatYen,
  groupItems,
  groupRecordsByDay,
  iconKeyOf,
  itemSummary,
  recordTotal,
  recordsInMonth,
  topCategoryIdOf,
} from '@/lib/moneyUtils';
import { CategoryIcon, MonthBar, TransferIcon, WalletTypeIcon, type } from '@/components/money/moneyVisual';

// 家計タブの「記録」（docs/kakei.md §2・§3）。PWA版の `src/components/sukusuku/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 記録を日ごと（新しい日から）に並べる。その月に使った額は「振り返り」で見るので、ここには出さない（2026-10-08）。
// 1行＝1件の記録。Zaim の履歴と同じく、1行目は「小分類 @ お店」（大分類はアイコンで分かる）、2行目は品名の要約
// （「牛乳、卵ほか」）、金額の右に出金元の種類のアイコン。振替は回る矢印のアイコンで、出金元 → 入金先。
// 押すと記録の詳細。月の送りは固定で、スクロールするのは下だけ。

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
  const walletOf = (id: string | null) => wallets.find((wallet) => wallet.id === id) ?? null;
  const walletName = (id: string | null) => walletOf(id)?.name ?? '';

  const describe = (record: MoneyRecord) => {
    if (record.kind === 'transfer') {
      return {
        icon: null,
        title: '振替',
        sub: `${walletName(record.walletId) || '?'} → ${walletName(record.toWalletId) || '?'}`,
      };
    }
    const groups = groupItems(record.items);
    const first = groups[0];
    const top = first?.categoryId ? topCategoryIdOf(categories, first.categoryId) : null;
    // 小分類だけ（大分類はアイコンで分かる）。特別費は項目の名前。
    const firstTitle = first?.categoryId
      ? (categories.find((category) => category.id === first.categoryId)?.name ?? '')
      : first?.specialItemId
        ? (specialItems.find((item) => item.id === first.specialItemId)?.name ?? '')
        : '';
    const title = groups.length > 1 ? `${firstTitle} ほか${groups.length - 1}` : firstTitle;
    return {
      // 特別費は Zaim と同じく黄色の星。
      icon: top ? iconKeyOf(categories.find((category) => category.id === top)) : 'star',
      title: record.store.trim() !== '' ? `${title} @ ${record.store.trim()}` : title,
      sub: itemSummary(record.items),
    };
  };

  /** 金額の右に出す出金元のアイコン（振替は出金元と入金先）。 */
  const walletIcons = (record: MoneyRecord) =>
    (record.kind === 'transfer' ? [record.walletId, record.toWalletId] : [record.walletId])
      .map(walletOf)
      .filter((wallet): wallet is MoneyWallet => wallet !== null);

  return (
    <View style={styles.flex}>
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
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
                        {icon === null ? <TransferIcon /> : <CategoryIcon iconKey={icon} />}
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
                        <View style={styles.walletIcons}>
                          {walletIcons(record).map((wallet, iconIndex) => (
                            <WalletTypeIcon key={`${wallet.id}-${iconIndex}`} type={wallet.type} />
                          ))}
                        </View>
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
  walletIcons: { flexDirection: 'row', gap: 3, minWidth: 15 },
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
