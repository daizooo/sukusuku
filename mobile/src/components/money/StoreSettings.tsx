import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pencil, Plus, Search, Store } from 'lucide-react-native';
import type { MoneyStore } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { normalizeName } from '@/lib/shoppingUtils';
import { insertMoneyStore, renameMoneyStore, setMoneyStoreArchived } from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// お店の設定（docs/kakei.md §3.5）。PWA版の `src/components/sukusuku/money/StoreSettings.tsx` と同じ並び・文言。
// 登録したお店を探す・足す・名前を直す・使わなくする・また使う。ここで直すのは設定だけで、
// 記録のお店の名前は変わらない。記録でまだ無いお店の名前を入れると、自動でここに登録される。

interface StoreSettingsProps {
  familyId: string;
  stores: MoneyStore[];
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onBack: () => void;
}

const byName = (a: MoneyStore, b: MoneyStore) => a.name.localeCompare(b.name, 'ja');

export default function StoreSettings({ familyId, stores, onStores, onBack }: StoreSettingsProps) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<MoneyStore | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const key = normalizeName(query.trim());
  const matches = useMemo(
    () => stores.filter((store) => key === '' || normalizeName(store.name).includes(key)).sort(byName),
    [stores, key],
  );
  const usable = matches.filter((store) => !store.archived);
  const archived = matches.filter((store) => store.archived);

  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');
  const put = (saved: MoneyStore) => onStores((prev) => [...prev.filter((store) => store.id !== saved.id), saved]);

  const save = async (target: MoneyStore | null, name: string) => {
    setEditing(null);
    try {
      put(target === null ? await insertMoneyStore(supabase, familyId, name) : await renameMoneyStore(supabase, target.id, name));
    } catch {
      failed();
    }
  };

  const setArchived = async (store: MoneyStore, value: boolean) => {
    setEditing(null);
    try {
      put(await setMoneyStoreArchived(supabase, store.id, value));
    } catch {
      failed();
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="お店" icon="back" onClose={onBack} />
      <View style={styles.searchBox}>
        <Search size={18} color={colors.textFaint} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="お店を探す"
          placeholderTextColor={colors.textFaint}
          returnKeyType="search"
        />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => setEditing('new')} style={styles.add}>
          <Plus size={18} color={colors.money} />
          <Text style={styles.addText}>お店を足す</Text>
        </Pressable>

        {stores.length === 0 && (
          <Text style={styles.empty}>
            お店がまだありません。記録でお店を入れると自動で登録されます。ここで先に足すこともできます
          </Text>
        )}
        {stores.length > 0 && usable.length === 0 && archived.length === 0 && (
          <Text style={styles.empty}>見つかりませんでした</Text>
        )}
        {usable.map((store) => (
          <Pressable
            key={store.id}
            accessibilityRole="button"
            accessibilityLabel={`${store.name}を編集`}
            onPress={() => setEditing(store)}
            style={styles.row}
          >
            <Store size={18} color={colors.textFaint} />
            <Text style={[styles.name, styles.flex]}>{store.name}</Text>
            <Pencil size={16} color={colors.textFaint} />
          </Pressable>
        ))}

        {archived.length > 0 && (
          <>
            <Pressable accessibilityRole="button" onPress={() => setShowArchived((value) => !value)} style={styles.archivedHeader}>
              <Text style={styles.sectionTitle}>
                使わないお店 {archived.length}件（記録には残っています）　{showArchived ? '閉じる' : '見る'}
              </Text>
            </Pressable>
            {showArchived &&
              archived.map((store) => (
                <View key={store.id} style={[styles.row, styles.archivedRow]}>
                  <Store size={18} color={colors.textFaint} />
                  <Text style={[styles.name, styles.flex]}>{store.name}</Text>
                  <Pressable accessibilityRole="button" onPress={() => void setArchived(store, false)} hitSlop={8}>
                    <Text style={styles.link}>また使う</Text>
                  </Pressable>
                </View>
              ))}
          </>
        )}
      </ScrollView>

      {editing !== null && (
        <StoreSheet
          key={editing === 'new' ? 'new' : editing.id}
          store={editing === 'new' ? null : editing}
          stores={stores}
          onClose={() => setEditing(null)}
          onSubmit={(name) => void save(editing === 'new' ? null : editing, name)}
          onArchive={editing === 'new' ? undefined : () => void setArchived(editing, true)}
        />
      )}
    </View>
  );
}

function StoreSheet({
  store,
  stores,
  onClose,
  onSubmit,
  onArchive,
}: {
  store: MoneyStore | null;
  stores: MoneyStore[];
  onClose: () => void;
  onSubmit: (name: string) => void;
  onArchive?: () => void;
}) {
  const [name, setName] = useState(store?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const typed = name.trim();
    if (typed === '') return setError('名前を入れてください');
    // 同じ名前は2つ作れない。使わなくしたお店を新しく足すと、そのお店をまた使えるようにする。
    const same = stores.find((entry) => entry.name === typed && entry.id !== store?.id);
    if (same && (store !== null || !same.archived)) return setError('同じ名前のお店があります');
    onSubmit(typed);
  };

  const archive = () =>
    Alert.alert(`${store?.name ?? ''}を使わなくしますか？`, '選べなくなりますが、記録には残ります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '使わなくする', style: 'destructive', onPress: () => onArchive?.() },
    ]);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={store ? 'お店を編集' : 'お店を足す'}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" onPress={submit} />
            {onArchive && (
              <Pressable accessibilityRole="button" onPress={archive} style={styles.secondary}>
                <Text style={styles.deleteText}>使わなくする</Text>
              </Pressable>
            )}
          </>
        }
      >
        <View style={styles.field}>
          <Text style={styles.label}>名前</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="例: ドラッグストア〇〇"
            placeholderTextColor={colors.textFaint}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
        </View>
        {store && (
          <Text style={styles.hint}>名前を直しても、これまでの記録のお店の名前は変わりません（設定だけ直します）。</Text>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
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
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  empty: { fontSize: 14, fontWeight: '500', lineHeight: 20, color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  archivedRow: { opacity: 0.7 },
  archivedHeader: { marginTop: 16, marginBottom: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  link: { fontSize: 13, fontWeight: '700', color: colors.money },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  hint: { fontSize: 12, fontWeight: '500', lineHeight: 18, color: colors.textMuted, marginTop: 8 },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger, marginTop: 8 },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
