'use client';

import { Check } from 'lucide-react';
import type { ListBoard } from '@/types/app';
import { ModalShell } from './TaskForm';

// 暮らしタブから送る先の買い出しリストを選ぶ（docs/home.md §4.2）。端末ごとに覚える。
// mobile版の `mobile/src/components/living/ListPickerSheet.tsx` と同じ。

interface ListPickerModalProps {
  lists: ListBoard[];
  selectedId: string | null;
  onClose: () => void;
  onPick: (listId: string) => void;
}

export default function ListPickerModal({ lists, selectedId, onClose, onPick }: ListPickerModalProps) {
  return (
    <ModalShell
      title="送り先のリスト"
      onClose={onClose}
      footer={<p className="text-[11px] text-gray-400 text-center">この端末で覚えます。あとで「送り先」から変えられます</p>}
    >
      {lists.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">リストがまだありません。リストタブで作ってください</p>
      ) : (
        <ul className="rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
          {lists.map((list) => {
            const selected = list.id === selectedId;
            return (
              <li key={list.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPick(list.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                >
                  <span className={`text-[15px] ${selected ? 'font-bold text-blue-600' : 'text-gray-900'}`}>
                    {list.name || '（無題）'}
                  </span>
                  {selected && <Check size={18} className="text-blue-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ModalShell>
  );
}
