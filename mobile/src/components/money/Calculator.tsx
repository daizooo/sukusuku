import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Delete } from 'lucide-react-native';
import { colors } from '@/lib/theme';

// 品目の金額を入れる電卓（docs/kakei.md §3.2。品目の画面で初めて出る）。＋−×÷ が使える。
// 押したキーを返すだけで、式の組み立ては moneyUtils の pressCalcKey。
// PWA版の `src/components/sukusuku/money/Calculator.tsx` と同じ並び。

const ROWS: { key: string; label: string; op?: boolean }[][] = [
  [{ key: '7', label: '7' }, { key: '8', label: '8' }, { key: '9', label: '9' }, { key: '/', label: '÷', op: true }],
  [{ key: '4', label: '4' }, { key: '5', label: '5' }, { key: '6', label: '6' }, { key: '*', label: '×', op: true }],
  [{ key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }, { key: '-', label: '−', op: true }],
  [{ key: '00', label: '00' }, { key: '0', label: '0' }, { key: 'back', label: '' }, { key: '+', label: '+', op: true }],
];

export default function Calculator({ onKey, disabled }: { onKey: (key: string) => void; disabled?: boolean }) {
  return (
    <View style={[styles.pad, disabled && styles.disabled]}>
      {ROWS.map((row, index) => (
        <View key={index} style={styles.row}>
          {row.map((entry) => (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityLabel={entry.key === 'back' ? '1文字消す' : entry.label}
              onPress={() => onKey(entry.key)}
              disabled={disabled}
              style={({ pressed }) => [styles.key, entry.op && styles.opKey, pressed && styles.pressed]}
            >
              {entry.key === 'back' ? (
                <Delete size={24} color={colors.text} />
              ) : (
                <Text style={[styles.keyText, entry.op && styles.opText]}>{entry.label}</Text>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', gap: 6 },
  key: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  opKey: { backgroundColor: colors.neutralSurface, marginHorizontal: 8 },
  pressed: { backgroundColor: colors.moneySurface },
  keyText: { fontSize: 24, fontWeight: '600', color: colors.text },
  opText: { fontSize: 22, fontWeight: '500', color: colors.textSubtle },
});
