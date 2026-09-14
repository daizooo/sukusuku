'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { ListBoard } from '@/types/app';

// リストそのものの追加・編集。
// 「グループの呼び名」を持つのがこの画面の肝で、買い出しなら「お店」、
// やりたいことなら「ジャンル」と、リストごとに束ね方の言葉を変えられる（docs/lists.md §3）。
export interface ListDraft {
  name: string;
  groupLabel: string;
}

export const DEFAULT_GROUP_LABEL = 'グループ';

// 呼び名の入力を空欄のまま悩ませないための言い換え候補。選ばずに自分で打ってもよい。
const GROUP_LABEL_SAMPLES = ['お店', '場所', 'ジャンル', '担当'];

interface ListFormModalProps {
  mode: 'add' | 'edit' | null;
  list: ListBoard | null;
  onClose: () => void;
  onSubmit: (draft: ListDraft) => void;
  onDelete?: (id: string) => void;
}

// 呼び出し側で key={mode + list?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function ListFormModal({ mode, list, onClose, onSubmit, onDelete }: ListFormModalProps) {
  const [draft, setDraft] = useState<ListDraft>(() =>
    mode === 'edit' && list
      ? { name: list.name, groupLabel: list.groupLabel }
      : { name: '', groupLabel: DEFAULT_GROUP_LABEL },
  );

  if (!mode) return null;

  const set = (patch: Partial<ListDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center px-5 py-3 border-b shrink-0">
          <h3 className="font-bold text-gray-800">{mode === 'add' ? 'リストを追加' : 'リストの設定'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              リスト名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder="例: 買い出し / やりたいこと / やること"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">グループの呼び名</label>
            <input
              type="text"
              value={draft.groupLabel}
              onChange={(e) => set({ groupLabel: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder={DEFAULT_GROUP_LABEL}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {GROUP_LABEL_SAMPLES.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => set({ groupLabel: sample })}
                  className={`text-xs font-bold px-2.5 py-1 rounded-full border transition ${
                    draft.groupLabel === sample
                      ? 'bg-blue-50 border-blue-300 text-blue-600'
                      : 'bg-white border-gray-200 text-gray-500'
                  }`}
                >
                  {sample}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              項目を束ねる区切りの呼び名です。買い出しなら「お店」。
              区切りを作らなければ、ただのチェックリストとして使えます。
            </p>
          </div>
        </div>

        <div className="px-5 py-3 pb-8 sm:pb-3 border-t shrink-0">
          <button
            onClick={() => onSubmit({ ...draft, groupLabel: draft.groupLabel.trim() || DEFAULT_GROUP_LABEL })}
            disabled={!draft.name.trim()}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl shadow-sm active:bg-blue-600 transition disabled:bg-gray-300"
          >
            {mode === 'add' ? '追加する' : '保存する'}
          </button>
          {mode === 'edit' && list && onDelete && (
            <button
              onClick={() => onDelete(list.id)}
              className="w-full flex items-center justify-center text-xs text-red-500 font-medium py-2 mt-1"
            >
              <Trash2 size={14} className="mr-1" /> このリストを削除する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
