import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '@/lib/theme';

// 記録の入力画面で使う部品。Web版の `src/components/sukusuku/modals/logModalParts.tsx` にあたる。
// 色の当て方だけWeb版(Tailwind)から置き換えてあり、見出し・選択肢・メモ欄の作りは同じ。

/** 記録の種類ごとの差し色。ボタンや選択中の枠に使う。 */
export type Accent = 'milk' | 'diaper' | 'pumping' | 'temperature';

const ACCENT: Record<Accent, { color: string; surface: string; border: string }> = {
  milk: { color: colors.milk, surface: colors.milkSurface, border: colors.milkBorder },
  diaper: { color: colors.diaper, surface: colors.diaperSurface, border: colors.diaperBorder },
  pumping: { color: colors.pumping, surface: colors.pumpingSurface, border: colors.pumpingBorder },
  temperature: {
    color: colors.temperature,
    surface: colors.temperatureSurface,
    border: colors.temperatureBorder,
  },
};

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function HintBanner({ accent, children }: { accent: Accent; children: ReactNode }) {
  const tone = ACCENT[accent];
  return (
    <View style={[styles.hint, { backgroundColor: tone.surface, borderColor: tone.border }]}>
      <Text style={[styles.hintText, { color: tone.color }]}>{children}</Text>
    </View>
  );
}

interface Option<T> {
  value: T;
  label: string;
}

/** 「母乳 / 搾乳 / ミルク」のような、横に並ぶ切り替え。 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text numberOfLines={1} style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** よく使う値をボタンで選ぶ。列の数は項目に合わせて変える（量は5列、分数は7列）。 */
export function OptionGrid<T extends string | number>({
  options,
  value,
  onChange,
  columns,
  accent,
}: {
  options: Option<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  columns: number;
  accent: Accent;
}) {
  const tone = ACCENT[accent];
  // 列ごとに割合で幅を出すと、端数の丸めで合計が100%を超え、最後の1つだけ
  // 次の行へ落ちることがある。Web版のグリッドと同じ並びにするため、
  // 列の数ずつの行に切り分けて、1行の中を均等に分ける。
  const rows: Option<T>[][] = [];
  for (let i = 0; i < options.length; i += columns) rows.push(options.slice(i, i + columns));

  return (
    <View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.grid}>
          {row.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={String(option.value)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onChange(option.value)}
                style={styles.gridItem}
              >
                <View
                  style={[
                    styles.gridItemInner,
                    selected && { backgroundColor: tone.surface, borderColor: tone.color },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.gridItemText, selected && { color: tone.color, fontWeight: '700' }]}
                  >
                    {option.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {/* 最後の行が欠けても、ボタンの幅が他の行と変わらないようにする。 */}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`gap-${i}`} style={styles.gridItem} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function NumberInput({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      keyboardType="number-pad"
      inputMode="numeric"
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

export function NoteField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View>
      <FieldLabel>メモ</FieldLabel>
      <TextInput
        style={[styles.input, styles.noteInput]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        multiline
      />
    </View>
  );
}

export function SubmitButton({
  accent,
  disabled,
  onPress,
  children,
}: {
  accent: Accent;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.submit, { backgroundColor: ACCENT[accent].color }, disabled && styles.disabled]}
    >
      <Text style={styles.submitText}>{children}</Text>
    </Pressable>
  );
}

export function DeleteButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.delete}>
      <Text style={styles.deleteText}>この記録を削除する</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, marginBottom: 6 },
  hint: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  hintText: { fontSize: 12, lineHeight: 18 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.neutralSurface,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  segmentSelected: { backgroundColor: colors.surface },
  segmentText: { fontSize: 13, color: colors.textMuted },
  segmentTextSelected: { color: colors.text, fontWeight: '700' },
  grid: { flexDirection: 'row' },
  gridItem: { flex: 1, padding: 2 },
  gridItemInner: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  gridItemText: { fontSize: 13, color: colors.textSubtle },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  noteInput: { minHeight: 68, textAlignVertical: 'top' },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  delete: { paddingVertical: 12, alignItems: 'center' },
  deleteText: { fontSize: 13, color: colors.danger },
});
