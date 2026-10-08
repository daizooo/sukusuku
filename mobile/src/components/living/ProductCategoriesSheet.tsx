import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react-native';
import type { HouseholdProductCategory } from '@/types/app';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 日用品のカテゴリの一覧を直す（docs/home.md §4.1）。PWA版の
// `src/components/sukusuku/modals/ProductCategoriesModal.tsx` と同じ項目・同じ文言。
//
// 家族で共有する一覧。追加・名前を直す・並べ替え・削除ができる。品の編集では、ここから選ぶ。
// 名前を直すと、そのカテゴリの品も新しい名前になる。一覧にある名前へ直すと、1つにまとめる。
// 削除すると、そのカテゴリの品は「なし」になる。

interface ProductCategoriesSheetProps {
  categories: HouseholdProductCategory[];
  /** カテゴリごとの品の数（削除の確認に出す）。 */
  counts: Record<string, number>;
  onClose: () => void;
  onAdd: (name: string) => void;
  onRename: (category: HouseholdProductCategory, name: string) => void;
  onDelete: (category: HouseholdProductCategory) => void;
  onMove: (category: HouseholdProductCategory, offset: -1 | 1) => void;
}

function CategoryRow({
  category,
  isFirst,
  isLast,
  count,
  onRename,
  onDelete,
  onMove,
}: {
  category: HouseholdProductCategory;
  isFirst: boolean;
  isLast: boolean;
  count: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (offset: -1 | 1) => void;
}) {
  const [name, setName] = useState(category.name);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === category.name) {
      setName(category.name);
      return;
    }
    onRename(trimmed);
  };

  const confirmDelete = () =>
    Alert.alert(
      `「${category.name}」を削除しますか？`,
      count > 0 ? `このカテゴリの日用品${count}品は「なし」になります。` : undefined,
      [
        { text: 'やめる', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: onDelete },
      ],
    );

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.rowInput}
        value={name}
        onChangeText={setName}
        onEndEditing={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
        accessibilityLabel={`${category.name}の名前`}
      />
      <Text style={styles.count}>{count}品</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${category.name}を上へ`}
        disabled={isFirst}
        onPress={() => onMove(-1)}
        hitSlop={6}
        style={styles.iconButton}
      >
        <ChevronUp size={18} color={isFirst ? colors.border : colors.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${category.name}を下へ`}
        disabled={isLast}
        onPress={() => onMove(1)}
        hitSlop={6}
        style={styles.iconButton}
      >
        <ChevronDown size={18} color={isLast ? colors.border : colors.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${category.name}を削除`}
        onPress={confirmDelete}
        hitSlop={6}
        style={styles.iconButton}
      >
        <Trash2 size={18} color={colors.danger} />
      </Pressable>
    </View>
  );
}

export default function ProductCategoriesSheet({
  categories,
  counts,
  onClose,
  onAdd,
  onRename,
  onDelete,
  onMove,
}: ProductCategoriesSheetProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const trimmed = draft.trim();
    if (trimmed === '') return;
    if (categories.some((category) => category.name === trimmed)) {
      Alert.alert(`「${trimmed}」は一覧にあります`);
      return;
    }
    onAdd(trimmed);
    setDraft('');
  };

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell title="日用品のカテゴリ" onClose={onClose}>
        <Text style={styles.hint}>
          家族で共有する一覧です。日用品の編集では、ここから選びます。名前を直すと、そのカテゴリの品も新しい名前になります
        </Text>
        {categories.length === 0 ? (
          <Text style={styles.empty}>まだありません</Text>
        ) : (
          <View style={styles.card}>
            {categories.map((category, index) => (
              <View key={category.id} style={index > 0 && styles.rowDivided}>
                <CategoryRow
                  key={category.name /* 名前が変わったら入力欄を作り直す */}
                  category={category}
                  isFirst={index === 0}
                  isLast={index === categories.length - 1}
                  count={counts[category.name] ?? 0}
                  onRename={(name) => onRename(category, name)}
                  onDelete={() => onDelete(category)}
                  onMove={(offset) => onMove(category, offset)}
                />
              </View>
            ))}
          </View>
        )}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            returnKeyType="done"
            placeholder="例: 紙類"
            placeholderTextColor={colors.textFaint}
          />
          <Pressable accessibilityRole="button" onPress={add} style={styles.addButton}>
            <Text style={styles.addButtonText}>追加</Text>
          </Pressable>
        </View>
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hint: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  empty: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 4, paddingRight: 8 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  rowInput: { flex: 1, paddingHorizontal: 8, paddingVertical: 10, fontSize: 14, fontWeight: '700', color: colors.text },
  count: { fontSize: 11, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'], marginRight: 4 },
  iconButton: { padding: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  addButton: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: colors.navActive },
  addButtonText: { color: colors.primaryText, fontSize: 14, fontWeight: '700' },
});
