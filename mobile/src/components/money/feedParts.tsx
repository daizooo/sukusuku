import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { WALLET_TYPES } from '@/lib/moneyUtils';
import { WalletTypeIcon } from '@/components/money/moneyVisual';

// Zaim 取り込みの画面（未確認の一覧・家計の設定の「Zaim 取り込み」）で使う小さな部品。
// PWA版の `src/components/sukusuku/money/feedParts.tsx` と同じ見た目。

/** 小さな選択の札（向き・動きなど）。選んだものは淡い青。 */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

/** 見出しつきの欄。 */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

/** 入・切の行（「次から同じ内容は自動で」など）。 */
export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleText}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

/** 出金元を1つ選ぶ一覧（種類ごと）。exclude は出さない出金元。 */
export function WalletChoices({
  wallets,
  selectedId,
  onPick,
  exclude,
}: {
  wallets: MoneyWallet[];
  selectedId: string | null;
  onPick: (walletId: string) => void;
  exclude?: string | null;
}) {
  const usable = wallets.filter((wallet) => !wallet.archived && wallet.id !== exclude);
  return (
    <View style={styles.wallets}>
      {WALLET_TYPES.map((walletType) => {
        const inType = usable.filter((wallet) => wallet.type === walletType.id);
        if (inType.length === 0) return null;
        return (
          <View key={walletType.id} style={styles.walletGroup}>
            <Text style={styles.groupTitle}>{walletType.label}</Text>
            {inType.map((wallet) => {
              const selected = wallet.id === selectedId;
              return (
                <Pressable
                  key={wallet.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onPick(wallet.id)}
                  style={[styles.walletRow, selected && styles.walletRowSelected]}
                >
                  <WalletTypeIcon type={wallet.type} size={20} color={wallet.iconColor} />
                  <Text style={styles.walletName} numberOfLines={1}>
                    {wallet.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.moneyRing, backgroundColor: colors.moneySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  chipTextSelected: { color: colors.moneyText, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  hint: { fontSize: 12, fontWeight: '500', lineHeight: 18, color: colors.textMuted },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  wallets: { gap: 10 },
  walletGroup: { gap: 4 },
  groupTitle: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  walletRowSelected: { borderColor: colors.moneyRing, backgroundColor: colors.moneySurface },
  walletName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
});
