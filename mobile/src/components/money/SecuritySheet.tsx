import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { MoneyHolding, MoneyHoldingAccount, MoneySecurity, MoneySecurityDraft, MoneySecurityKind } from '@/types/app';
import { colors } from '@/lib/theme';
import { HOLDING_ACCOUNTS, SECURITY_KINDS } from '@/lib/moneyUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { PrimaryButton } from '@/components/money/moneyVisual';

// 銘柄の追加・編集（docs/kakei.md §9.2.4）。PWA版の `src/components/sukusuku/money/SecuritySheet.tsx` と同じ項目・文言。
// 種類（米国株・投資信託・預り金）・名前・コード、預り区分ごとの保有数と取得単価（円）。
// 保有数を空・0 にした区分は使わなくする。価格はサーバーが取る（足したときに過去1年分も）。

interface SecuritySheetProps {
  security: MoneySecurity | null;
  /** この口座での保有（編集のとき、預り区分ごとの今の値を出す）。 */
  holdings: MoneyHolding[];
  onClose: () => void;
  onSubmit: (draft: MoneySecurityDraft) => void;
  onArchive?: () => void;
}

const parseNumber = (text: string): number | null => {
  const value = Number(text.replace(/,/g, '').trim());
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : null;
};

export default function SecuritySheet({ security, holdings, onClose, onSubmit, onArchive }: SecuritySheetProps) {
  const [kind, setKind] = useState<MoneySecurityKind>(security?.kind ?? 'us_stock');
  const [name, setName] = useState(security?.name ?? '');
  const [code, setCode] = useState(security?.code ?? '');
  const [fundCode, setFundCode] = useState(security?.fundCode ?? '');
  const [currency, setCurrency] = useState<'JPY' | 'USD'>(security?.currency ?? 'USD');
  const initial = (account: MoneyHoldingAccount) => holdings.find((holding) => holding.account === account && !holding.archived);
  const [quantities, setQuantities] = useState<Record<MoneyHoldingAccount, string>>(() =>
    Object.fromEntries(HOLDING_ACCOUNTS.map((entry) => [entry.id, initial(entry.id) ? String(initial(entry.id)?.quantity) : ''])) as Record<
      MoneyHoldingAccount,
      string
    >,
  );
  const [costs, setCosts] = useState<Record<MoneyHoldingAccount, string>>(() =>
    Object.fromEntries(
      HOLDING_ACCOUNTS.map((entry) => {
        const cost = initial(entry.id)?.costPrice;
        return [entry.id, cost === null || cost === undefined ? '' : String(cost)];
      }),
    ) as Record<MoneyHoldingAccount, string>,
  );
  const [error, setError] = useState<string | null>(null);

  const chooseKind = (next: MoneySecurityKind) => {
    setKind(next);
    if (next === 'us_stock') setCurrency('USD');
    if (next === 'jp_fund') setCurrency('JPY');
  };

  const submit = () => {
    if (name.trim() === '') return setError('名前を入れてください');
    if (kind === 'us_stock' && code.trim() === '') return setError('ティッカーを入れてください');
    if (kind === 'jp_fund' && (code.trim() === '' || fundCode.trim() === '')) {
      return setError('ISINコードと協会コードを入れてください');
    }
    const entries: MoneySecurityDraft['holdings'] = [];
    for (const entry of HOLDING_ACCOUNTS) {
      const quantityText = quantities[entry.id];
      const costText = costs[entry.id];
      const quantity = quantityText.trim() === '' ? 0 : parseNumber(quantityText);
      const costPrice = costText.trim() === '' ? null : parseNumber(costText);
      if (quantity === null || (costText.trim() !== '' && costPrice === null)) {
        return setError('保有数・取得単価は数字で入れてください');
      }
      entries.push({ account: entry.id, quantity, costPrice });
    }
    if (entries.every((entry) => entry.quantity === 0) && security === null) return setError('保有数を入れてください');
    onSubmit({
      name: name.trim(),
      kind,
      code: kind === 'cash' ? null : code.trim().toUpperCase(),
      fundCode: kind === 'jp_fund' ? fundCode.trim().toUpperCase() : null,
      currency,
      holdings: entries,
    });
  };

  const archive = () =>
    Alert.alert(`${security?.name ?? ''}を一覧から外しますか？`, '売ったときに。これまでの評価額の推移は残ります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '外す', style: 'destructive', onPress: () => onArchive?.() },
    ]);

  const accounts = kind === 'cash' ? HOLDING_ACCOUNTS.filter((entry) => entry.id === 'tokutei') : HOLDING_ACCOUNTS;

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={security ? '銘柄を編集' : '銘柄を足す'}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" onPress={submit} />
            {onArchive && (
              <Pressable accessibilityRole="button" onPress={archive} style={styles.secondary}>
                <Text style={styles.deleteText}>一覧から外す</Text>
              </Pressable>
            )}
          </>
        }
      >
        <View style={styles.field}>
          <Text style={styles.label}>種類</Text>
          <View style={styles.chips}>
            {SECURITY_KINDS.map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === entry.id }}
                onPress={() => chooseKind(entry.id)}
                style={[styles.chip, kind === entry.id && styles.chipSelected]}
              >
                <Text style={[styles.chipText, kind === entry.id && styles.chipTextSelected]}>{entry.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>名前</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={colors.textFaint} />
        </View>
        {kind === 'us_stock' && (
          <View style={styles.field}>
            <Text style={styles.label}>ティッカー</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="例: VTI"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        )}
        {kind === 'jp_fund' && (
          <View style={styles.row}>
            <View style={[styles.field, styles.flex]}>
              <Text style={styles.label}>ISINコード</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="JP90C000…"
                placeholderTextColor={colors.textFaint}
              />
            </View>
            <View style={[styles.field, styles.flex]}>
              <Text style={styles.label}>協会コード</Text>
              <TextInput
                style={styles.input}
                value={fundCode}
                onChangeText={setFundCode}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholderTextColor={colors.textFaint}
              />
            </View>
          </View>
        )}
        {kind === 'cash' && (
          <View style={styles.field}>
            <Text style={styles.label}>通貨</Text>
            <View style={styles.chips}>
              {(['USD', 'JPY'] as const).map((entry) => (
                <Pressable
                  key={entry}
                  accessibilityRole="button"
                  accessibilityState={{ selected: currency === entry }}
                  onPress={() => setCurrency(entry)}
                  style={[styles.chip, currency === entry && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, currency === entry && styles.chipTextSelected]}>
                    {entry === 'USD' ? '米ドル' : '円'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {kind !== 'cash' && (
          <View style={[styles.row, styles.columns]}>
            <Text style={[styles.label, styles.flex]}>{kind === 'jp_fund' ? '口数' : '株数'}</Text>
            <Text style={[styles.label, styles.flex]}>{kind === 'jp_fund' ? '取得単価（1万口）' : '取得単価（円）'}</Text>
          </View>
        )}
        {accounts.map((entry) => (
          <View key={entry.id} style={styles.field}>
            {kind !== 'cash' && <Text style={styles.account}>{entry.label}</Text>}
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flex]}
                value={quantities[entry.id]}
                onChangeText={(text) => setQuantities((prev) => ({ ...prev, [entry.id]: text }))}
                keyboardType="decimal-pad"
                accessibilityLabel={kind === 'cash' ? '額' : `${entry.label}の${kind === 'jp_fund' ? '口数' : '株数'}`}
                placeholder={kind === 'cash' ? '額' : undefined}
                placeholderTextColor={colors.textFaint}
              />
              {kind !== 'cash' && (
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={costs[entry.id]}
                  onChangeText={(text) => setCosts((prev) => ({ ...prev, [entry.id]: text }))}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`${entry.label}の取得単価`}
                />
              )}
            </View>
          </View>
        ))}
        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { gap: 6 },
  row: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  account: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  columns: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.neutralSurface },
  chipSelected: { backgroundColor: colors.moneySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  chipTextSelected: { color: colors.moneyText },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
