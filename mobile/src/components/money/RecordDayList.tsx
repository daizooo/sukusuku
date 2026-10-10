import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Scale } from 'lucide-react-native';
import type { MoneyCategory, MoneyRecord, MoneyWallet, SpecialItem } from '@/types/app';
import { colors } from '@/lib/theme';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  formatBalance,
  formatSignedYen,
  formatYen,
  groupItems,
  groupRecordsByDay,
  iconKeyOf,
  itemSummary,
  recordTotal,
  topCategoryIdOf,
  type BalanceCheck,
} from '@/lib/moneyUtils';
import { CategoryIcon, EstimateBadge, TransferIcon, WalletTypeIcon } from '@/components/money/moneyVisual';

// 記録を日ごと（新しい日から）に並べる一覧（docs/kakei.md §2.1）。家計タブの「記録」と、口座の詳細の「履歴」で同じものを使う。
// PWA版の `src/components/sukusuku/money/RecordDayList.tsx` と同じ並び・文言。
// 1行＝1件の記録。Zaim の履歴と同じく、1行目は「小分類 @ お店」（大分類はアイコンで分かる）、2行目は品名の要約
// （「牛乳、卵ほか」）、金額の右に出金元の種類のアイコン。振替は回る矢印のアイコンで、出金元 → 入金先。
// 毎月の記録・カード代金で自動で作り、まだ額を確かめていないものは金額の左に「見込み」（§3.3）。
// 口座の履歴では、残高の補正（corrections）も同じ日の先頭に1行で混ぜる（その日の終わりの残高なので）。押すと取り消しの確認。
// 補正の行は、総額が画面の上にあるので「差」だけを出す（はじめの残高だけは差が無いので、その額）。
// スクロールは持たない（親のスクロールの中に置く）。

interface RecordDayListProps {
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  specialItems: SpecialItem[];
  onOpen: (record: MoneyRecord) => void;
  /** 口座の履歴に混ぜる、残高の補正。 */
  corrections?: BalanceCheck[];
  onOpenCorrection?: (check: BalanceCheck) => void;
}

const dayLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日（${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]}）`;
};

export default function RecordDayList({
  records,
  categories,
  wallets,
  specialItems,
  onOpen,
  corrections = [],
  onOpenCorrection,
}: RecordDayListProps) {
  // 記録のある日と補正のある日を合わせて、新しい日から。
  const recordDays = groupRecordsByDay(records);
  const dates = [...new Set([...recordDays.map((day) => day.date), ...corrections.map((check) => check.balance.balanceOn)])].sort(
    (a, b) => b.localeCompare(a),
  );
  const days = dates.map((date) => ({
    date,
    records: recordDays.find((day) => day.date === date)?.records ?? [],
    corrections: corrections.filter((check) => check.balance.balanceOn === date),
  }));
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
              {spent > 0 && <Text style={styles.daySum}>{formatYen(spent)}</Text>}
            </View>
            <View style={styles.card}>
              {day.corrections.map((check, index) => (
                <Pressable
                  key={check.balance.id}
                  accessibilityRole="button"
                  accessibilityLabel="残高の補正"
                  onPress={() => onOpenCorrection?.(check)}
                  style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                >
                  <View style={styles.correctionIcon}>
                    <Scale size={14} color="#ffffff" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.title} numberOfLines={1}>
                      {check.diff === null ? 'はじめの残高' : '残高を補正'}
                    </Text>
                  </View>
                  <Text style={[styles.amount, check.diff !== null && check.diff > 0 && styles.income]}>
                    {check.diff === null ? formatBalance(check.balance.amount) : check.diff === 0 ? formatYen(0) : formatSignedYen(check.diff)}
                  </Text>
                </Pressable>
              ))}
              {day.records.map((record, indexInDay) => {
                const index = day.corrections.length + indexInDay;
                const { icon, title, sub } = describe(record);
                const total = recordTotal(record);
                return (
                  <Pressable
                    key={record.id}
                    accessibilityRole="button"
                    onPress={() => onOpen(record)}
                    style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                  >
                    {icon === null ? <TransferIcon size={28} /> : <CategoryIcon iconKey={icon} size={28} />}
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
                    {record.isEstimate && <EstimateBadge />}
                    <Text style={[styles.amount, record.kind === 'transfer' && styles.muted, record.kind === 'income' && styles.income]}>
                      {formatYen(total)}
                    </Text>
                    <View style={styles.walletIcons}>
                      {walletIcons(record).map((wallet, iconIndex) => (
                        <WalletTypeIcon key={`${wallet.id}-${iconIndex}`} type={wallet.type} color={wallet.iconColor} />
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
  // 補正の行のアイコン（振替と同じ大きさの、青みの灰の丸に白い天びん）。
  correctionIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5b7a99' },
  day: { marginTop: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 4 },
  dayTitle: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  daySum: { fontSize: 12, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
  // 名前は太く濃く、補足は小さく灰、金額は大きく極太（収入は緑・支出は黒。符号はつけない）。
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  amount: { fontSize: 17, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  muted: { color: colors.textMuted },
  // 収入の額は緑（支出と見分けがつくように）。
  income: { color: colors.moneyIncome },
});
