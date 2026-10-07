import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pencil, Plus } from 'lucide-react-native';
import type { MoneyWallet, MoneyWalletDraft } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { WALLET_TYPES } from '@/lib/moneyUtils';
import { archiveMoneyWallet, insertMoneyWallet, restoreMoneyWallet, updateMoneyWallet } from '@/lib/api/money';
import { WalletSheet } from '@/components/money/WalletPicker';
import { ScreenHeader } from '@/components/money/moneyVisual';

// 出金元の設定（docs/kakei.md §3.5）。PWA版の `src/components/sukusuku/money/WalletSettings.tsx` と同じ並び・文言。
// 種類（財布・カード・口座…）ごとに並べ、足す・直す・使わなくする・また使う。記録の入力中の「出金元を選ぶ」と同じ編集の枠。

interface WalletSettingsProps {
  familyId: string;
  wallets: MoneyWallet[];
  onWallets: (update: (prev: MoneyWallet[]) => MoneyWallet[]) => void;
  onBack: () => void;
}

const byPosition = (a: MoneyWallet, b: MoneyWallet) => a.position - b.position;

export default function WalletSettings({ familyId, wallets, onWallets, onBack }: WalletSettingsProps) {
  const [editing, setEditing] = useState<MoneyWallet | 'new' | null>(null);
  const usable = wallets.filter((wallet) => !wallet.archived);
  const archived = wallets.filter((wallet) => wallet.archived);

  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');
  const put = (saved: MoneyWallet) =>
    onWallets((prev) => [...prev.filter((wallet) => wallet.id !== saved.id), saved].sort(byPosition));

  const save = async (target: MoneyWallet | null, draft: MoneyWalletDraft) => {
    setEditing(null);
    try {
      put(
        target === null
          ? await insertMoneyWallet(
              supabase,
              familyId,
              draft,
              wallets.reduce((max, wallet) => Math.max(max, wallet.position + 1), 0),
            )
          : await updateMoneyWallet(supabase, target.id, draft),
      );
    } catch {
      failed();
    }
  };

  const archive = async (wallet: MoneyWallet) => {
    setEditing(null);
    try {
      put(await archiveMoneyWallet(supabase, wallet.id));
    } catch {
      failed();
    }
  };

  const restore = async (wallet: MoneyWallet) => {
    try {
      put(await restoreMoneyWallet(supabase, wallet.id));
    } catch {
      failed();
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="出金元" icon="back" onClose={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {usable.length === 0 && (
          <Text style={styles.empty}>出金元がまだありません。カード・財布・口座などを足してください</Text>
        )}
        {WALLET_TYPES.map((type) => {
          const inType = usable.filter((wallet) => wallet.type === type.id);
          if (inType.length === 0) return null;
          return (
            <View key={type.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{type.label}</Text>
              {inType.map((wallet) => (
                <Pressable
                  key={wallet.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${wallet.name}を編集`}
                  onPress={() => setEditing(wallet)}
                  style={styles.row}
                >
                  <View style={styles.flex}>
                    <Text style={styles.name}>{wallet.name}</Text>
                    {wallet.isSaving && <Text style={styles.sub}>貯金用</Text>}
                  </View>
                  <Pencil size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>
          );
        })}
        <Pressable accessibilityRole="button" onPress={() => setEditing('new')} style={styles.add}>
          <Plus size={18} color={colors.money} />
          <Text style={styles.addText}>出金元を足す</Text>
        </Pressable>

        {archived.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>使わない出金元（記録には残っています）</Text>
            {archived.map((wallet) => (
              <View key={wallet.id} style={[styles.row, styles.archivedRow]}>
                <Text style={[styles.name, styles.flex]}>{wallet.name}</Text>
                <Pressable accessibilityRole="button" onPress={() => void restore(wallet)} hitSlop={8}>
                  <Text style={styles.link}>また使う</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {editing !== null && (
        <WalletSheet
          key={editing === 'new' ? 'new' : editing.id}
          wallet={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(editing === 'new' ? null : editing, draft)}
          onArchive={editing === 'new' ? undefined : () => void archive(editing)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  archivedRow: { opacity: 0.7 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  link: { fontSize: 13, fontWeight: '700', color: colors.money },
});
