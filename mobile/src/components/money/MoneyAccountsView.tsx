import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Plus } from 'lucide-react-native';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance, MoneyWalletDraft } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildWalletBalances,
  cardScheduleLabel,
  dateKeyOfDate,
  formatBalance,
  formatShortDate,
  WALLET_TYPES,
  type WalletBalanceRow,
} from '@/lib/moneyUtils';
import { WalletSheet } from '@/components/money/WalletPicker';
import WalletBalanceScreen from '@/components/money/WalletBalanceScreen';
import { Hero, WalletTypeIcon, type } from '@/components/money/moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。PWA版の `src/components/sukusuku/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に確定した残高 + その後の記録（支出・収入・振替）。確定がまだなら記録だけから出し、「未確定」と出す。
// 出金元を押すと詳細（残高を確定する・確定の履歴）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入る。

interface MoneyAccountsViewProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  isLoading: boolean;
  onConfirm: (walletId: string, balanceOn: string, amount: number) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onRestoreWallet: (wallet: MoneyWallet) => void;
}

export default function MoneyAccountsView({
  wallets,
  records,
  balances,
  isLoading,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
  onRestoreWallet,
}: MoneyAccountsViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const today = dateKeyOfDate(new Date());
  const summary = useMemo(
    () => buildWalletBalances(wallets, records, balances, today),
    [wallets, records, balances, today],
  );
  const usable = summary.rows.filter((row) => !row.wallet.archived);
  const archived = summary.rows.filter((row) => row.wallet.archived);
  const opened = wallets.find((wallet) => wallet.id === openId) ?? null;

  const status = (row: WalletBalanceRow) =>
    [
      row.confirmed === null ? '未確定' : `${formatShortDate(row.confirmed.balanceOn)} 確定`,
      row.wallet.isSaving ? '貯金用' : '',
      cardScheduleLabel(row.wallet),
    ]
      .filter((part) => part !== '')
      .join('・');

  return (
    <View style={styles.flex}>
      <View style={styles.hero}>
        <Hero
          label="総残高"
          value={formatBalance(summary.total)}
          minus={summary.total < 0}
          note={
            usable.length === 0
              ? '出金元を足すと、残高が出ます'
              : summary.unconfirmed > 0
                ? `未確定の出金元 ${summary.unconfirmed}件は、記録だけから出した額です`
                : '確定した残高 + そのあとの記録'
          }
        />
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {isLoading && <Text style={styles.message}>読み込み中...</Text>}
        {WALLET_TYPES.map((walletType) => {
          const inType = usable.filter((row) => row.wallet.type === walletType.id);
          if (inType.length === 0) return null;
          return (
            <View key={walletType.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{walletType.label}</Text>
              <View style={styles.card}>
                {inType.map((row, index) => (
                  <Pressable
                    key={row.wallet.id}
                    accessibilityRole="button"
                    onPress={() => setOpenId(row.wallet.id)}
                    style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                  >
                    <View style={styles.iconBox}>
                      <WalletTypeIcon type={row.wallet.type} size={20} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={type.row} numberOfLines={1}>
                        {row.wallet.name}
                      </Text>
                      <Text style={[type.sub, row.confirmed === null && styles.unconfirmed]} numberOfLines={1}>
                        {status(row)}
                      </Text>
                    </View>
                    <Text style={[type.amount, row.amount < 0 && type.minus]}>{formatBalance(row.amount)}</Text>
                    <ChevronRight size={16} color={colors.textFaint} />
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}

        <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={styles.add}>
          <Plus size={18} color={colors.money} />
          <Text style={styles.addText}>出金元を足す</Text>
        </Pressable>

        {archived.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>使わない出金元（記録には残っています）</Text>
            <View style={styles.card}>
              {archived.map((row, index) => (
                <View key={row.wallet.id} style={[styles.row, index > 0 && styles.rowDivided]}>
                  <Text style={[type.row, styles.flex, styles.archivedName]} numberOfLines={1}>
                    {row.wallet.name}
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => onRestoreWallet(row.wallet)} hitSlop={8}>
                    <Text style={type.link}>また使う</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {opened !== null && (
        <WalletBalanceScreen
          key={opened.id}
          wallet={opened}
          wallets={wallets}
          records={records}
          balances={balances}
          onClose={() => setOpenId(null)}
          onConfirm={onConfirm}
          onDeleteBalance={onDeleteBalance}
          onSaveWallet={onSaveWallet}
          onArchiveWallet={onArchiveWallet}
        />
      )}
      {adding && (
        <WalletSheet
          wallet={null}
          wallets={wallets}
          onClose={() => setAdding(false)}
          onSubmit={(draft) => {
            setAdding(false);
            void onSaveWallet(null, draft);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { paddingHorizontal: 16, paddingTop: 12 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  section: { marginTop: 20, gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
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
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  unconfirmed: { color: colors.moneyEstimate },
  archivedName: { opacity: 0.7 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
});
