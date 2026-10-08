import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Plus } from 'lucide-react-native';
import type {
  MoneyCategory,
  MoneyRecord,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
  SpecialItem,
} from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildWalletBalances,
  cardBilling,
  cardScheduleLabel,
  dateKeyOfDate,
  formatBalance,
  formatYen,
  WALLET_TYPES,
  type WalletBalanceRow,
} from '@/lib/moneyUtils';
import { WalletSheet } from '@/components/money/WalletPicker';
import TotalTrendScreen from '@/components/money/TotalTrendScreen';
import WalletBalanceScreen from '@/components/money/WalletBalanceScreen';
import { Hero, WalletTypeIcon, type } from '@/components/money/moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。PWA版の `src/components/sukusuku/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定。押すと推移）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に補正した残高 + その後の記録（支出・収入・振替）。補正は、通帳・銀行のアプリと違うときに詳細から入れる
// （「未確定」などの印は出さない。2026-10-08に、出しっぱなしでうるさいので外した）。
// 出金元を押すと詳細（履歴 / 推移 / 残高計算）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入り、請求済み（引き落とし待ち）と未請求に分けて添える。
// 証券口座は、銘柄ごとの評価額（docs/kakei.md §9.2）ができるまでは入らない。

interface MoneyAccountsViewProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  categories: MoneyCategory[];
  specialItems: SpecialItem[];
  isLoading: boolean;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onRestoreWallet: (wallet: MoneyWallet) => void;
}

const shortDay = (dateKey: string) => {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}/${day}`;
};

export default function MoneyAccountsView({
  wallets,
  records,
  balances,
  categories,
  specialItems,
  isLoading,
  onOpenRecord,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
  onRestoreWallet,
}: MoneyAccountsViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const today = dateKeyOfDate(new Date());
  const summary = useMemo(
    () => buildWalletBalances(wallets, records, balances, today),
    [wallets, records, balances, today],
  );
  const usable = summary.rows.filter((row) => !row.wallet.archived);
  const archived = summary.rows.filter((row) => row.wallet.archived);
  const opened = wallets.find((wallet) => wallet.id === openId) ?? null;

  const status = (row: WalletBalanceRow) =>
    [row.wallet.isSaving ? '貯金用' : '', cardScheduleLabel(row.wallet)].filter((part) => part !== '').join('・');
  /** カードの残高に添える、請求済み（引き落とし待ち）と未請求の2行。締め日が未設定なら出さない。 */
  const billingLines = (row: WalletBalanceRow): string[] => {
    if (row.wallet.type !== 'card') return [];
    const billing = cardBilling(row.wallet, row.amount, records, today);
    if (billing === null || billing.billed + billing.unbilled === 0) return [];
    return [
      `請求済み ${formatYen(billing.billed)}${billing.payOn ? `（${shortDay(billing.payOn)}払い）` : ''}`,
      `未請求 ${formatYen(billing.unbilled)}`,
    ];
  };

  return (
    <View style={styles.flex}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="総残高の推移を見る"
        onPress={() => setShowTrend(true)}
        disabled={usable.length === 0}
        style={styles.hero}
      >
        <Hero
          label="総残高"
          value={formatBalance(summary.total)}
          minus={summary.total < 0}
          note={usable.length === 0 ? '出金元を足すと、残高が出ます' : '押すと推移'}
        />
      </Pressable>
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
                      {status(row) !== '' && (
                        <Text style={type.sub} numberOfLines={1}>
                          {status(row)}
                        </Text>
                      )}
                      {billingLines(row).map((line) => (
                        <Text key={line} style={type.sub} numberOfLines={1}>
                          {line}
                        </Text>
                      ))}
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
          categories={categories}
          specialItems={specialItems}
          onClose={() => setOpenId(null)}
          onOpenRecord={onOpenRecord}
          onConfirm={onConfirm}
          onDeleteBalance={onDeleteBalance}
          onSaveWallet={onSaveWallet}
          onArchiveWallet={onArchiveWallet}
        />
      )}
      {showTrend && (
        <TotalTrendScreen wallets={wallets} records={records} balances={balances} today={today} onClose={() => setShowTrend(false)} />
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
  archivedName: { opacity: 0.7 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
});
