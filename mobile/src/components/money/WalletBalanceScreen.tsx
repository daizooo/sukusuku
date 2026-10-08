import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil } from 'lucide-react-native';
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
  balanceChecks,
  cardBilling,
  dailyBalances,
  dateKeyOfDate,
  formatBalance,
  recordsOfWallet,
  walletBalanceOn,
} from '@/lib/moneyUtils';
import { WalletSheet } from '@/components/money/WalletPicker';
import BalanceSheet from '@/components/money/BalanceSheet';
import BalanceTrend from '@/components/money/BalanceTrend';
import RecordDayList from '@/components/money/RecordDayList';
import { ScreenHeader, StatRow, type } from '@/components/money/moneyVisual';

// 口座の詳細（docs/kakei.md §9.3）。PWA版の `src/components/sukusuku/money/WalletBalanceScreen.tsx` と同じ並び・文言。
// 上に残高と「残高を補正」、その下に「履歴 / 推移」の2つ（2026-10-08に、使わない「残高計算」を外した。余計な文字は入れない）。
// - 履歴: その出金元の記録（支出・収入・振替）に、残高の補正を同じ日の先頭に混ぜる。記録を押すと記録の詳細、補正を押すと取り消し
// - 推移: 日ごとの残高の折れ線（期間はじめは全期間）と、残高が変わった日の一覧
// カードは残高（未払い）の下に「請求済み」と「未請求」を添える（一覧の行には出さず、押したあとのここだけ）。
// 出金元の編集・使わなくするは見出しの鉛筆から。戻る操作（スマホの戻るボタン）は、シートを閉じる → この画面を閉じる、の順。

interface WalletBalanceScreenProps {
  wallet: MoneyWallet;
  /** 引き落とし口座の名前を出す・編集の候補に使う。 */
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  categories: MoneyCategory[];
  specialItems: SpecialItem[];
  onClose: () => void;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
}

type Tab = 'history' | 'trend';

const TABS: { id: Tab; label: string }[] = [
  { id: 'history', label: '履歴' },
  { id: 'trend', label: '推移' },
];

const fullDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${month}月${day}日`;
};
const monthDayLabel = (dateKey: string) => {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日`;
};

export default function WalletBalanceScreen({
  wallet,
  wallets,
  records,
  balances,
  categories,
  specialItems,
  onClose,
  onOpenRecord,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onArchiveWallet,
}: WalletBalanceScreenProps) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('history');
  const [correcting, setCorrecting] = useState(false);
  const [editing, setEditing] = useState(false);

  const today = dateKeyOfDate(new Date());
  const now = walletBalanceOn(wallet.id, today, records, balances);
  const checks = balanceChecks(wallet.id, records, balances);
  // 履歴に行として出すのは、「履歴に残す」を選んだ補正だけ（残さない補正も、残高の土台としては同じに効く）。
  const shownChecks = checks.filter((check) => check.balance.showInHistory);
  const mine = useMemo(() => recordsOfWallet(records, wallet.id), [records, wallet.id]);
  const points = useMemo(() => dailyBalances([wallet.id], records, balances, today), [wallet.id, records, balances, today]);
  const billing = wallet.type === 'card' ? cardBilling(wallet, now.amount, records, today) : null;

  const remove = (balance: MoneyWalletBalance) =>
    Alert.alert(`${fullDate(balance.balanceOn)}の補正を取り消しますか？`, '残高は、その前の補正と記録から出し直します。', [
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
        <View style={styles.summary}>
          <View style={styles.summaryTop}>
            <View style={styles.flex}>
              <Text style={[type.hero, now.amount < 0 && type.minus]}>{formatBalance(now.amount)}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setCorrecting(true)} style={styles.correct}>
              <Text style={styles.correctText}>残高を補正</Text>
            </Pressable>
          </View>
          {billing !== null && billing.billed + billing.unbilled > 0 && (
            <View style={styles.billing}>
              {billing.billed > 0 && (
                <StatRow
                  label="請求済み"
                  note={billing.payOn ? `${monthDayLabel(billing.payOn)}に引き落とし` : '引き落とし待ち'}
                  value={formatBalance(-billing.billed)}
                  minus
                />
              )}
              {billing.unbilled > 0 && (
                <StatRow
                  label="未請求"
                  value={formatBalance(-billing.unbilled)}
                  minus
                />
              )}
            </View>
          )}
        </View>
        <View accessibilityRole="tablist" style={styles.tabs}>
          {TABS.map((entry) => {
            const selected = entry.id === tab;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setTab(entry.id)}
                style={styles.tab}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{entry.label}</Text>
                <View style={[styles.underline, selected && styles.underlineSelected]} />
              </Pressable>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {tab === 'history' &&
            (mine.length === 0 && shownChecks.length === 0 ? (
              <Text style={styles.empty}>この出金元の記録はまだありません</Text>
            ) : (
              <RecordDayList
                records={mine}
                categories={categories}
                wallets={wallets}
                specialItems={specialItems}
                onOpen={onOpenRecord}
                corrections={shownChecks}
                onOpenCorrection={(check) => remove(check.balance)}
              />
            ))}

          {tab === 'trend' && <BalanceTrend points={points} asOf={today} />}
        </ScrollView>
      </View>

      {correcting && (
        <BalanceSheet
          wallet={wallet}
          records={records}
          balances={balances}
          onClose={() => setCorrecting(false)}
          onSubmit={(balanceOn, amount, showInHistory) => {
            setCorrecting(false);
            onConfirm(wallet.id, balanceOn, amount, showInHistory);
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
  summary: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, backgroundColor: colors.surface },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  correct: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.moneySoft },
  correctText: { fontSize: 13, fontWeight: '700', color: colors.moneyText },
  billing: { borderTopWidth: 1, borderTopColor: colors.border },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: { flex: 1, paddingTop: 8, alignItems: 'center' },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.textFaint },
  tabTextSelected: { color: colors.text, fontWeight: '700' },
  underline: { marginTop: 8, height: 3, width: 32, borderRadius: 2, backgroundColor: 'transparent' },
  underlineSelected: { backgroundColor: colors.money },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
});
