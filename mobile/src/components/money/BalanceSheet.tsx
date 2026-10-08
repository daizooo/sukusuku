import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CalendarDays } from 'lucide-react-native';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import { colors } from '@/lib/theme';
import { formatDateWithWeekday, toDateString } from '@/lib/dateUtils';
import { formatBalance, formatShortDate, formatSignedYen, walletBalanceOn } from '@/lib/moneyUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { PrimaryButton, type } from '@/components/money/moneyVisual';

// 残高を補正する（docs/kakei.md §9.3）。PWA版の `src/components/sukusuku/money/BalanceModal.tsx` と同じ並び・文言。
// 通帳・銀行のアプリの残高を日付つきで入れる。入れた額と、記録から出した額との差を、入れながら出す。
// はじめての補正は差を出さない（記録は使い始めの月からなので、はじめの残高になる）。
// カードの未払いのように、マイナスの残高も入れられる。

interface BalanceSheetProps {
  wallet: MoneyWallet;
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  onClose: () => void;
  onSubmit: (balanceOn: string, amount: number) => void;
}

export default function BalanceSheet({ wallet, records, balances, onClose, onSubmit }: BalanceSheetProps) {
  const today = toDateString(new Date());
  const [balanceOn, setBalanceOn] = useState(today);
  const [text, setText] = useState('');
  // カードは未払いの額が残高（マイナス）なので、はじめからマイナスにしておく。
  const [negative, setNegative] = useState(wallet.type === 'card');

  const digits = text.replace(/[^0-9]/g, '');
  const entered = digits === '' ? null : (negative ? -1 : 1) * Number(digits);
  const expected = walletBalanceOn(wallet.id, balanceOn, records, balances, true);
  const diff = entered === null || expected.confirmed === null ? null : entered - expected.amount;

  const openDate = () =>
    DateTimePickerAndroid.open({
      value: new Date(`${balanceOn}T00:00:00`),
      mode: 'date',
      maximumDate: new Date(),
      onChange: (_event, picked) => {
        if (picked) setBalanceOn(toDateString(picked));
      },
    });

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={`${wallet.name}の残高を補正`}
        onClose={onClose}
        footer={
          <PrimaryButton
            label="補正する"
            disabled={entered === null}
            onPress={() => entered !== null && onSubmit(balanceOn, entered)}
          />
        }
      >
        <Pressable accessibilityRole="button" onPress={openDate} style={styles.field}>
          <CalendarDays size={20} color={colors.textMuted} />
          <Text style={styles.fieldText}>{formatDateWithWeekday(new Date(`${balanceOn}T00:00:00`))}の残高</Text>
        </Pressable>

        <View style={styles.group}>
          <Text style={styles.label}>通帳・銀行のアプリの残高</Text>
          <View style={styles.amountRow}>
            <View accessibilityRole="tablist" style={styles.sign}>
              {[
                { value: false, label: '＋' },
                { value: true, label: '−' },
              ].map((entry) => (
                <Pressable
                  key={entry.label}
                  accessibilityRole="tab"
                  accessibilityLabel={entry.value ? 'マイナス' : 'プラス'}
                  accessibilityState={{ selected: negative === entry.value }}
                  onPress={() => setNegative(entry.value)}
                  style={[styles.signItem, negative === entry.value && styles.signItemSelected]}
                >
                  <Text style={[styles.signText, negative === entry.value && styles.signTextSelected]}>{entry.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.yen}>¥</Text>
            <TextInput
              style={styles.input}
              value={digits === '' ? '' : Number(digits).toLocaleString('ja-JP')}
              onChangeText={(next) => setText(next.replace(/[^0-9]/g, '').slice(0, 9))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textFaint}
              autoFocus
            />
          </View>
        </View>

        <View style={styles.check}>
          <View style={styles.checkRow}>
            <Text style={type.sub}>記録から出した額</Text>
            <Text style={[type.amount, expected.amount < 0 && type.minus]}>{formatBalance(expected.amount)}</Text>
          </View>
          <Text style={type.faint}>
            {expected.confirmed === null
              ? 'まだ補正していないので、記録の合計です（参考）'
              : `${formatShortDate(expected.confirmed.balanceOn)}に補正した ${formatBalance(expected.confirmed.amount)} に、そのあとの記録${expected.count}件を足した額`}
          </Text>
          {diff !== null && (
            <View style={styles.checkRow}>
              <Text style={type.sub}>差</Text>
              <Text style={[type.amount, diff !== 0 && type.minus]}>{diff === 0 ? '記録と合っています' : formatSignedYen(diff)}</Text>
            </View>
          )}
          {diff !== null && diff !== 0 && (
            <Text style={type.faint}>
              記録の漏れ・二重・金額の違いがないか見直してください。このまま補正すると、これ以後はこの額から数えます
            </Text>
          )}
          {entered !== null && expected.confirmed === null && (
            <Text style={type.faint}>はじめての補正です。これ以後は、この額に記録を足して残高を出します</Text>
          )}
        </View>
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  fieldText: { fontSize: 15, fontWeight: '600', color: colors.text },
  group: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sign: { flexDirection: 'row', borderRadius: 999, backgroundColor: colors.neutralSurface, padding: 2 },
  signItem: { width: 36, paddingVertical: 6, alignItems: 'center', borderRadius: 999 },
  signItemSelected: { backgroundColor: colors.surface },
  signText: { fontSize: 16, fontWeight: '700', color: colors.textFaint },
  signTextSelected: { color: colors.text },
  yen: { fontSize: 20, fontWeight: '700', color: colors.textSubtle },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  check: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: colors.background },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
