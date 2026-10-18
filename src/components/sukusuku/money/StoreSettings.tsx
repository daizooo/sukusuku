'use client';

import { useMemo, useState } from 'react';
import { GripVertical, Pencil, Plus, Search, Store } from 'lucide-react';
import type { MoneyStore } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { normalizeName } from '@/lib/shoppingUtils';
import { reorderedPositions } from '@/lib/moneyUtils';
import {
  deleteMoneyStore,
  insertMoneyStore,
  renameMoneyStore,
  setMoneyStoreArchived,
  updateMoneyStorePosition,
} from '@/lib/api/money';
import { useDragReorder } from '../ui/useDragReorder';
import { ModalShell } from '../modals/TaskForm';
import { PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// お店の設定（docs/kakei.md §3.5）。mobile版の `mobile/src/components/money/StoreSettings.tsx` と同じ並び・文言。
// 登録したお店を探す・足す・名前を直す・並べ替える（左の持ち手をつかんで動かす。リストと同じ操作）・削除する。使わなくしてある古いお店は、また使う・削除する。ここで直すのは設定だけで、
// 記録のお店の名前は変わらない。記録でまだ無いお店の名前を入れると、自動でここに登録される。

interface StoreSettingsProps {
  familyId: string;
  stores: MoneyStore[];
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onBack: () => void;
}

const byPosition = (a: MoneyStore, b: MoneyStore) => a.position - b.position || a.name.localeCompare(b.name, 'ja');

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const rowClass = 'flex w-full items-center gap-2.5 border-b border-gray-200 py-3 text-left text-[15px]';

export default function StoreSettings({ familyId, stores, onStores, onBack }: StoreSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
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

  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');
  const put = (saved: MoneyStore) => onStores((prev) => [...prev.filter((store) => store.id !== saved.id), saved].sort(byPosition));

  // 動かしたあとの並び。使っているお店の並びを数え直し、変わったものだけ保存する。探しているあいだは動かせない。
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
      window.alert('並べ替えを保存できませんでした。もう一度お試しください。'),
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
    if (!window.confirm(`${store.name}を削除しますか？お店の一覧から消えますが、記録のお店の名前は残ります。`)) return;
    setEditing(null);
    try {
      await deleteMoneyStore(supabase, store.id);
      onStores((prev) => prev.filter((entry) => entry.id !== store.id));
    } catch {
      window.alert('削除できませんでした。もう一度お試しください。');
    }
  };

  return (
    <StackedScreen onBack={onBack}>
      <ScreenHeader title="よく行くお店" icon="back" onClose={onBack} />
      <div className="shrink-0 mx-4 mt-4 mb-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3">
        <Search size={18} className="text-gray-400" />
        <input
          className="flex-1 bg-transparent py-2.5 text-[15px] focus:outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="お店を探す"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8">
        <button type="button" onClick={() => setEditing('new')} className="flex items-center gap-2 py-3 text-[15px] font-bold text-blue-600">
          <Plus size={18} />
          お店を足す
        </button>

        {stores.length === 0 && (
          <p className="py-4 text-center text-sm leading-relaxed text-gray-400">
            お店がまだありません。記録でお店を入れると自動で登録されます。ここで先に足すこともできます
          </p>
        )}
        {stores.length > 0 && usable.length === 0 && archived.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-400">見つかりませんでした</p>
        )}
        {drag.arrange('stores', usable).map((store) => (
          <div
            key={store.id}
            ref={drag.dragRef(store.id)}
            className={`${rowClass} bg-white text-gray-900 ${drag.isDragging(store.id) ? 'relative z-20 shadow-lg' : ''}`}
          >
            {canReorder && (
              <span
                role="button"
                aria-label={`${store.name}を並べ替え`}
                {...drag.gripProps('stores', usable, store.id)}
                className="-my-1 -ml-2 flex w-7 flex-none cursor-grab touch-none select-none items-center justify-center self-stretch text-gray-300"
              >
                <GripVertical size={18} />
              </span>
            )}
            <button
              type="button"
              aria-label={`${store.name}を編集`}
              onClick={() => setEditing(store)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left hover:bg-gray-50"
            >
              <Store size={18} className="text-gray-400" />
              <span className="flex-1">{store.name}</span>
              <Pencil size={16} className="text-gray-400" />
            </button>
          </div>
        ))}

        {archived.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowArchived((value) => !value)}
              className="mt-4 mb-1 text-left text-xs font-bold text-gray-500"
            >
              使わないお店 {archived.length}件（記録には残っています）　{showArchived ? '閉じる' : '見る'}
            </button>
            {showArchived &&
              archived.map((store) => (
                <div key={store.id} className={`${rowClass} text-gray-900 opacity-70`}>
                  <Store size={18} className="text-gray-400" />
                  <span className="flex-1">{store.name}</span>
                  <button type="button" onClick={() => void setArchived(store, false)} className="text-[13px] font-bold text-blue-600">
                    また使う
                  </button>
                  <button type="button" onClick={() => void remove(store)} className="text-[13px] font-bold text-red-500">
                    削除
                  </button>
                </div>
              ))}
          </>
        )}
      </div>

      {editing !== null && (
        <StoreModal
          key={editing === 'new' ? 'new' : editing.id}
          store={editing === 'new' ? null : editing}
          stores={stores}
          onClose={() => setEditing(null)}
          onSubmit={(name) => void save(editing === 'new' ? null : editing, name)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing)}
        />
      )}
    </StackedScreen>
  );
}

function StoreModal({
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
    <ModalShell
      title={store ? 'お店を編集' : 'お店を足す'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <PrimaryButton label="保存する" onClick={submit} />
          {onDelete && (
            <button type="button" onClick={onDelete} className="w-full py-2 text-sm text-red-500">
              削除
            </button>
          )}
        </div>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="block">
          <span className="block text-xs font-bold text-gray-700 mb-1.5">名前</span>
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例: ドラッグストア〇〇"
            autoFocus
          />
        </label>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </form>
    </ModalShell>
  );
}
