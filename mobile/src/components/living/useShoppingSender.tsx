import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { ListBoard, ListGroup } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { loadLists } from '@/lib/api/lists';
import { addToShoppingList } from '@/lib/api/householdProducts';
import { readShoppingListId, writeShoppingListId } from '@/lib/shoppingListPreference';
import ListPickerSheet from '@/components/living/ListPickerSheet';

// 暮らしタブから買い出しリストへ送る仕組み（docs/home.md §4.2）。日用品の「＋」と、
// 備蓄の不足の「リストへ」の両方から使う。PWA版の `src/components/sukusuku/living/useShoppingSender.tsx` と同じ。
//
// - 送り先のリストは端末ごとに覚える。まだ決めていない（または消えた）ときは、選んでから送る
// - 送ったら下に一言出す（どのリストのどのグループに入ったか、既に入っていたか）

interface PendingSend {
  title: string;
  store: string;
  onAdded?: () => void;
}

const NOTICE_MS = 3000;

export function useShoppingSender(familyId: string | null) {
  const [lists, setLists] = useState<ListBoard[]>([]);
  const [groups, setGroups] = useState<ListGroup[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<PendingSend | null>(null);

  const reload = useCallback(async () => {
    if (!familyId) return;
    try {
      const snapshot = await loadLists(supabase, familyId);
      setLists(snapshot.lists);
      setGroups(snapshot.groups);
    } catch {
      // 読めなくても、送るときにもう一度読む。
    }
  }, [familyId]);

  useEffect(() => {
    void reload();
    void readShoppingListId().then(setListId);
  }, [reload]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const target = lists.find((list) => list.id === listId) ?? null;

  const deliver = async (list: ListBoard, entry: PendingSend) => {
    try {
      const result = await addToShoppingList(supabase, list.id, entry.title, entry.store);
      const where = `${list.name}${result.groupName ? `（${result.groupName}）` : ''}`;
      if (result.status === 'added') {
        setNotice(`「${entry.title}」を${where}に入れました`);
        entry.onAdded?.();
      } else {
        setNotice(`「${entry.title}」は${where}に入っています`);
      }
    } catch {
      Alert.alert('リストに入れられませんでした', 'もう一度お試しください。');
    }
  };

  /** title を送り先のリストへ。送り先が決まっていなければ、選んでもらってから送る。 */
  const send = (title: string, store: string, onAdded?: () => void) => {
    if (target) {
      void deliver(target, { title, store, onAdded });
      return;
    }
    pending.current = { title, store, onAdded };
    void reload();
    setPicking(true);
  };

  const openPicker = () => {
    pending.current = null;
    void reload();
    setPicking(true);
  };

  const pick = (id: string) => {
    setListId(id);
    void writeShoppingListId(id);
    setPicking(false);
    const list = lists.find((row) => row.id === id);
    const entry = pending.current;
    pending.current = null;
    if (list && entry) void deliver(list, entry);
  };

  const picker: ReactNode = picking ? (
    <ListPickerSheet
      lists={lists}
      selectedId={target?.id ?? null}
      onClose={() => {
        pending.current = null;
        setPicking(false);
      }}
      onPick={pick}
    />
  ) : null;

  const banner: ReactNode =
    notice !== null ? (
      <View style={styles.banner} pointerEvents="none">
        <Text style={styles.bannerText}>{notice}</Text>
      </View>
    ) : null;

  return {
    /** 送り先のリストの名前。まだ決めていなければ null。 */
    listName: target?.name ?? null,
    /** 送り先のリストのグループ名（日用品のお店の候補に使う）。 */
    groupNames: target ? groups.filter((group) => group.listId === target.id).map((group) => group.name) : [],
    send,
    openPicker,
    picker,
    banner,
  };
}

export type ShoppingSender = ReturnType<typeof useShoppingSender>;

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.text,
  },
  bannerText: { fontSize: 13, fontWeight: '700', color: colors.primaryText, textAlign: 'center' },
});
