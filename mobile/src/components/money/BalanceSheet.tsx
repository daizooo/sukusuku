import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CalendarDays } from 'lucide-react-native';
import type { MoneyRecord, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import { colors } from '@/lib/theme';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
import { formatDateWithWeekday, toDateString } from '@/lib/dateUtils';
import { formatBalance, formatSignedYen, formatYen, walletBalanceOn } from '@/lib/moneyUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { PrimaryButton, type } from '@/components/money/moneyVisual';

// 残高を補正する（docs/kakei.md §9.3）。PWA版の `src/components/sukusuku/money/BalanceModal.tsx` と同じ並び・文言。
// 通帳・銀行のアプリの残高を日付つきで入れる。入れた額と、記録から出した額との差を、入れながら出す。
// はじめての補正は、記録から出した額も差も出さない（記録は使い始めの月からなので、はじめの残高になる）。余計な文字は入れない（2026-10-08）。
// カードの未払いのように、マイナスの残高も入れられる。

interface BalanceSheetProps {
  wallet: MoneyWallet;
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  onClose: () => void;
  onSubmit: (balanceOn: string, amount: number, showInHistory: boolean) => void;
}

export default function BalanceSheet({ wallet, records, balances, onClose, onSubmit }: BalanceSheetProps) {
  const today = toDateString(new Date());
  const [balanceOn, setBalanceOn] = useState(today);
  const [text, setText] = useState('');
  // カードは未払いの額が残高（マイナス）なので、はじめからマイナスにしておく。
  const [negative, setNegative] = useState(wallet.type === 'card');
  // ＋/− は、帯の上の左右スワイプでも切り替える。
  const signSwipeHandlers = useSwipeTabs([false, true], negative, setNegative);
  // 補正を口座の履歴に行として残すか。
  const [showInHistory, setShowInHistory] = useState(true);

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
            onPress={() => entered !== null && onSubmit(balanceOn, entered, showInHistory)}
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
            <View accessibilityRole="tablist" style={styles.sign} {...signSwipeHandlers}>
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

        <View style={styles.switchRow}>
          <Text style={styles.label}>履歴に残す</Text>
          <Switch value={showInHistory} onValueChange={setShowInHistory} />
        </View>
        {expected.confirmed !== null && (
          <View style={styles.check}>
            <View style={styles.checkRow}>
              <Text style={type.sub}>記録から出した額</Text>
              <Text style={[type.amount, expected.amount < 0 && type.minus]}>{formatBalance(expected.amount)}</Text>
            </View>
            {diff !== null && (
              <View style={styles.checkRow}>
                <Text style={type.sub}>差</Text>
                <Text style={[type.amount, diff !== 0 && type.minus]}>{diff === 0 ? formatYen(0) : formatSignedYen(diff)}</Text>
              </View>
            )}
          </View>
        )}
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
