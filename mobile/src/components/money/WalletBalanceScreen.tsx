import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil, Trash2 } from 'lucide-react-native';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance, MoneyWalletDraft } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  balanceChecks,
  cardScheduleLabel,
  dateKeyOfDate,
  formatBalance,
  formatShortDate,
  formatSignedYen,
  walletBalanceOn,
  walletTypeLabel,
} from '@/lib/moneyUtils';
import { WalletSheet } from '@/components/money/WalletPicker';
import BalanceSheet from '@/components/money/BalanceSheet';
import { Hero, PrimaryButton, ScreenHeader, SectionHeader, WalletTypeIcon, type } from '@/components/money/moneyVisual';

// 口座の詳細（docs/kakei.md §9.3）。PWA版の `src/components/sukusuku/money/WalletBalanceScreen.tsx` と同じ並び・文言。
// 残高（確定した残高 + その後の記録）、「残高を確定する」、確定の履歴（記録との差つき）、出金元の編集・使わなくする。
// 戻る操作（スマホの戻るボタン）は、シートを閉じる → この画面を閉じる、の順。

interface WalletBalanceScreenProps {
  wallet: MoneyWallet;
  /** 引き落とし口座の名前を出す・編集の候補に使う。 */
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  onClose: () => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
}

const fullDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${month}月${day}日`;
};

export default function WalletBalanceScreen({
  wallet,
  wallets,
  records,
  balances,
  onClose,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
}: WalletBalanceScreenProps) {
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  const now = walletBalanceOn(wallet.id, dateKeyOfDate(new Date()), records, balances);
  const checks = balanceChecks(wallet.id, records, balances);
  const payWallet = wallets.find((entry) => entry.id === wallet.payWalletId) ?? null;
  const schedule = cardScheduleLabel(wallet);

  const remove = (balance: MoneyWalletBalance) =>
    Alert.alert(`${fullDate(balance.balanceOn)}の確定を取り消しますか？`, '残高は、その前の確定と記録から出し直します。', [
      { text: 'やめる', style: 'cancel' },
      { text: '取り消す', style: 'destructive', onPress: () => onDeleteBalance(balance) },
    ]);

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
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.kind}>
            <WalletTypeIcon type={wallet.type} size={16} />
            <Text style={type.sub}>
              {[walletTypeLabel(wallet.type), wallet.isSaving ? '貯金用' : '', schedule, payWallet ? `${payWallet.name}から引き落とし` : '']
                .filter((part) => part !== '')
                .join('・')}
            </Text>
          </View>

          <Hero
            label="残高"
            value={formatBalance(now.amount)}
            minus={now.amount < 0}
            note={
              now.confirmed === null
                ? 'まだ確定していません。記録だけから出した額です'
                : `${fullDate(now.confirmed.balanceOn)}に確定した ${formatBalance(now.confirmed.amount)} に、そのあとの記録${now.count}件（${formatSignedYen(now.movement)}）を足した額`
            }
          />
          <PrimaryButton label="残高を確定する" onPress={() => setConfirming(true)} />

          <SectionHeader title="確定の履歴" hint="月に1回、通帳・銀行のアプリの残高を入れます" />
          {checks.length === 0 ? (
            <Text style={styles.empty}>まだ確定していません</Text>
          ) : (
            <View style={styles.card}>
              {checks.map((check, index) => (
                <View key={check.balance.id} style={[styles.row, index > 0 && styles.rowDivided]}>
                  <View style={styles.flex}>
                    <Text style={type.row}>{fullDate(check.balance.balanceOn)}</Text>
                    <Text style={[type.sub, check.diff !== null && check.diff !== 0 && type.minus]}>
                      {check.diff === null
                        ? 'はじめの残高'
                        : check.diff === 0
                          ? `記録と合っていました（${formatBalance(check.expected)}）`
                          : `記録との差 ${formatSignedYen(check.diff)}（記録では ${formatBalance(check.expected)}）`}
                    </Text>
                  </View>
                  <Text style={[type.amount, check.balance.amount < 0 && type.minus]}>{formatBalance(check.balance.amount)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${formatShortDate(check.balance.balanceOn)}の確定を取り消す`}
                    onPress={() => remove(check.balance)}
                    hitSlop={8}
                  >
                    <Trash2 size={16} color={colors.textFaint} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {confirming && (
        <BalanceSheet
          wallet={wallet}
          records={records}
          balances={balances}
          onClose={() => setConfirming(false)}
          onSubmit={(balanceOn, amount) => {
            setConfirming(false);
            onConfirm(wallet.id, balanceOn, amount);
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
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
});
