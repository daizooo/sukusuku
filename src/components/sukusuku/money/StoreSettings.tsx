'use client';

import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Store } from 'lucide-react';
import type { MoneyStore } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { normalizeName } from '@/lib/shoppingUtils';
import { insertMoneyStore, renameMoneyStore, setMoneyStoreArchived } from '@/lib/api/money';
import { ModalShell } from '../modals/TaskForm';
import { PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// お店の設定（docs/kakei.md §3.5）。mobile版の `mobile/src/components/money/StoreSettings.tsx` と同じ並び・文言。
// 登録したお店を探す・足す・名前を直す・使わなくする・また使う。ここで直すのは設定だけで、
// 記録のお店の名前は変わらない。記録でまだ無いお店の名前を入れると、自動でここに登録される。

interface StoreSettingsProps {
  familyId: string;
  stores: MoneyStore[];
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onBack: () => void;
}

const byName = (a: MoneyStore, b: MoneyStore) => a.name.localeCompare(b.name, 'ja');

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
    () => stores.filter((store) => key === '' || normalizeName(store.name).includes(key)).sort(byName),
    [stores, key],
  );
  const usable = matches.filter((store) => !store.archived);
  const archived = matches.filter((store) => store.archived);

  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');
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
    <StackedScreen onBack={onBack}>
      <ScreenHeader title="お店" icon="back" onClose={onBack} />
      <div className="shrink-0 mx-4 mt-4 mb-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3">
        <Search size={18} className="text-gray-400" />
        <input
          className="flex-1 bg-transparent py-2.5 text-[15px] focus:outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="お店を探す"
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
        {usable.map((store) => (
          <button
            key={store.id}
            type="button"
            aria-label={`${store.name}を編集`}
            onClick={() => setEditing(store)}
            className={`${rowClass} text-gray-900 hover:bg-gray-50`}
          >
            <Store size={18} className="text-gray-400" />
            <span className="flex-1">{store.name}</span>
            <Pencil size={16} className="text-gray-400" />
          </button>
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
          onArchive={editing === 'new' ? undefined : () => void setArchived(editing, true)}
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

  const archive = () => {
    if (window.confirm(`${store?.name ?? ''}を使わなくしますか？選べなくなりますが、記録には残ります。`)) onArchive?.();
  };

  return (
    <ModalShell
      title={store ? 'お店を編集' : 'お店を足す'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <PrimaryButton label="保存する" onClick={submit} />
          {onArchive && (
            <button type="button" onClick={archive} className="w-full py-2 text-sm text-red-500">
              使わなくする
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
        {store && <p className="text-xs leading-relaxed text-gray-500">名前を直しても、これまでの記録のお店の名前は変わりません（設定だけ直します）。</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </form>
    </ModalShell>
  );
}
