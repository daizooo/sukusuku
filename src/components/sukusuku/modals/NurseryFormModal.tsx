'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Nursery, NurseryStatus } from '@/types/app';

export interface NurseryDraft {
  name: string;
  distance: string;
  status: NurseryStatus | string;
  phone: string;
  memo: string;
}

const EMPTY_DRAFT: NurseryDraft = { name: '', distance: '', status: '未見学', phone: '', memo: '' };

interface NurseryFormModalProps {
  mode: 'add' | 'edit' | null;
  nursery: Nursery | null;
  onClose: () => void;
  onSubmit: (draft: NurseryDraft) => void;
  onDelete?: (id: string) => void;
}

// 呼び出し側で key={mode + nursery?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function NurseryFormModal({ mode, nursery, onClose, onSubmit, onDelete }: NurseryFormModalProps) {
  const [draft, setDraft] = useState<NurseryDraft>(() =>
    mode === 'edit' && nursery
      ? { name: nursery.name, distance: nursery.distance, status: nursery.status, phone: nursery.phone, memo: nursery.memo }
      : EMPTY_DRAFT,
  );

  if (!mode) return null;

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="font-bold text-gray-800">{mode === 'add' ? '保育園を追加' : '保育園を編集'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              園名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder="例: 舞原保育園"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">距離・アクセス</label>
              <input
                type="text"
                value={draft.distance}
                onChange={(e) => setDraft({ ...draft, distance: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
                placeholder="例: 車5分"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">状況</label>
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none bg-white"
              >
                <option>未見学</option>
                <option>見学予約済</option>
                <option>見学済</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">電話番号</label>
            <input
              type="text"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">メモ</label>
            <textarea
              value={draft.memo}
              onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none h-20 resize-none"
            />
          </div>
          <button
            onClick={() => onSubmit(draft)}
            disabled={!draft.name}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl mt-4 shadow-sm active:bg-blue-600 transition disabled:bg-gray-300"
          >
            {mode === 'add' ? '追加する' : '保存する'}
          </button>
          {mode === 'edit' && nursery && onDelete && (
            <button
              onClick={() => onDelete(nursery.id)}
              className="w-full flex items-center justify-center text-xs text-red-500 font-medium py-2"
            >
              <Trash2 size={14} className="mr-1" /> 削除する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
