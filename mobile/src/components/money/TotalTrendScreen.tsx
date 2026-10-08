import { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import { colors } from '@/lib/theme';
import { dailyBalances } from '@/lib/moneyUtils';
import BalanceTrend from '@/components/money/BalanceTrend';
import { ScreenHeader, type } from '@/components/money/moneyVisual';

// 総残高の推移（docs/kakei.md §9.3）。PWA版の `src/components/sukusuku/money/TotalTrendScreen.tsx` と同じ並び・文言。
// 「口座」の総残高を押すと開く。使っている出金元の合計を、日ごとの折れ線と、残高が変わった日の一覧で見る。
// 戻る操作（スマホの戻るボタン）でこの画面を閉じる。

interface TotalTrendScreenProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  today: string;
  onClose: () => void;
}

export default function TotalTrendScreen({ wallets, records, balances, today, onClose }: TotalTrendScreenProps) {
  const insets = useSafeAreaInsets();
  const points = useMemo(
    () =>
      dailyBalances(
        wallets.filter((wallet) => !wallet.archived).map((wallet) => wallet.id),
        records,
        balances,
        today,
      ),
    [wallets, records, balances, today],
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScreenHeader title="残高の推移" icon="back" onClose={onClose} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[type.sub, styles.subtitle]}>総残高</Text>
          <BalanceTrend points={points} asOf={today} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  subtitle: { paddingVertical: 10 },
});
