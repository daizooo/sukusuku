import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search, Store } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { normalizeName } from '@/lib/shoppingUtils';
import { ScreenHeader } from '@/components/money/moneyVisual';

// お店の選択（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/StorePicker.tsx` と同じ。
// 探す欄と「最近使ったお店」（前に入れたお店から）。位置からの候補は出さない。打った名前をそのまま使える。

interface StorePickerProps {
  value: string;
  recent: string[];
  onPick: (store: string) => void;
  onClose: () => void;
}

export default function StorePicker({ value, recent, onPick, onClose }: StorePickerProps) {
  const [query, setQuery] = useState(value);
  const typed = query.trim();
  const matches = useMemo(() => {
    const key = normalizeName(typed);
    return key === '' ? recent : recent.filter((store) => normalizeName(store).includes(key));
  }, [recent, typed]);
  const exact = matches.some((store) => store === typed);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="お店を選ぶ" icon="back" onClose={onClose} />
      <View style={styles.searchBox}>
        <Search size={18} color={colors.textFaint} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="お店の名前"
          placeholderTextColor={colors.textFaint}
          autoFocus={value === ''}
          returnKeyType="done"
          onSubmitEditing={() => onPick(typed)}
        />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {typed !== '' && !exact && (
          <Pressable accessibilityRole="button" onPress={() => onPick(typed)} style={styles.row}>
            <Store size={18} color={colors.money} />
            <Text style={[styles.name, styles.use]}>「{typed}」にする</Text>
          </Pressable>
        )}
        {matches.length > 0 && <Text style={styles.sectionTitle}>最近使ったお店</Text>}
        {matches.map((store) => (
          <Pressable key={store} accessibilityRole="button" onPress={() => onPick(store)} style={styles.row}>
            <Store size={18} color={colors.textFaint} />
            <Text style={styles.name}>{store}</Text>
          </Pressable>
        ))}
        {value !== '' && (
          <Pressable accessibilityRole="button" onPress={() => onPick('')} style={styles.row}>
            <Text style={styles.clear}>お店を入れない</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.neutralSurface,
  },
  search: { flex: 1, paddingVertical: 10, fontSize: 15, fontWeight: '500', color: colors.text },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 12, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  use: { fontWeight: '700', color: colors.money },
  clear: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
});
