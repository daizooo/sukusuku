'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Nursery, NurseryChecklist } from '@/types/app';
import { countChecked, NURSERY_CHECK_GROUPS, NURSERY_CHECK_TOTAL } from '@/lib/nurseryChecklist';

interface NurseryChecklistModalProps {
  nursery: Nursery | null;
  onClose: () => void;
  onSubmit: (checklist: NurseryChecklist) => void;
}

// 呼び出し側で key={nursery?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function NurseryChecklistModal({ nursery, onClose, onSubmit }: NurseryChecklistModalProps) {
  const [draft, setDraft] = useState<NurseryChecklist>(() => nursery?.checklist ?? {});

  if (!nursery) return null;

  const update = (id: string, patch: Partial<NurseryChecklist[string]>) =>
    setDraft((prev) => {
      const current = prev[id] ?? { checked: false, memo: '' };
      return { ...prev, [id]: { ...current, ...patch } };
    });

  const checkedCount = countChecked(draft);

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-start p-5 pb-3 border-b shrink-0">
          <div>
            <h3 className="font-bold text-gray-800">見学チェックリスト</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {nursery.name}・{checkedCount}/{NURSERY_CHECK_TOTAL}項目
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {NURSERY_CHECK_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <h4 className="text-xs font-bold text-gray-500">{group.title}</h4>
              {group.items.map((item) => {
                const state = draft[item.id];
                const checked = state?.checked ?? false;
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3 transition ${checked ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}
                  >
                    <button
                      onClick={() => update(item.id, { checked: !checked })}
                      className="w-full flex items-start text-left"
                    >
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 mr-2 ${
                          checked ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300 text-transparent'
                        }`}
                      >
                        <Check size={14} strokeWidth={3} />
                      </span>
                      <span>
                        <span className="block text-sm font-bold text-gray-800 leading-tight">{item.title}</span>
                        <span className="block text-[11px] text-gray-500 leading-relaxed mt-1">{item.point}</span>
                      </span>
                    </button>
                    <textarea
                      value={state?.memo ?? ''}
                      onChange={(e) => update(item.id, { memo: e.target.value })}
                      placeholder="聞いたこと・気になったこと"
                      className="w-full mt-2 border border-gray-200 rounded-lg p-2 text-xs outline-none focus:border-blue-500 h-14 resize-none bg-white"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="p-5 pt-3 pb-8 sm:pb-5 border-t shrink-0">
          <button
            onClick={() => onSubmit(draft)}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl shadow-sm active:bg-blue-600 transition"
          >
            保存する
          </button>
        </div>
      </div>
    </div>
  );
}
