'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ListBoard } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { loadLists } from '@/lib/api/lists';
import { addToShoppingList } from '@/lib/api/householdProducts';
import { readShoppingListId, writeShoppingListId } from '@/lib/shoppingListPreference';
import ListPickerModal from '../modals/ListPickerModal';

// 暮らしタブから買い出しリストへ送る仕組み（docs/home.md §4.2）。日用品の「＋」と、
// 備蓄の不足の「リストへ」の両方から使う。mobile版の `mobile/src/components/living/useShoppingSender.tsx` と同じ。
//
// - 送り先のリストは端末ごとに覚える。まだ決めていない（または消えた）ときは、選んでから送る
// - 送ったら下に一言出す（どのリストのどのグループに入ったか、既に入っていたか）

interface PendingSend {
  title: string;
  store: string;
  onAdded?: () => void;
}

const NOTICE_MS = 3000;

export function useShoppingSender(familyId: string) {
  const supabase = useMemo(() => createClient(), []);
  const [lists, setLists] = useState<ListBoard[]>([]);
  // 端末に覚えた送り先。サーバー側の描画では読めず null になるが、リストを読み終えるまでは
  // どちらでも「未設定」と出るので、表示は食い違わない。
  const [listId, setListId] = useState<string | null>(() => readShoppingListId());
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<PendingSend | null>(null);

  const reload = useCallback(async () => {
    try {
      const snapshot = await loadLists(supabase, familyId);
      setLists(snapshot.lists);
    } catch {
      // 読めなくても、送るときにもう一度読む。
    }
  }, [supabase, familyId]);

  useEffect(() => {
    let isMounted = true;
    loadLists(supabase, familyId)
      .then((snapshot) => {
        if (!isMounted) return;
        setLists(snapshot.lists);
      })
      .catch(() => {
        // 読めなくても、送るときにもう一度読む。
      });
    return () => {
      isMounted = false;
    };
  }, [supabase, familyId]);

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
      window.alert('リストに入れられませんでした。もう一度お試しください。');
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
    writeShoppingListId(id);
    setPicking(false);
    const list = lists.find((row) => row.id === id);
    const entry = pending.current;
    pending.current = null;
    if (list && entry) void deliver(list, entry);
  };

  const picker: ReactNode = picking ? (
    <ListPickerModal
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
      <div className="pointer-events-none absolute left-4 right-4 bottom-4 z-40 rounded-xl bg-gray-900 px-4 py-2.5 text-center text-[13px] font-bold text-white shadow-lg">
        {notice}
      </div>
    ) : null;

  return {
    /** 送り先のリストの名前。まだ決めていなければ null。 */
    listName: target?.name ?? null,
    send,
    openPicker,
    picker,
    banner,
  };
}

export type ShoppingSender = ReturnType<typeof useShoppingSender>;
