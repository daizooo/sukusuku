import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { MoneyWallet, MoneyWalletDraft, MoneyWalletType } from '@/types/app';
import { colors } from '@/lib/theme';
import { groupWalletSections, PAY_MONTH_OPTIONS, WALLET_DELETE_NOTE, WALLET_ICON_COLORS, WALLET_TYPES } from '@/lib/moneyUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { PrimaryButton, ScreenHeader, WalletTypeIcon } from '@/components/money/moneyVisual';

// 出金元の選択（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/WalletPicker.tsx` と同じ並び・文言。
// 口座の画面（MoneyAccountsView）と同じく、種類（財布・カード・口座…）ごとの見出し＋2列のタイルで、
// 1画面に収める。ここでは選ぶだけ（足す・直す・削除は口座の画面で行う）。

interface WalletPickerProps {
  title: string;
  wallets: MoneyWallet[];
  selectedId: string | null;
  onPick: (walletId: string) => void;
  onClose: () => void;
}

export default function WalletPicker({ title, wallets, selectedId, onPick, onClose }: WalletPickerProps) {
  const usable = wallets.filter((wallet) => !wallet.archived);
  const blocks = groupWalletSections(
    WALLET_TYPES.map((type) => ({ type, rows: usable.filter((wallet) => wallet.type === type.id) })).filter(
      (section) => section.rows.length > 0,
    ),
  );

  // paired は「1件だけの種類を2つ横に並べた」ときで、タイルは区画の幅いっぱいに広げる。
  const renderSection = ({ type, rows }: (typeof blocks)[number][number], paired: boolean) => (
    <View key={type.id} style={[styles.section, paired && styles.sectionPaired]}>
      <Text style={styles.sectionTitle}>{type.label}</Text>
      <View style={styles.grid}>
        {rows.map((wallet) => {
          const selected = wallet.id === selectedId;
          return (
            <Pressable
              key={wallet.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onPick(wallet.id)}
              style={[styles.tile, paired && styles.tilePaired, selected && styles.tileSelected]}
            >
              <WalletTypeIcon type={wallet.type} size={20} color={wallet.iconColor} />
              <Text style={styles.tileName} numberOfLines={2}>
                {wallet.name}
              </Text>
              {selected && <Check size={16} color={colors.money} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader title={title} icon="back" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content}>
        {usable.length === 0 && (
          <Text style={styles.empty}>出金元がまだありません。口座の画面から足してください</Text>
        )}
        {blocks.map((block) =>
          block.length === 1 ? (
            renderSection(block[0], false)
          ) : (
            <View key={block.map((section) => section.type.id).join('+')} style={styles.pairRow}>
              {block.map((section) => renderSection(section, true))}
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}

/** 「15」→ 15。1〜31 でなければ null（31 は末日）。 */
const parseDay = (text: string): number | null => {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
};

export function WalletSheet({
  wallet,
  wallets,
  onClose,
  onSubmit,
  onDelete,
}: {
  wallet: MoneyWallet | null;
  /** 引き落とし口座の候補に使う。 */
  wallets: MoneyWallet[];
  onClose: () => void;
  onSubmit: (draft: MoneyWalletDraft) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(wallet?.name ?? '');
  const [type, setType] = useState<MoneyWalletType>(wallet?.type ?? 'card');
  const [iconColor, setIconColor] = useState<string | null>(wallet?.iconColor ?? null);
  const [closeDay, setCloseDay] = useState(wallet?.closeDay ? String(wallet.closeDay) : '');
  const [payDay, setPayDay] = useState(wallet?.payDay ? String(wallet.payDay) : '');
  const [payMonthOffset, setPayMonthOffset] = useState<number | null>(wallet?.payMonthOffset ?? null);
  const [payWalletId, setPayWalletId] = useState<string | null>(wallet?.payWalletId ?? null);
  const [error, setError] = useState<string | null>(null);
  const payChoices = wallets.filter(
    (entry) => entry.type !== 'card' && entry.id !== wallet?.id && (!entry.archived || entry.id === payWalletId),
  );

  const submit = () => {
    if (name.trim() === '') return setError('名前を入れてください');
    const close = closeDay.trim() === '' ? null : parseDay(closeDay);
    const pay = payDay.trim() === '' ? null : parseDay(payDay);
    if (type === 'card' && ((closeDay.trim() !== '' && close === null) || (payDay.trim() !== '' && pay === null))) {
      return setError('締め日・引き落とし日は 1〜31 で入れてください（末日は31）');
    }
    onSubmit({
      name,
      type,
      closeDay: type === 'card' ? close : null,
      payDay: type === 'card' ? pay : null,
      payMonthOffset: type === 'card' ? payMonthOffset : null,
      payWalletId: type === 'card' ? payWalletId : null,
      iconColor,
    });
  };

  const remove = () =>
    Alert.alert(`${wallet?.name ?? ''}を削除しますか？`, WALLET_DELETE_NOTE, [
      { text: 'やめる', style: 'cancel' },
      { text: '削除する', style: 'destructive', onPress: () => onDelete?.() },
    ]);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={wallet ? '出金元を編集' : '出金元を足す'}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" onPress={submit} />
            {onDelete && (
              <Pressable accessibilityRole="button" onPress={remove} style={styles.secondary}>
                <Text style={styles.deleteText}>削除する</Text>
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
        <View style={styles.field}>
          <Text style={styles.label}>アイコンの色</Text>
          <View style={styles.colors}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="標準の色"
              accessibilityState={{ selected: iconColor === null }}
              onPress={() => setIconColor(null)}
              style={[styles.swatch, styles.swatchDefault, iconColor === null && styles.swatchSelected]}
            >
              <WalletTypeIcon type={type} size={18} />
            </Pressable>
            {WALLET_ICON_COLORS.map((entry) => (
              <Pressable
                key={entry.color}
                accessibilityRole="button"
                accessibilityLabel={entry.label}
                accessibilityState={{ selected: iconColor === entry.color }}
                onPress={() => setIconColor(entry.color)}
                style={[styles.swatch, { backgroundColor: entry.color }, iconColor === entry.color && styles.swatchSelected]}
              >
                {iconColor === entry.color && <Check size={18} color="#ffffff" />}
              </Pressable>
            ))}
          </View>
          <Text style={styles.sub}>左端は種類ごとの標準の色です</Text>
        </View>
        {type === 'card' && (
          <>
            <View style={styles.days}>
              <View style={[styles.field, styles.flex]}>
                <Text style={styles.label}>締め日</Text>
                <TextInput
                  style={styles.input}
                  value={closeDay}
                  onChangeText={setCloseDay}
                  keyboardType="number-pad"
                  placeholder="例: 15（末日は31）"
                  placeholderTextColor={colors.textFaint}
                />
              </View>
              <View style={[styles.field, styles.flex]}>
                <Text style={styles.label}>引き落とし日</Text>
                <TextInput
                  style={styles.input}
                  value={payDay}
                  onChangeText={setPayDay}
                  keyboardType="number-pad"
                  placeholder="例: 10"
                  placeholderTextColor={colors.textFaint}
                />
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>引き落とし月</Text>
              <View style={styles.types}>
                {PAY_MONTH_OPTIONS.map((option) => (
                  <Pressable
                    key={option.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: payMonthOffset === option.offset }}
                    onPress={() => setPayMonthOffset(option.offset)}
                    style={[styles.type, payMonthOffset === option.offset && styles.typeSelected]}
                  >
                    <Text style={[styles.typeText, payMonthOffset === option.offset && styles.typeTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sub}>
                自動は、締め日のあとに来る最初の引き落とし日です。「翌々月」は、月末締めの翌々月2日払いなど、締め日の月から数えて払うカード用です
              </Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>引き落とし口座</Text>
              <View style={styles.types}>
                {payChoices.map((entry) => (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: payWalletId === entry.id }}
                    onPress={() => setPayWalletId(payWalletId === entry.id ? null : entry.id)}
                    style={[styles.type, payWalletId === entry.id && styles.typeSelected]}
                  >
                    <Text style={[styles.typeText, payWalletId === entry.id && styles.typeTextSelected]}>{entry.name}</Text>
                  </Pressable>
                ))}
                {payChoices.length === 0 && <Text style={styles.sub}>口座を出金元に足すと選べます</Text>}
              </View>
              <Text style={styles.sub}>
                3つそろうと、引き落とし日（休日は翌営業日）に、締め日で区切った1か月分の合計で「口座 → カード」の振替を見込みで作ります
              </Text>
            </View>
          </>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 12, gap: 8, paddingBottom: 24 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  section: { gap: 3 },
  sectionPaired: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, paddingHorizontal: 4 },
  pairRow: { flexDirection: 'row', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tilePaired: { width: '100%' },
  tileSelected: { borderColor: colors.moneySoft, backgroundColor: colors.moneySurface },
  tileName: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 16, color: colors.text },
  sub: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
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
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchDefault: { backgroundColor: colors.neutralSurface },
  swatchSelected: { borderWidth: 3, borderColor: colors.text },
  days: { flexDirection: 'row', gap: 12 },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
