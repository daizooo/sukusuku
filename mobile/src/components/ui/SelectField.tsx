import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { colors } from '@/lib/theme';

// 選択肢から1つ選ぶ欄。Web版の <select> にあたる。
//
// React Nativeには <select> が無いので、押すと選択肢を下から出して選ぶ形にする。
// 出している中身・並び・既定の文言はWeb版と同じ。

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** 閉じているときの見た目。絞り込みでは選んだ色を載せるため外から渡す。 */
  style?: object;
  textStyle?: object;
  /** 文字の前に出す印（絞り込みのじょうごなど）。 */
  icon?: React.ReactNode;
  chevronColor?: string;
}

export default function SelectField<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
  textStyle,
  icon,
  chevronColor,
}: SelectFieldProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() => setIsOpen(true)}
        style={[styles.field, style]}
      >
        {icon}
        <Text numberOfLines={1} style={[styles.fieldText, textStyle]}>
          {selected?.label ?? ''}
        </Text>
        <ChevronDown size={14} color={chevronColor ?? colors.textMuted} />
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{accessibilityLabel}</Text>
            <ScrollView>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    style={styles.option}
                  >
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  fieldText: { fontSize: 14, fontWeight: '700', color: colors.textSubtle, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 24,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  option: { paddingHorizontal: 12, paddingVertical: 14, borderRadius: 10 },
  optionText: { fontSize: 15, color: colors.text },
  optionTextSelected: { color: colors.navActiveText, fontWeight: '700' },
});
