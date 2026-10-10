import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import type {
  MoneyCategory,
  MoneyRecord,
  MoneySecuritiesData,
  MoneySecurity,
  MoneySecurityDraft,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
  SpecialItem,
} from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildWalletBalances,
  dateKeyOfDate,
  formatBalance,
  WALLET_TYPES,
} from '@/lib/moneyUtils';
import { WalletSheet } from '@/components/money/WalletPicker';
import TotalTrendScreen from '@/components/money/TotalTrendScreen';
import WalletBalanceScreen from '@/components/money/WalletBalanceScreen';
import SecuritiesWalletScreen from '@/components/money/SecuritiesWalletScreen';
import { Hero, WalletTypeIcon, type } from '@/components/money/moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。PWA版の `src/components/sukusuku/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定。押すと推移）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に補正した残高 + その後の記録（支出・収入・振替）。補正は、通帳・銀行のアプリと違うときに詳細から入れる
// （「未確定」などの印は出さない。2026-10-08に、出しっぱなしでうるさいので外した）。
// 出金元を押すと詳細（履歴 / 推移 / 残高計算）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入る（請求済み・未請求の内訳は、押した先の詳細だけに出す）。
// 証券口座の残高は、記録からではなく保有銘柄の評価額（docs/kakei.md §9.2）。押すと証券口座の詳細（推移と保有銘柄）。

interface MoneyAccountsViewProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  securities: MoneySecuritiesData;
  categories: MoneyCategory[];
  specialItems: SpecialItem[];
  isLoading: boolean;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onRestoreWallet: (wallet: MoneyWallet) => void;
  onSaveSecurity: (walletId: string, target: MoneySecurity | null, draft: MoneySecurityDraft) => void;
  onArchiveSecurity: (walletId: string, security: MoneySecurity) => void;
  /** 推移・証券口座の詳細を開いたときに、評価額の履歴を読ませる（一覧は最新の1行だけで出す）。 */
  onNeedSecurityHistory: () => void | Promise<void>;
}

export default function MoneyAccountsView({
  wallets,
  records,
  balances,
  securities,
  categories,
  specialItems,
  isLoading,
  onOpenRecord,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
  onRestoreWallet,
  onSaveSecurity,
  onArchiveSecurity,
  onNeedSecurityHistory,
}: MoneyAccountsViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const today = dateKeyOfDate(new Date());
  const summary = useMemo(
    () => buildWalletBalances(wallets, records, balances, today, securities),
    [wallets, records, balances, today, securities],
  );
  const usable = summary.rows.filter((row) => !row.wallet.archived);
  const archived = summary.rows.filter((row) => row.wallet.archived);
  const opened = wallets.find((wallet) => wallet.id === openId) ?? null;
  const needsHistory =
    (opened !== null && opened.type === 'securities') ||
    (showTrend && wallets.some((wallet) => wallet.type === 'securities' && !wallet.archived));
  useEffect(() => {
    if (needsHistory && !securities.historyLoaded) onNeedSecurityHistory();
  }, [needsHistory, securities.historyLoaded, onNeedSecurityHistory]);

  return (
    <View style={styles.flex}>
      {/* 総残高も一覧と一緒に流れる（固定しない。2026-10-08）。 */}
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="総残高の推移を見る"
          onPress={() => setShowTrend(true)}
          disabled={usable.length === 0}
          style={styles.hero}
        >
          <Hero
            label="総残高"
            center
            value={formatBalance(summary.total)}
            compact
            note={usable.length === 0 ? '出金元を足すと、残高が出ます' : undefined}
          />
        </Pressable>
        {isLoading && <Text style={styles.message}>読み込み中...</Text>}
        {WALLET_TYPES.map((walletType) => {
          const inType = usable.filter((row) => row.wallet.type === walletType.id);
          if (inType.length === 0) return null;
          return (
            <View key={walletType.id} style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{walletType.label}</Text>
                <Text style={styles.sectionSum}>{formatBalance(inType.reduce((sum, row) => sum + row.amount, 0))}</Text>
              </View>
              {/* Zaim の「残高」と同じく2列に並べる（2026-10-08）。金額は大きく太く、プラスは緑・マイナスは「−」と黒（2026-10-10）。 */}
              <View style={styles.grid}>
                {inType.map((row) => (
                  <Pressable
                    key={row.wallet.id}
                    accessibilityRole="button"
                    onPress={() => setOpenId(row.wallet.id)}
                    style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                  >
                    <View style={styles.tileTop}>
                      <WalletTypeIcon type={row.wallet.type} size={20} color={row.wallet.iconColor} />
                      <Text style={styles.tileName} numberOfLines={2}>
                        {row.wallet.name}
                      </Text>
                    </View>
                    <Text style={[styles.tileAmount, row.amount > 0 && styles.tilePlus]}>{formatBalance(row.amount)}</Text>
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

      {opened !== null && opened.type === 'securities' && (
        <SecuritiesWalletScreen
          key={opened.id}
          wallet={opened}
          wallets={wallets}
          securities={securities}
          onClose={() => setOpenId(null)}
          onSaveWallet={onSaveWallet}
          onArchiveWallet={onArchiveWallet}
          onSaveSecurity={onSaveSecurity}
          onArchiveSecurity={onArchiveSecurity}
        />
      )}
      {opened !== null && opened.type !== 'securities' && (
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
        <TotalTrendScreen
          wallets={wallets}
          records={records}
          balances={balances}
          securities={securities}
          today={today}
          onClose={() => setShowTrend(false)}
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
  hero: { paddingTop: 6 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  section: { marginTop: 8, gap: 3 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  sectionSum: { fontSize: 12, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: {
    width: '48.5%',
    justifyContent: 'space-between',
    gap: 2,
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  tileName: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 16, color: colors.textMuted },
  // 金額は名前より大きく太く。プラスは明るい緑、マイナスは「−」をつけて黒（Zaim と同じ）。
  tileAmount: { alignSelf: 'flex-end', fontSize: 21, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  tilePlus: { color: colors.moneyIncome },
  archivedName: { opacity: 0.7 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
});
