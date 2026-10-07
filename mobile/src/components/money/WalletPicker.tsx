import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Check, Pencil, Plus } from 'lucide-react-native';
import type { MoneyWallet, MoneyWalletDraft, MoneyWalletType } from '@/types/app';
import { colors } from '@/lib/theme';
import { WALLET_TYPES } from '@/lib/moneyUtils';
import { parseAmountInput } from '@/lib/specialUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 出金元の選択（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/WalletPicker.tsx` と同じ並び・文言。
// 種類（財布・カード・口座…）ごとに並べる。ここで出金元を足す・直す・使わなくする。

interface WalletPickerProps {
  title: string;
  wallets: MoneyWallet[];
  selectedId: string | null;
  onPick: (walletId: string) => void;
  onClose: () => void;
  onSave: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchive: (wallet: MoneyWallet) => void;
}

export default function WalletPicker({ title, wallets, selectedId, onPick, onClose, onSave, onArchive }: WalletPickerProps) {
  const [editing, setEditing] = useState<MoneyWallet | 'new' | null>(null);
  const usable = wallets.filter((wallet) => !wallet.archived);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={title} icon="back" onClose={onClose} />
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
              {inType.map((wallet) => {
                const selected = wallet.id === selectedId;
                return (
                  <Pressable
                    key={wallet.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onPick(wallet.id)}
                    style={[styles.row, selected && styles.rowSelected]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.name}>{wallet.name}</Text>
                      {wallet.isSaving && <Text style={styles.sub}>貯金用</Text>}
                    </View>
                    {selected && <Check size={18} color={colors.money} />}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${wallet.name}を編集`}
                      onPress={() => setEditing(wallet)}
                      hitSlop={8}
                      style={styles.edit}
                    >
                      <Pencil size={16} color={colors.textFaint} />
                    </Pressable>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
        <Pressable accessibilityRole="button" onPress={() => setEditing('new')} style={styles.add}>
          <Plus size={18} color={colors.money} />
          <Text style={styles.addText}>出金元を足す</Text>
        </Pressable>
      </ScrollView>

      {editing !== null && (
        <WalletSheet
          key={editing === 'new' ? 'new' : editing.id}
          wallet={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (draft) => {
            const target = editing === 'new' ? null : editing;
            setEditing(null);
            const saved = await onSave(target, draft);
            // 足したばかりの出金元は、そのまま選ぶ。
            if (saved && target === null) onPick(saved.id);
          }}
          onArchive={
            editing === 'new'
              ? undefined
              : () => {
                  const target = editing;
                  setEditing(null);
                  onArchive(target);
                }
          }
        />
      )}
    </View>
  );
}

function WalletSheet({
  wallet,
  onClose,
  onSubmit,
  onArchive,
}: {
  wallet: MoneyWallet | null;
  onClose: () => void;
  onSubmit: (draft: MoneyWalletDraft) => void;
  onArchive?: () => void;
}) {
  const [name, setName] = useState(wallet?.name ?? '');
  const [type, setType] = useState<MoneyWalletType>(wallet?.type ?? 'card');
  const [isSaving, setIsSaving] = useState(wallet?.isSaving ?? false);
  const [target, setTarget] = useState(wallet?.savingTarget != null ? String(wallet.savingTarget) : '');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (name.trim() === '') return setError('名前を入れてください');
    const savingTarget = target.trim() === '' ? null : parseAmountInput(target);
    if (isSaving && target.trim() !== '' && savingTarget === null) return setError('目標は0以上の整数（円）で入れてください');
    onSubmit({ name, type, isSaving, savingTarget: isSaving ? savingTarget : null });
  };

  const archive = () =>
    Alert.alert(`${wallet?.name ?? ''}を使わなくしますか？`, '選べなくなりますが、記録には残ります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '使わなくする', style: 'destructive', onPress: () => onArchive?.() },
    ]);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={wallet ? '出金元を編集' : '出金元を足す'}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" onPress={submit} />
            {onArchive && (
              <Pressable accessibilityRole="button" onPress={archive} style={styles.secondary}>
                <Text style={styles.deleteText}>使わなくする</Text>
              </Pressable>
            )}
          </>
        }
      >
        <View style={styles.field}>
          <Text style={styles.label}>名前</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="例: 〇〇カード（家族）"
            placeholderTextColor={colors.textFaint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>種類</Text>
          <View style={styles.types}>
            {WALLET_TYPES.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityState={{ selected: type === entry.id }}
                onPress={() => setType(entry.id)}
                style={[styles.type, type === entry.id && styles.typeSelected]}
              >
                <Text style={[styles.typeText, type === entry.id && styles.typeTextSelected]}>{entry.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={styles.label}>貯金用</Text>
            <Text style={styles.sub}>ここへの振替を貯金として数えます</Text>
          </View>
          <Switch value={isSaving} onValueChange={setIsSaving} />
        </View>
        {isSaving && (
          <View style={styles.field}>
            <Text style={styles.label}>月の貯金の目標（円）</Text>
            <TextInput
              style={styles.input}
              value={target}
              onChangeText={setTarget}
              keyboardType="number-pad"
              placeholder="任意"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  section: { gap: 4 },
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
  rowSelected: { borderColor: colors.moneySoft, backgroundColor: colors.moneySurface },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  edit: { padding: 4 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  type: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.neutralSurface },
  typeSelected: { backgroundColor: colors.moneySoft },
  typeText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  typeTextSelected: { color: colors.moneyText },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
