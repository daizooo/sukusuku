import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Plus, Search, Store } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { matchesStore } from '@/lib/moneyUtils';
import { ScreenHeader } from '@/components/money/moneyVisual';

// お店の選択（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/StorePicker.tsx` と同じ。
// 探す欄と、最近使ったお店、続けて登録したお店の残り（設定データ。docs/kakei.md §3.5）。
// 位置からの候補は出さない。打った名前が候補に無ければ「この記録だけに使う」か「お店に登録して使う」を選ぶ
// （登録はお店の設定に入る。一度きりのお店で選択画面が膨らまないように、既定は「この記録だけ」）。
// 似たお店（どちらかがもう片方を含む名前。matchesStore）があれば、同じお店ならそちらを選ぶよう知らせる。

interface StorePickerProps {
  value: string;
  /** 登録したお店のうち、最近使ったお店に出ていないもの（使った回数の多い順。使わなくしたものは除く）。 */
  registered: string[];
  /** 最近使ったお店（新しい順。使わなくしたものは除く）。 */
  recent: string[];
  /** 登録していない前に使ったお店（名前で探したときだけ出す）。 */
  others: string[];
  /** 新しい名前を「お店に登録して使う」こともできるか（毎月の記録のルールでも出す）。 */
  canRegister: boolean;
  /** 「この○○だけに使う」の○○（既定は「記録」。日用品の編集では「日用品」）。 */
  subject?: string;
  /** register: 「お店に登録して使う」を選んだか。 */
  onPick: (store: string, register: boolean) => void;
  onClose: () => void;
}

export default function StorePicker({ value, registered, recent, others, canRegister, subject = '記録', onPick, onClose }: StorePickerProps) {
  const [query, setQuery] = useState(value);
  const typed = query.trim();
  const { matchedRegistered, matchedRecent, matchedOthers } = useMemo(() => {
    const pick = (stores: string[]) => stores.filter((store) => matchesStore(store, typed));
    return {
      matchedRegistered: pick(registered),
      matchedRecent: pick(recent),
      matchedOthers: typed === '' ? [] : pick(others),
    };
  }, [registered, recent, others, typed]);
  const matched = [...matchedRecent, ...matchedRegistered, ...matchedOthers];
  const exact = matched.some((store) => store === typed);
  const row = (store: string, key: string) => (
    <Pressable key={key} accessibilityRole="button" onPress={() => onPick(store, false)} style={styles.row}>
      <Store size={18} color={colors.textFaint} />
      <Text style={styles.name}>{store}</Text>
    </Pressable>
  );

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
          onSubmitEditing={() => onPick(typed, false)}
        />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {typed !== '' && !exact && (
          <>
            {matched.length > 0 && (
              <Text style={styles.similar}>似たお店があります。同じお店なら下から選んでください</Text>
            )}
            <Pressable accessibilityRole="button" onPress={() => onPick(typed, false)} style={styles.row}>
              <Plus size={18} color={colors.money} />
              <Text style={[styles.name, styles.use]}>
                「{typed}」を{canRegister ? `この${subject}だけに使う` : '使う'}
              </Text>
            </Pressable>
            {canRegister && (
              <Pressable accessibilityRole="button" onPress={() => onPick(typed, true)} style={styles.row}>
                <Plus size={18} color={colors.money} />
                <Text style={[styles.name, styles.use]}>「{typed}」をお店に登録して使う</Text>
              </Pressable>
            )}
          </>
        )}
        {matchedRecent.length > 0 && <Text style={styles.sectionTitle}>最近使ったお店</Text>}
        {matchedRecent.map((store) => row(store, `recent-${store}`))}
        {matchedRegistered.length > 0 && <Text style={styles.sectionTitle}>登録したお店</Text>}
        {matchedRegistered.map((store) => row(store, `registered-${store}`))}
        {matchedOthers.length > 0 && <Text style={styles.sectionTitle}>前に使ったお店</Text>}
        {matchedOthers.map((store) => row(store, `other-${store}`))}
        {value !== '' && (
          <Pressable accessibilityRole="button" onPress={() => onPick('', false)} style={styles.row}>
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
  // 似たお店の知らせ。色は amber-700（PWA版の text-amber-700 と同じ）。
  similar: { fontSize: 13, fontWeight: '600', color: colors.milkText, marginTop: 10, marginBottom: 2 },
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
