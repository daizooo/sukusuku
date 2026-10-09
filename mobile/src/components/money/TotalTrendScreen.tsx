import { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MoneyRecord, MoneySecuritiesData, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { totalDailyBalances } from '@/lib/moneyUtils';
import BalanceTrend from '@/components/money/BalanceTrend';
import { ScreenHeader, type } from '@/components/money/moneyVisual';

// 総残高の推移（docs/kakei.md §9.3）。PWA版の `src/components/sukusuku/money/TotalTrendScreen.tsx` と同じ並び・文言。
// 「口座」の総残高を押すと開く。使っている出金元の合計（証券口座は評価額。docs/kakei.md §9.2.3）を、日ごとの折れ線と、残高が変わった日の一覧で見る。
// 戻る操作（スマホの戻るボタン）でこの画面を閉じる。

interface TotalTrendScreenProps {
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  securities: MoneySecuritiesData;
  today: string;
  onClose: () => void;
}

export default function TotalTrendScreen({ wallets, records, balances, securities, today, onClose }: TotalTrendScreenProps) {
  const insets = useSafeAreaInsets();
  // 証券の評価額は毎日変わるので、証券口座があるときは「残高が変わった日」の一覧を出さない（毎日の行になる）。
  const hasSecurities = wallets.some((wallet) => wallet.type === 'securities' && !wallet.archived);
  // 証券口座があるときは、評価額の履歴が読めるまで推移を出さない（最新の1行だけで描くと、過去が崩れる）。
  const waiting = hasSecurities && !securities.historyLoaded;
  const points = useMemo(
    () => (waiting ? [] : totalDailyBalances(wallets, records, balances, securities, today)),
    [waiting, wallets, records, balances, securities, today],
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title="残高の推移" icon="back" onClose={onClose} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[type.sub, styles.subtitle]}>総残高</Text>
          <BalanceTrend points={points} asOf={today} showHistory={!hasSecurities} emptyText={waiting ? '読み込み中...' : undefined} />
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
