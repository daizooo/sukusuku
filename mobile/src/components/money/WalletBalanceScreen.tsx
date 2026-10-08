import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil, Trash2 } from 'lucide-react-native';
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
  cardScheduleLabel,
  dailyBalances,
  dateKeyOfDate,
  formatBalance,
  formatSignedYen,
  recordsOfWallet,
  walletBalanceOn,
  walletTypeLabel,
} from '@/lib/moneyUtils';
import { WalletSheet } from '@/components/money/WalletPicker';
import BalanceSheet from '@/components/money/BalanceSheet';
import BalanceTrend from '@/components/money/BalanceTrend';
import RecordDayList from '@/components/money/RecordDayList';
import { Hero, PrimaryButton, ScreenHeader, SectionHeader, StatRow, WalletTypeIcon, type } from '@/components/money/moneyVisual';

// 口座の詳細（docs/kakei.md §9.3）。PWA版の `src/components/sukusuku/money/WalletBalanceScreen.tsx` と同じ並び・文言。
// Zaim の口座と同じく「履歴 / 推移 / 残高計算」の3つ。
// - 履歴: その出金元の記録（支出・収入・振替）。押すと記録の詳細
// - 推移: 日ごとの残高の折れ線（期間はじめは全期間）と、残高が変わった日の一覧
// - 残高計算: 残高 ＝ 最後に補正した残高 + そのあとの記録。通帳・銀行のアプリと違うときは「残高を補正する」。
//   カードは残高（未払い）を「請求済み」と「未請求」に分けて出す
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
  onConfirm: (walletId: string, balanceOn: string, amount: number) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
}

type Tab = 'history' | 'trend' | 'calc';

const TABS: { id: Tab; label: string }[] = [
  { id: 'history', label: '履歴' },
  { id: 'trend', label: '推移' },
  { id: 'calc', label: '残高計算' },
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
  const mine = useMemo(() => recordsOfWallet(records, wallet.id), [records, wallet.id]);
  const points = useMemo(() => dailyBalances([wallet.id], records, balances, today), [wallet.id, records, balances, today]);
  const billing = wallet.type === 'card' ? cardBilling(wallet, now.amount, records, today) : null;
  const payWallet = wallets.find((entry) => entry.id === wallet.payWalletId) ?? null;

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
        <View style={styles.kind}>
          <WalletTypeIcon type={wallet.type} size={16} />
          <Text style={type.sub} numberOfLines={1}>
            {[
              walletTypeLabel(wallet.type),
              wallet.isSaving ? '貯金用' : '',
              cardScheduleLabel(wallet),
              payWallet ? `${payWallet.name}から引き落とし` : '',
            ]
              .filter((part) => part !== '')
              .join('・')}
          </Text>
          <View style={styles.flex} />
          <Text style={[type.amount, now.amount < 0 && type.minus]}>{formatBalance(now.amount)}</Text>
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
            (mine.length === 0 ? (
              <Text style={styles.empty}>この出金元の記録はまだありません</Text>
            ) : (
              <RecordDayList records={mine} categories={categories} wallets={wallets} specialItems={specialItems} onOpen={onOpenRecord} />
            ))}

          {tab === 'trend' && <BalanceTrend points={points} asOf={today} />}

          {tab === 'calc' && (
            <View style={styles.calc}>
              <Hero
                label="残高"
                value={formatBalance(now.amount)}
                minus={now.amount < 0}
                note={
                  now.confirmed === null
                    ? '記録の合計です。記録は使い始めからなので、いまの残高を入れて合わせてください'
                    : `${fullDate(now.confirmed.balanceOn)}に補正した ${formatBalance(now.confirmed.amount)} に、そのあとの記録${now.count}件（${formatSignedYen(now.movement)}）を足した額`
                }
              >
                {billing !== null && billing.billed + billing.unbilled > 0 && (
                  <>
                    <StatRow
                      label="請求済み"
                      note={billing.payOn ? `${monthDayLabel(billing.payOn)}に引き落とし` : '引き落とし待ち'}
                      value={formatBalance(-billing.billed)}
                      minus={billing.billed > 0}
                    />
                    <StatRow
                      label="未請求"
                      note={`${monthDayLabel(billing.closedOn)}の締め日のあとの利用`}
                      value={formatBalance(-billing.unbilled)}
                      minus={billing.unbilled > 0}
                    />
                  </>
                )}
              </Hero>
              <PrimaryButton label="残高を補正する" onPress={() => setCorrecting(true)} />

              <SectionHeader title="補正の履歴" hint="通帳・銀行のアプリと違うときに入れます" />
              {checks.length === 0 ? (
                <Text style={styles.empty}>まだ補正していません</Text>
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
                        accessibilityLabel={`${monthDayLabel(check.balance.balanceOn)}の補正を取り消す`}
                        onPress={() => remove(check.balance)}
                        hitSlop={8}
                      >
                        <Trash2 size={16} color={colors.textFaint} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>

      {correcting && (
        <BalanceSheet
          wallet={wallet}
          records={records}
          balances={balances}
          onClose={() => setCorrecting(false)}
          onSubmit={(balanceOn, amount) => {
            setCorrecting(false);
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
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
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
  calc: { paddingTop: 12, gap: 12 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
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
