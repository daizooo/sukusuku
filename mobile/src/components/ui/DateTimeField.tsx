import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { formatDateWithWeekday, formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { FieldLabel } from '@/components/ui/form';

// 記録の日時。Web版は <input type="date"> / <input type="time"> だったが、
// React Nativeにはそれが無いので端末のピッカーを開く形にする。

interface DateTimeFieldProps {
  label: string;
  value: Date;
  onChange: (value: Date) => void;
  /** 未来の記録は付けられないので、既定では今日までしか選べないようにする。 */
  maximumDate?: Date;
}

export default function DateTimeField({ label, value, onChange, maximumDate }: DateTimeFieldProps) {
  const openDate = () =>
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      maximumDate,
      onChange: (_event, picked) => {
        if (!picked) return;
        // 日付だけ差し替える（時刻はそのまま）。
        const next = new Date(value);
        next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
        onChange(next);
      },
    });

  const openTime = () =>
    DateTimePickerAndroid.open({
      value,
      mode: 'time',
      is24Hour: true,
      onChange: (_event, picked) => {
        if (!picked) return;
        const next = new Date(value);
        next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
        onChange(next);
      },
    });

  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={openDate} style={[styles.chip, styles.dateChip]}>
          <Text style={styles.chipText}>{formatDateWithWeekday(value)}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={openTime} style={[styles.chip, styles.timeChip]}>
          <Text style={styles.chipText}>{formatTimeString(value)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  dateChip: { flex: 2 },
  timeChip: { flex: 1 },
  chipText: { fontSize: 15, color: colors.text, fontWeight: '500' },
});
