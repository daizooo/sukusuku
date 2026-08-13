'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Gift, ReturnStatus } from '@/types/app';

export interface GiftDraft {
  from: string;
  item: string;
  date: string;
  returnStatus: ReturnStatus | string;
  returnItem: string;
  note: string;
}

const EMPTY_DRAFT: GiftDraft = { from: '', item: '', date: '', returnStatus: '未完了', returnItem: '', note: '' };

interface GiftFormModalProps {
  mode: 'add' | 'edit' | null;
  gift: Gift | null;
  onClose: () => void;
  onSubmit: (draft: GiftDraft) => void;
  onDelete?: (id: string) => void;
}

// 呼び出し側で key={mode + gift?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function GiftFormModal({ mode, gift, onClose, onSubmit, onDelete }: GiftFormModalProps) {
  const [draft, setDraft] = useState<GiftDraft>(() =>
    mode === 'edit' && gift
      ? { from: gift.from, item: gift.item, date: gift.date, returnStatus: gift.returnStatus, returnItem: gift.returnItem, note: gift.note }
      : EMPTY_DRAFT,
  );

  if (!mode) return null;

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="font-bold text-gray-800">{mode === 'add' ? 'お祝いを記録' : 'お祝いを編集'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              どなたから <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder="例: 祖父母(夫)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">頂いた日</label>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">頂いた品</label>
            <input
              type="text"
              value={draft.item}
              onChange={(e) => setDraft({ ...draft, item: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
              placeholder="例: お祝い金 10万円"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">お返し状況</label>
              <select
                value={draft.returnStatus}
                onChange={(e) => setDraft({ ...draft, returnStatus: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none bg-white"
              >
                <option>未完了</option>
                <option>済</option>
                <option>不要</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">お返し品</label>
              <input
                type="text"
                value={draft.returnItem}
                onChange={(e) => setDraft({ ...draft, returnItem: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">メモ</label>
            <textarea
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none h-20 resize-none"
            />
          </div>
          <button
            onClick={() => onSubmit(draft)}
            disabled={!draft.from}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl mt-4 shadow-sm active:bg-blue-600 transition disabled:bg-gray-300"
          >
            {mode === 'add' ? '追加する' : '保存する'}
          </button>
          {mode === 'edit' && gift && onDelete && (
            <button
              onClick={() => onDelete(gift.id)}
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
