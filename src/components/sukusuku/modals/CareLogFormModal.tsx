'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { CareLog } from '@/types/app';

export interface CareLogDraft {
  amount: string;
  note: string;
  time: string; // "HH:mm"
}

interface CareLogFormModalProps {
  log: CareLog | null;
  onClose: () => void;
  onSubmit: (draft: CareLogDraft) => void;
  onDelete: (id: string) => void;
}

const toTimeInput = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

// 呼び出し側で key={log?.id} を指定し、対象のlogが変わるたびに再マウントして初期値を計算し直す前提
export default function CareLogFormModal({ log, onClose, onSubmit, onDelete }: CareLogFormModalProps) {
  const [draft, setDraft] = useState<CareLogDraft>(() =>
    log ? { amount: log.amount, note: log.note, time: toTimeInput(log.time) } : { amount: '', note: '', time: '' },
  );

  if (!log) return null;

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="font-bold text-gray-800">{log.label}の記録を編集</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">時刻</label>
            <input
              type="time"
              value={draft.time}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">量・時間など</label>
            <input
              type="text"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
              placeholder="例: 100ml"
            />
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
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl mt-4 shadow-sm active:bg-blue-600 transition"
          >
            保存する
          </button>
          <button onClick={() => onDelete(log.id)} className="w-full flex items-center justify-center text-xs text-red-500 font-medium py-2">
            <Trash2 size={14} className="mr-1" /> 削除する
          </button>
        </div>
      </div>
    </div>
  );
}
