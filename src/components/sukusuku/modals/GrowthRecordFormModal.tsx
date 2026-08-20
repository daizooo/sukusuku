'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { GrowthRecord } from '@/types/app';
import { formatDateString } from '@/lib/dateUtils';

export interface GrowthRecordDraft {
  recordedDate: string;
  monthAge: string;
  height: string;
  weight: string;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyDraft = (): GrowthRecordDraft => ({ recordedDate: todayStr(), monthAge: '', height: '', weight: '' });

interface GrowthRecordFormModalProps {
  mode: 'add' | 'edit' | null;
  record: GrowthRecord | null;
  onClose: () => void;
  onSubmit: (draft: GrowthRecordDraft) => void;
  onDelete?: (id: string) => void;
}

// 呼び出し側で key={mode + record?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function GrowthRecordFormModal({ mode, record, onClose, onSubmit, onDelete }: GrowthRecordFormModalProps) {
  const [draft, setDraft] = useState<GrowthRecordDraft>(() =>
    mode === 'edit' && record
      ? {
          recordedDate: record.recordedDate,
          monthAge: record.month !== null ? String(record.month) : '',
          height: record.height !== null ? String(record.height) : '',
          weight: record.weight !== null ? String(record.weight) : '',
        }
      : emptyDraft(),
  );

  if (!mode) return null;

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="font-bold text-gray-800">{mode === 'add' ? '身長・体重を記録' : '記録を編集'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">記録日</label>
            <input
              type="date"
              value={draft.recordedDate}
              onChange={(e) => setDraft({ ...draft, recordedDate: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
            />
            {draft.recordedDate && (
              <p className="text-[10px] text-gray-400 mt-1">{formatDateString(new Date(draft.recordedDate))}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">生後ヶ月</label>
            <input
              type="number"
              value={draft.monthAge}
              onChange={(e) => setDraft({ ...draft, monthAge: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
              placeholder="例: 1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">身長 (cm)</label>
              <input
                type="number"
                step="0.1"
                value={draft.height}
                onChange={(e) => setDraft({ ...draft, height: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">体重 (kg)</label>
              <input
                type="number"
                step="0.1"
                value={draft.weight}
                onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
              />
            </div>
          </div>
          <button
            onClick={() => onSubmit(draft)}
            disabled={!draft.recordedDate}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl mt-4 shadow-sm active:bg-blue-600 transition disabled:bg-gray-300"
          >
            {mode === 'add' ? '追加する' : '保存する'}
          </button>
          {mode === 'edit' && record && onDelete && (
            <button
              onClick={() => onDelete(record.id)}
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
