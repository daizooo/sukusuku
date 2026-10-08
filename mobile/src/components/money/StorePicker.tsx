import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Plus, Search, Store } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { normalizeName } from '@/lib/shoppingUtils';
import { ScreenHeader } from '@/components/money/moneyVisual';

// お店の選択（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/StorePicker.tsx` と同じ。
// 探す欄と、最近使ったお店、続けて登録したお店の残り（設定データ。docs/kakei.md §3.5）。
// 位置からの候補は出さない。打った名前をそのまま使える（新しいお店は記録の保存で自動で登録される）。

interface StorePickerProps {
  value: string;
  /** 登録したお店のうち、最近使ったお店に出ていないもの（名前順。使わなくしたものは除く）。 */
  registered: string[];
  /** 最近使ったお店（新しい順。使わなくしたものは除く）。 */
  recent: string[];
  onPick: (store: string) => void;
  onClose: () => void;
}

export default function StorePicker({ value, registered, recent, onPick, onClose }: StorePickerProps) {
  const [query, setQuery] = useState(value);
  const typed = query.trim();
  const { matchedRegistered, matchedRecent } = useMemo(() => {
    const key = normalizeName(typed);
    const pick = (stores: string[]) => (key === '' ? stores : stores.filter((store) => normalizeName(store).includes(key)));
    return { matchedRegistered: pick(registered), matchedRecent: pick(recent) };
  }, [registered, recent, typed]);
  const exact = [...matchedRegistered, ...matchedRecent].some((store) => store === typed);

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
            <Plus size={18} color={colors.money} />
            <Text style={[styles.name, styles.use]}>「{typed}」を追加する</Text>
          </Pressable>
        )}
        {matchedRecent.length > 0 && <Text style={styles.sectionTitle}>最近使ったお店</Text>}
        {matchedRecent.map((store) => (
          <Pressable key={`recent-${store}`} accessibilityRole="button" onPress={() => onPick(store)} style={styles.row}>
            <Store size={18} color={colors.textFaint} />
            <Text style={styles.name}>{store}</Text>
          </Pressable>
        ))}
        {matchedRegistered.length > 0 && <Text style={styles.sectionTitle}>登録したお店</Text>}
        {matchedRegistered.map((store) => (
          <Pressable key={`registered-${store}`} accessibilityRole="button" onPress={() => onPick(store)} style={styles.row}>
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
