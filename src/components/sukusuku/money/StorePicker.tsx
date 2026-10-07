'use client';

import { useMemo, useState } from 'react';
import { Search, Store } from 'lucide-react';
import { normalizeName } from '@/lib/shoppingUtils';
import { ScreenHeader, StackedScreen } from './moneyVisual';

// お店の選択（docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/StorePicker.tsx` と同じ。
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
  const rowClass = 'flex w-full items-center gap-2.5 border-b border-gray-200 py-3 text-left text-[15px] hover:bg-gray-50';

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader title="お店を選ぶ" icon="back" onClose={onClose} />
      <form
        className="shrink-0 mx-4 mt-4 mb-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3"
        onSubmit={(event) => {
          event.preventDefault();
          onPick(typed);
        }}
      >
        <Search size={18} className="text-gray-400" />
        <input
          className="flex-1 bg-transparent py-2.5 text-[15px] focus:outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="お店の名前"
          autoFocus={value === ''}
        />
      </form>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8">
        {typed !== '' && !exact && (
          <button type="button" onClick={() => onPick(typed)} className={`${rowClass} font-bold text-blue-600`}>
            <Store size={18} />「{typed}」にする
          </button>
        )}
        {matches.length > 0 && <p className="mt-3 mb-1 text-xs font-bold text-gray-500">最近使ったお店</p>}
        {matches.map((store) => (
          <button key={store} type="button" onClick={() => onPick(store)} className={`${rowClass} text-gray-900`}>
            <Store size={18} className="text-gray-400" />
            {store}
          </button>
        ))}
        {value !== '' && (
          <button type="button" onClick={() => onPick('')} className={`${rowClass} text-sm text-gray-500`}>
            お店を入れない
          </button>
        )}
      </div>
    </StackedScreen>
  );
}
