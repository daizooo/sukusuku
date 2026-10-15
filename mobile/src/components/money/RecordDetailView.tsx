import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Store, Trash2 } from 'lucide-react-native';
import type { MoneyRecordKind, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { formatDateWithYear } from '@/lib/dateUtils';
import { formatYen, type EditorGroup } from '@/lib/moneyUtils';
import RecordItemGroups from '@/components/money/RecordItemGroups';
import { NextPeriodBadge, PrimaryButton, ScreenHeader, WalletTypeIcon } from '@/components/money/moneyVisual';

// 記録の詳細（読むだけ。docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/RecordDetailView.tsx` と同じ並び・文言。
// 既にある記録を開くと、まずこれを見せる（2026-10-15。Zaim と同じ）。直すときは下の「編集する」で入力画面（RecordEditor）へ。
// 日付を中央、金額を一番大きく、出金元とお店はアイコンつきの2行、その下に品目一覧（カテゴリごとに内訳。RecordItemGroups）。

interface RecordDetailViewProps {
  kind: MoneyRecordKind;
  occurredOn: string;
  total: number;
  wallet: MoneyWallet | null;
  /** 振替の入金先。 */
  toWallet: MoneyWallet | null;
  store: string;
  /** カードの引き落としを翌月分に回してある。出金元の行に「翌月払い」の札で出す。 */
  cardNextPeriod: boolean;
  groups: EditorGroup[];
  groupTitle: (group: EditorGroup) => string;
  groupIconKey: (group: EditorGroup) => string;
  /** 日付の上の案内（見込み・自動で作った記録）。無ければ null。 */
  notice: ReactNode;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function WalletRow({ wallet, badge }: { wallet: MoneyWallet | null; badge?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{wallet && <WalletTypeIcon type={wallet.type} size={22} color={wallet.iconColor} />}</View>
      <Text style={styles.rowText} numberOfLines={1}>
        {wallet?.name ?? '出金元なし'}
      </Text>
      {badge && <NextPeriodBadge />}
    </View>
  );
}

export default function RecordDetailView({
  kind,
  occurredOn,
  total,
  wallet,
  toWallet,
  store,
  cardNextPeriod,
  groups,
  groupTitle,
  groupIconKey,
  notice,
  onClose,
  onDelete,
  onEdit,
}: RecordDetailViewProps) {
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="記録の詳細"
        icon="back"
        onClose={onClose}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="この記録を消す" onPress={onDelete} hitSlop={8}>
            <Trash2 size={20} color={colors.textMuted} />
          </Pressable>
        }
      />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {notice}
        <Text style={styles.date}>{formatDateWithYear(new Date(`${occurredOn}T00:00:00`))}</Text>
        <Text style={[styles.amount, kind === 'income' && styles.income, kind === 'transfer' && styles.muted]}>{formatYen(total)}</Text>
        <View style={styles.rows}>
          <WalletRow wallet={wallet} badge={cardNextPeriod} />
          {kind === 'transfer' ? (
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <ArrowRight size={20} color={colors.textMuted} />
              </View>
              <Text style={styles.rowText} numberOfLines={1}>
                {toWallet?.name ?? '入金先なし'}
              </Text>
            </View>
          ) : (
            store !== '' && (
              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Store size={20} color={colors.textMuted} />
                </View>
                <Text style={styles.rowText} numberOfLines={1}>
                  {store}
                </Text>
              </View>
            )
          )}
        </View>
        {kind !== 'transfer' && groups.length > 0 && (
          <>
            <Text style={styles.section}>品目一覧</Text>
            <RecordItemGroups groups={groups} title={groupTitle} iconKey={groupIconKey} size="large" />
          </>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="編集する" onPress={onEdit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  date: { marginTop: 14, textAlign: 'center', fontSize: 15, fontWeight: '700', color: colors.textSubtle },
  // 金額が一番大きい（品目の金額は灰色にして、この合計とメリハリをつける）。
  amount: { marginTop: 6, textAlign: 'center', fontSize: 42, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  income: { color: colors.moneyIncome },
  muted: { color: colors.textMuted },
  rows: { marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  rowIcon: { width: 24, alignItems: 'center' },
  rowText: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  section: { marginTop: 12, marginBottom: 2, textAlign: 'center', fontSize: 13, fontWeight: '700', color: colors.textMuted },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border },
});
