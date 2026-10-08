import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Pencil, Plus } from 'lucide-react-native';
import type { MoneySecuritiesData, MoneySecurity, MoneySecurityDraft, MoneyWallet, MoneyWalletDraft } from '@/types/app';
import { colors } from '@/lib/theme';
import { dateKeyOfDate, formatBalance, holdingDailyValues, securityRows, walletGain } from '@/lib/moneyUtils';
import { WalletSheet } from '@/components/money/WalletPicker';
import BalanceTrend from '@/components/money/BalanceTrend';
import SecuritySheet from '@/components/money/SecuritySheet';
import SecurityScreen from '@/components/money/SecurityScreen';
import { Gain, ScreenHeader, SectionHeader, type } from '@/components/money/moneyVisual';

// 証券口座の詳細（docs/kakei.md §9.2.4）。PWA版の `src/components/sukusuku/money/SecuritiesWalletScreen.tsx` と同じ並び・文言。
// 上に評価額と評価損益、評価額の推移（はじめは全期間。1ヶ月・半年・1年）、下に保有銘柄の一覧
// （銘柄名・評価額・評価損益。預り区分の違う同じ銘柄は1行）。銘柄を押すと銘柄の詳細。
// 証券口座は記録からではなく評価額で数えるので、補正のボタンは出さない。
// 出金元の編集は見出しの鉛筆から。戻る操作は、シート・銘柄の詳細を閉じる → この画面を閉じる、の順。

interface SecuritiesWalletScreenProps {
  wallet: MoneyWallet;
  wallets: MoneyWallet[];
  securities: MoneySecuritiesData;
  onClose: () => void;
  onSaveWallet: (target: MoneyWallet, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onSaveSecurity: (walletId: string, target: MoneySecurity | null, draft: MoneySecurityDraft) => void;
  onArchiveSecurity: (walletId: string, security: MoneySecurity) => void;
}

export default function SecuritiesWalletScreen({
  wallet,
  wallets,
  securities,
  onClose,
  onSaveWallet,
  onArchiveWallet,
  onSaveSecurity,
  onArchiveSecurity,
}: SecuritiesWalletScreenProps) {
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const today = dateKeyOfDate(new Date());
  const rows = useMemo(() => securityRows(wallet.id, securities, today), [wallet.id, securities, today]);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const gain = walletGain(rows);
  const points = useMemo(
    () =>
      holdingDailyValues(
        securities.holdings.filter((holding) => holding.walletId === wallet.id).map((holding) => holding.id),
        securities.values,
        today,
      ),
    [wallet.id, securities, today],
  );
  const opened = securities.securities.find((security) => security.id === openId) ?? null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScreenHeader
          title={wallet.name}
          icon="back"
          onClose={onClose}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${wallet.name}を編集`}
              onPress={() => setEditing(true)}
              hitSlop={10}
            >
              <Pencil size={20} color={colors.textSubtle} />
            </Pressable>
          }
        />
        <View style={styles.summary}>
          <Text style={type.hero}>{formatBalance(total)}</Text>
          {gain !== null && <Gain gain={gain.gain} rate={gain.rate} />}
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <BalanceTrend points={points} asOf={today} showHistory={false} emptyText="まだ評価額がありません" />

          <SectionHeader title="保有銘柄" />
          {rows.length > 0 && (
            <View style={styles.card}>
              {rows.map((row, index) => (
                <Pressable
                  key={row.security.id}
                  accessibilityRole="button"
                  onPress={() => setOpenId(row.security.id)}
                  style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                >
                  <Text style={[type.row, styles.flex]} numberOfLines={2}>
                    {row.security.name}
                  </Text>
                  <View style={styles.amounts}>
                    <Text style={type.amount}>{formatBalance(row.value)}</Text>
                    {row.gain !== null && <Gain gain={row.gain} rate={row.gainRate} size="sub" />}
                  </View>
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>
          )}
          <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={styles.add}>
            <Plus size={18} color={colors.money} />
            <Text style={styles.addText}>銘柄を足す</Text>
          </Pressable>
        </ScrollView>
      </View>

      {opened !== null && (
        <SecurityScreen
          key={opened.id}
          wallet={wallet}
          security={opened}
          securities={securities}
          onClose={() => setOpenId(null)}
          onSave={(draft) => onSaveSecurity(wallet.id, opened, draft)}
          onArchive={() => {
            setOpenId(null);
            onArchiveSecurity(wallet.id, opened);
          }}
        />
      )}
      {adding && (
        <SecuritySheet
          security={null}
          holdings={[]}
          onClose={() => setAdding(false)}
          onSubmit={(draft) => {
            setAdding(false);
            onSaveSecurity(wallet.id, null, draft);
          }}
        />
      )}
      {editing && (
        <WalletSheet
          wallet={wallet}
          wallets={wallets}
          onClose={() => setEditing(false)}
          onSubmit={(draft) => {
            setEditing(false);
            void onSaveWallet(wallet, draft);
          }}
          onArchive={() => {
            setEditing(false);
            onArchiveWallet(wallet);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  summary: { gap: 4, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: colors.surface },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  amounts: { alignItems: 'flex-end', gap: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
});
