import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { X } from 'lucide-react-native';
import { formatDateWithWeekday, parseDateString, toDateString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { FieldLabel } from '@/components/ui/form';

/**
 * 契約の日付の欄（開始日・更新日）。端末のピッカーで選び、×で空に戻せる。
 * 空のままでよい日付なので、記録の日時（DateTimeField）とは別に作った。
 */
export default function ContractDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  /** 'YYYY-MM-DD'。未設定なら null。 */
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const current = value ? parseDateString(value) : null;

  const open = () =>
    DateTimePickerAndroid.open({
      value: current ?? new Date(),
      mode: 'date',
      onChange: (_event, picked) => {
        if (picked) onChange(toDateString(picked));
      },
    });

  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={open} style={styles.input}>
          <Text style={[styles.text, !current && styles.placeholder]}>
            {current ? formatDateWithWeekday(current) : '未設定'}
          </Text>
        </Pressable>
        {current && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}を空にする`}
            onPress={() => onChange(null)}
            hitSlop={8}
            style={styles.clear}
          >
            <X size={16} color={colors.textFaint} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  text: { fontSize: 14, fontWeight: '500', color: colors.text, fontVariant: ['tabular-nums'] },
  placeholder: { color: colors.textFaint },
  clear: { padding: 4 },
});
