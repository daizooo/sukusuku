import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GripVertical, Pencil, Plus, Search, Store } from 'lucide-react-native';
import type { MoneyStore } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { normalizeName } from '@/lib/shoppingUtils';
import { reorderedPositions } from '@/lib/moneyUtils';
import {
  deleteMoneyStore,
  insertMoneyStore,
  renameMoneyStore,
  setMoneyStoreArchived,
  updateMoneyStorePosition,
} from '@/lib/api/money';
import { useDragReorder } from '@/components/list/useDragReorder';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// お店の設定（docs/kakei.md §3.5）。PWA版の `src/components/sukusuku/money/StoreSettings.tsx` と同じ並び・文言。
// 登録したお店を探す・足す・名前を直す・並べ替える（左の持ち手をつかんで動かす。リストと同じ操作）・削除する。使わなくしてある古いお店は、また使う・削除する。ここで直すのは設定だけで、
// 記録のお店の名前は変わらない。記録でまだ無いお店の名前を入れると、自動でここに登録される。

interface StoreSettingsProps {
  familyId: string;
  stores: MoneyStore[];
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onBack: () => void;
}

const byPosition = (a: MoneyStore, b: MoneyStore) => a.position - b.position || a.name.localeCompare(b.name, 'ja');

export default function StoreSettings({ familyId, stores, onStores, onBack }: StoreSettingsProps) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<MoneyStore | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const key = normalizeName(query.trim());
  const matches = useMemo(
    () => stores.filter((store) => key === '' || normalizeName(store.name).includes(key)).sort(byPosition),
    [stores, key],
  );
  const usable = matches.filter((store) => !store.archived);
  const archived = matches.filter((store) => store.archived);

  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');
  const put = (saved: MoneyStore) => onStores((prev) => [...prev.filter((store) => store.id !== saved.id), saved].sort(byPosition));

  // 指で動かしたあとの並び。使っているお店の並びを数え直し、変わったものだけ保存する。探しているあいだは動かせない。
  const drag = useDragReorder((_sectionKey, orderedIds) => {
    const changes = reorderedPositions(stores, orderedIds);
    if (changes.length === 0) return;
    onStores((prev) =>
      prev
        .map((store) => {
          const hit = changes.find((change) => change.id === store.id);
          return hit ? { ...store, position: hit.position } : store;
        })
        .sort(byPosition),
    );
    void Promise.all(changes.map((change) => updateMoneyStorePosition(supabase, change.id, change.position))).catch(() =>
      Alert.alert('並べ替えを保存できませんでした', 'もう一度お試しください。'),
    );
  });
  const canReorder = key === '' && usable.length > 1;

  const save = async (target: MoneyStore | null, name: string) => {
    setEditing(null);
    try {
      put(target === null ? await insertMoneyStore(supabase, familyId, name) : await renameMoneyStore(supabase, target.id, name));
    } catch {
      failed();
    }
  };

  // 使わなくした古いお店を「また使う」にするためだけに残している（新しく使わなくすることはできない。削除する）。
  const setArchived = async (store: MoneyStore, value: boolean) => {
    setEditing(null);
    try {
      put(await setMoneyStoreArchived(supabase, store.id, value));
    } catch {
      failed();
    }
  };

  const remove = async (store: MoneyStore) => {
    setEditing(null);
    try {
      await deleteMoneyStore(supabase, store.id);
      onStores((prev) => prev.filter((entry) => entry.id !== store.id));
    } catch {
      Alert.alert('削除できませんでした', 'もう一度お試しください。');
    }
  };

  const confirmRemove = (store: MoneyStore) =>
    Alert.alert(`${store.name}を削除しますか？`, 'お店の一覧から消えますが、記録のお店の名前は残ります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => void remove(store) },
    ]);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="よく行くお店" icon="back" onClose={onBack} />
      <View style={styles.searchBox}>
        <Search size={18} color={colors.textFaint} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="お店を探す"
          returnKeyType="search"
        />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={!drag.isActive}>
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
        <View {...drag.panHandlers}>
          {usable.map((store) => (
            <Pressable
              key={store.id}
              accessibilityRole="button"
              accessibilityLabel={`${store.name}を編集`}
              onPress={() => setEditing(store)}
              {...drag.measureProps(store.id)}
              style={[styles.row, drag.styleFor(store.id), drag.isDragging(store.id) && styles.lifted]}
            >
              {canReorder && (
                <View accessibilityLabel={`${store.name}を並べ替え`} {...drag.gripProps('stores', usable, store.id)} style={styles.grip}>
                  <GripVertical size={18} color={colors.borderStrong} />
                </View>
              )}
              <Store size={18} color={colors.textFaint} />
              <Text style={[styles.name, styles.flex]}>{store.name}</Text>
              <Pencil size={16} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>

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
                  <Pressable accessibilityRole="button" onPress={() => confirmRemove(store)} hitSlop={8}>
                    <Text style={styles.deleteLink}>削除</Text>
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
          onDelete={editing === 'new' ? undefined : () => confirmRemove(editing)}
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
  onDelete,
}: {
  store: MoneyStore | null;
  stores: MoneyStore[];
  onClose: () => void;
  onSubmit: (name: string) => void;
  onDelete?: () => void;
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

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={store ? 'お店を編集' : 'お店を足す'}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" onPress={submit} />
            {onDelete && (
              <Pressable accessibilityRole="button" onPress={onDelete} style={styles.secondary}>
                <Text style={styles.deleteText}>削除</Text>
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
  grip: { width: 28, alignSelf: 'stretch', marginLeft: -8, marginVertical: -4, alignItems: 'center', justifyContent: 'center' },
  lifted: { opacity: 0.9, elevation: 8, backgroundColor: colors.surface },
  archivedHeader: { marginTop: 16, marginBottom: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  link: { fontSize: 13, fontWeight: '700', color: colors.money },
  deleteLink: { fontSize: 13, fontWeight: '700', color: colors.danger },
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
  error: { fontSize: 12, fontWeight: '500', color: colors.danger, marginTop: 8 },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
