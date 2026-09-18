import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ListPlus, Plus, Trash2 } from 'lucide-react-native';
import type { ProfileField, ProfileFieldKey } from '@/types/app';
import { formatDateString, parseDateString, toDateString } from '@/lib/dateUtils';
import { isPhoneNumberLike } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';

// 設定タブの1セクション。Web版の `tabs/InfoTab.tsx` の中にある
// FieldSection / FieldEditor / FieldValue を置き換えたもの。
// 各項目の見出し・内容を編集モードで自由に追加・削除できるところも同じ。

interface FieldSectionProps {
  title: string;
  icon: ReactNode;
  fields: ProfileField[];
  isEditing: boolean;
  onChangeField: (id: string, patch: Partial<Pick<ProfileField, 'label' | 'values'>>) => void;
  onRemoveField: (id: string) => void;
  onAddField: () => void;
}

export default function FieldSection({
  title,
  icon,
  fields,
  isEditing,
  onChangeField,
  onRemoveField,
  onAddField,
}: FieldSectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>

      {isEditing ? (
        <View style={styles.editors}>
          {fields.map((field) => (
            <FieldEditor
              key={field.id}
              field={field}
              onChangeField={onChangeField}
              onRemoveField={onRemoveField}
            />
          ))}
          <Pressable accessibilityRole="button" onPress={onAddField} style={styles.addField}>
            <ListPlus size={16} color={colors.navActiveText} />
            <Text style={styles.addFieldText}>見出しを追加</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          {fields.length === 0 && <Text style={styles.empty}>項目がありません</Text>}
          {fields.map((field, index) => {
            const filledValues = field.values.filter((value) => value.trim() !== '');
            return (
              <View key={field.id} style={[styles.readRow, index > 0 && styles.readRowDivided]}>
                <Text style={styles.readLabel}>{field.label || '未設定の見出し'}</Text>
                <View style={styles.readValues}>
                  {filledValues.length === 0 ? (
                    <Text style={styles.readValue}>未設定</Text>
                  ) : (
                    filledValues.map((value, i) => (
                      <FieldValue key={i} fieldKey={field.key} value={value} />
                    ))
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

interface FieldEditorProps {
  field: ProfileField;
  onChangeField: (id: string, patch: Partial<Pick<ProfileField, 'label' | 'values'>>) => void;
  onRemoveField: (id: string) => void;
}

// 1つの見出しの編集カード。見出しの下に内容を何件でも並べられる。
// ただしkeyを持つ項目（お誕生日や産院の電話番号など、他の画面がその値を参照する項目）は
// 内容が1件であることを前提にしているため、内容の追加・削除はできないようにしている。
function FieldEditor({ field, onChangeField, onRemoveField }: FieldEditorProps) {
  const allowsMultipleValues = !field.key;
  // 旧データの読み込みなどで内容が空になっていても、入力欄は必ず1つ描く。
  const values = field.values.length > 0 ? field.values : [''];

  const changeValue = (index: number, value: string) => {
    onChangeField(field.id, { values: values.map((current, i) => (i === index ? value : current)) });
  };

  const addValue = () => onChangeField(field.id, { values: [...values, ''] });
  const removeValue = (index: number) =>
    onChangeField(field.id, { values: values.filter((_, i) => i !== index) });

  // お誕生日は <input type="date"> にあたるものが無いので端末のピッカーで選ぶ。
  const openDatePicker = (index: number, value: string) =>
    DateTimePickerAndroid.open({
      value: parseDateString(value) ?? new Date(),
      mode: 'date',
      onChange: (_event, picked) => {
        if (picked) changeValue(index, toDateString(picked));
      },
    });

  return (
    <View style={styles.editor}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="この見出しを削除"
        onPress={() => onRemoveField(field.id)}
        hitSlop={6}
        style={styles.editorDelete}
      >
        <Trash2 size={14} color={colors.textFaint} />
      </Pressable>

      <View style={styles.editorBody}>
        <View>
          <Text style={styles.editorLabel}>見出し</Text>
          <TextInput
            style={styles.input}
            value={field.label}
            onChangeText={(label) => onChangeField(field.id, { label })}
            placeholder="例: ママの携帯番号"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View>
          <Text style={styles.editorLabel}>内容</Text>
          <View style={styles.valueList}>
            {values.map((value, index) => (
              <View key={index} style={styles.valueRow}>
                {field.key === 'birthDate' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="お誕生日を選ぶ"
                    onPress={() => openDatePicker(index, value)}
                    style={[styles.input, styles.flex]}
                  >
                    <Text style={value ? styles.inputText : styles.inputPlaceholder}>
                      {value ? formatDateString(parseDateString(value)) : '日付を選ぶ'}
                    </Text>
                  </Pressable>
                ) : (
                  <TextInput
                    style={[styles.input, styles.flex]}
                    value={value}
                    onChangeText={(next) => changeValue(index, next)}
                    placeholder="例: 090-1234-5678"
                    placeholderTextColor={colors.textFaint}
                  />
                )}
                {allowsMultipleValues && values.length > 1 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="この内容を削除"
                    onPress={() => removeValue(index)}
                    hitSlop={6}
                    style={styles.valueDelete}
                  >
                    <Trash2 size={14} color={colors.textFaint} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
          {allowsMultipleValues && (
            <Pressable accessibilityRole="button" onPress={addValue} style={styles.addValue}>
              <Plus size={14} color={colors.navActiveText} />
              <Text style={styles.addValueText}>内容を追加</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// 項目の内容を表示する。お誕生日は日付表示に、電話番号らしい値はタップで発信できるようにする。
function FieldValue({ fieldKey, value }: { fieldKey?: ProfileFieldKey; value: string }) {
  if (!value) return <Text style={styles.readValue}>未設定</Text>;

  if (fieldKey === 'birthDate') {
    const date = parseDateString(value);
    return <Text style={styles.readValue}>{date ? formatDateString(date) : value}</Text>;
  }

  if (isPhoneNumberLike(value)) {
    return (
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`tel:${value}`)}>
        <Text style={styles.readPhone}>{value}</Text>
      </Pressable>
    );
  }

  return <Text style={styles.readValue}>{value}</Text>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle, flexShrink: 1 },

  empty: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingVertical: 8 },
  readRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  readRowDivided: { borderTopWidth: 1, borderTopColor: colors.background },
  readLabel: { fontSize: 14, color: colors.textMuted, flexShrink: 1 },
  readValues: { flex: 1, alignItems: 'flex-end', gap: 2 },
  readValue: { fontSize: 14, fontWeight: '500', color: colors.textSubtle, textAlign: 'right' },
  readPhone: { fontSize: 14, fontWeight: '500', color: colors.navActiveText },

  editors: { gap: 12 },
  editor: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  editorDelete: { position: 'absolute', top: 8, right: 8, padding: 4, zIndex: 1 },
  editorBody: { paddingRight: 28, gap: 8 },
  editorLabel: { fontSize: 10, fontWeight: '500', color: colors.textMuted, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
    fontSize: 14,
    color: colors.textSubtle,
    backgroundColor: colors.surface,
  },
  inputText: { fontSize: 14, color: colors.textSubtle },
  inputPlaceholder: { fontSize: 14, color: colors.textFaint },
  valueList: { gap: 6 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  valueDelete: { padding: 4 },
  addValue: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6 },
  addValueText: { fontSize: 12, color: colors.navActiveText, flexShrink: 1 },
  addField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.diaperBorder,
    borderRadius: 8,
    paddingVertical: 10,
  },
  addFieldText: { fontSize: 14, color: colors.navActiveText, flexShrink: 1 },
});
