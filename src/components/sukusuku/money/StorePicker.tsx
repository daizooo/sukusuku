'use client';

import { useMemo, useState } from 'react';
import { Plus, Search, Store } from 'lucide-react';
import { matchesStore } from '@/lib/moneyUtils';
import { ScreenHeader, StackedScreen } from './moneyVisual';

// お店の選択（docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/StorePicker.tsx` と同じ。
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
  /** register: 「お店に登録して使う」を選んだか。 */
  onPick: (store: string, register: boolean) => void;
  onClose: () => void;
}

export default function StorePicker({ value, registered, recent, others, canRegister, onPick, onClose }: StorePickerProps) {
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
  const rowClass = 'flex w-full items-center gap-2.5 border-b border-gray-200 py-3 text-left text-[15px] hover:bg-gray-50';
  const row = (store: string, key: string) => (
    <button key={key} type="button" onClick={() => onPick(store, false)} className={`${rowClass} text-gray-900`}>
      <Store size={18} className="text-gray-400" />
      {store}
    </button>
  );
  const sectionTitle = (title: string) => <p className="mt-3 mb-1 text-xs font-bold text-gray-500">{title}</p>;

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader title="お店を選ぶ" icon="back" onClose={onClose} />
      <form
        className="shrink-0 mx-4 mt-4 mb-1 flex items-center gap-2 rounded-xl bg-gray-100 px-3"
        onSubmit={(event) => {
          event.preventDefault();
          onPick(typed, false);
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
          <>
            {matched.length > 0 && (
              <p className="mt-2.5 mb-0.5 text-[13px] font-semibold text-amber-700">
                似たお店があります。同じお店なら下から選んでください
              </p>
            )}
            <button type="button" onClick={() => onPick(typed, false)} className={`${rowClass} font-bold text-blue-600`}>
              <Plus size={18} />「{typed}」を{canRegister ? 'この記録だけに使う' : '使う'}
            </button>
            {canRegister && (
              <button type="button" onClick={() => onPick(typed, true)} className={`${rowClass} font-bold text-blue-600`}>
                <Plus size={18} />「{typed}」をお店に登録して使う
              </button>
            )}
          </>
        )}
        {matchedRecent.length > 0 && sectionTitle('最近使ったお店')}
        {matchedRecent.map((store) => row(store, `recent-${store}`))}
        {matchedRegistered.length > 0 && sectionTitle('登録したお店')}
        {matchedRegistered.map((store) => row(store, `registered-${store}`))}
        {matchedOthers.length > 0 && sectionTitle('前に使ったお店')}
        {matchedOthers.map((store) => row(store, `other-${store}`))}
        {value !== '' && (
          <button type="button" onClick={() => onPick('', false)} className={`${rowClass} text-sm text-gray-500`}>
            お店を入れない
          </button>
        )}
      </div>
    </StackedScreen>
  );
}
