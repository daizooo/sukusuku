import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil } from 'lucide-react-native';
import type { MoneySecuritiesData, MoneySecurity, MoneySecurityDraft, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  dateKeyOfDate,
  formatBalance,
  formatQuantity,
  formatSecurityPrice,
  holdingAccountLabel,
  holdingDailyValues,
  securityRows,
} from '@/lib/moneyUtils';
import BalanceTrend from '@/components/money/BalanceTrend';
import SecuritySheet from '@/components/money/SecuritySheet';
import { Gain, ScreenHeader, type } from '@/components/money/moneyVisual';

// 銘柄の詳細（docs/kakei.md §9.2.4）。PWA版の `src/components/sukusuku/money/SecurityScreen.tsx` と同じ並び・文言。
// 上に評価額と推移、下に詳細（評価損益・現在値・取得単価・保有数。保有数は預り区分ごと）。編集は見出しの鉛筆から。

interface SecurityScreenProps {
  wallet: MoneyWallet;
  security: MoneySecurity;
  securities: MoneySecuritiesData;
  onClose: () => void;
  onSave: (draft: MoneySecurityDraft) => void;
  onArchive: () => void;
}

export default function SecurityScreen({ wallet, security, securities, onClose, onSave, onArchive }: SecurityScreenProps) {
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const today = dateKeyOfDate(new Date());
  const row = useMemo(
    () => securityRows(wallet.id, securities, today).find((entry) => entry.security.id === security.id) ?? null,
    [wallet.id, securities, today, security.id],
  );
  const holdings = securities.holdings.filter((holding) => holding.walletId === wallet.id && holding.securityId === security.id);
  const points = useMemo(
    () =>
      holdingDailyValues(
        securities.holdings
          .filter((holding) => holding.walletId === wallet.id && holding.securityId === security.id)
          .map((holding) => holding.id),
        securities.values,
        today,
      ),
    [securities, wallet.id, security.id, today],
  );
  const shown = row?.holdings ?? [];
  const isCash = security.kind === 'cash';
  // 詳細の行（評価損益・現在値・取得単価・保有数。預り金は額だけ）。
  const details: { key: string; label: string; note?: string; value: ReactNode }[] = [];
  if (row?.gain != null) {
    details.push({ key: 'gain', label: '評価損益', value: <Gain gain={row.gain} rate={row.gainRate} /> });
  }
  if (!isCash) {
    details.push({
      key: 'price',
      label: '現在値',
      note: security.kind === 'jp_fund' ? '1万口あたり' : undefined,
      value: <Text style={type.amount}>{row?.price != null ? formatSecurityPrice(row.price, security.currency) : '−'}</Text>,
    });
    details.push({
      key: 'cost',
      label: '取得単価',
      value: <Text style={type.amount}>{row?.costPrice != null ? formatSecurityPrice(row.costPrice, 'JPY') : '−'}</Text>,
    });
  }
  for (const holding of shown) {
    details.push({
      key: holding.id,
      label: isCash ? '額' : '保有数',
      note: !isCash && shown.length > 1 ? holdingAccountLabel(holding.account) : undefined,
      value: (
        <Text style={type.amount}>
          {isCash ? formatSecurityPrice(holding.quantity, security.currency) : formatQuantity(holding.quantity, security.kind)}
        </Text>
      ),
    });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScreenHeader
          title={security.name}
          icon="back"
          onClose={onClose}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${security.name}を編集`}
              onPress={() => setEditing(true)}
              hitSlop={10}
            >
              <Pencil size={20} color={colors.textSubtle} />
            </Pressable>
          }
        />
        <View style={styles.summary}>
          <Text style={type.hero}>{formatBalance(row?.value ?? 0)}</Text>
          {row?.gain != null && <Gain gain={row.gain} rate={row.gainRate} />}
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <BalanceTrend points={points} asOf={today} showHistory={false} emptyText="まだ評価額がありません" />

          <View style={styles.card}>
            {details.map((detail, index) => (
              <View key={detail.key} style={[styles.row, index > 0 && styles.rowDivided]}>
                <View style={styles.flex}>
                  <Text style={type.row}>{detail.label}</Text>
                  {detail.note !== undefined && <Text style={type.faint}>{detail.note}</Text>}
                </View>
                {detail.value}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {editing && (
        <SecuritySheet
          security={security}
          holdings={holdings}
          onClose={() => setEditing(false)}
          onSubmit={(draft) => {
            setEditing(false);
            onSave(draft);
          }}
          onArchive={() => {
            setEditing(false);
            onArchive();
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
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
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
