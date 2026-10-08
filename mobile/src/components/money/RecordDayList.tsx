import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  topCategoryIdOf,
} from '@/lib/moneyUtils';
import { CategoryIcon, EstimateBadge, TransferIcon, WalletTypeIcon, type } from '@/components/money/moneyVisual';

// 記録を日ごと（新しい日から）に並べる一覧（docs/kakei.md §2.1）。家計タブの「記録」と、口座の詳細の「履歴」で同じものを使う。
// PWA版の `src/components/sukusuku/money/RecordDayList.tsx` と同じ並び・文言。
// 1行＝1件の記録。Zaim の履歴と同じく、1行目は「小分類 @ お店」（大分類はアイコンで分かる）、2行目は品名の要約
// （「牛乳、卵ほか」）、金額の右に出金元の種類のアイコン。振替は回る矢印のアイコンで、出金元 → 入金先。
// 毎月の記録・カード代金で自動で作り、まだ額を確かめていないものは金額の左に「見込み」（§3.3）。
// スクロールは持たない（親のスクロールの中に置く）。

interface RecordDayListProps {
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  specialItems: SpecialItem[];
  onOpen: (record: MoneyRecord) => void;
}

const dayLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日（${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]}）`;
};

export default function RecordDayList({ records, categories, wallets, specialItems, onOpen }: RecordDayListProps) {
  const days = groupRecordsByDay(records);
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
    <>
      {days.map((day) => {
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
                    {record.isEstimate && <EstimateBadge />}
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
      })}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  walletIcons: { flexDirection: 'row', gap: 3, minWidth: 15 },
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
