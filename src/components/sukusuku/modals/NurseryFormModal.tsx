'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Nursery, NurseryStatus } from '@/types/app';
import { useBackLayer } from '@/lib/browserHistory';
import { useBackdropClose } from '../ui/useBackdropClose';
import { swipeBoundary } from '../ui/useSwipeNavigation';

// 園の情報（連絡先・見学の日時・メモ）を編集する。
// 見学チェックリストは保活タブの「チェックリスト」側でその場で編集するため、ここでは触らない
// （checklistは編集せずそのまま持ち回り、保存時に元の状態を書き戻す）。
export type NurseryDraft = Omit<Nursery, 'id'>;

const EMPTY_DRAFT: NurseryDraft = {
  name: '',
  address: '',
  status: '未見学',
  phone: '',
  visitDate: null,
  visitTime: null,
  memo: '',
  checklist: {},
};

const STATUSES: NurseryStatus[] = ['未見学', '見学予約済', '見学済'];

interface NurseryFormModalProps {
  mode: 'add' | 'edit' | null;
  nursery: Nursery | null;
  onClose: () => void;
  onSubmit: (draft: NurseryDraft) => void;
  onDelete?: (id: string) => void;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-bold text-gray-500 mb-2">{children}</h4>;
}

// 呼び出し側で key={mode + nursery?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function NurseryFormModal({ mode, nursery, onClose, onSubmit, onDelete }: NurseryFormModalProps) {
  const [draft, setDraft] = useState<NurseryDraft>(() =>
    mode === 'edit' && nursery
      ? {
          name: nursery.name,
          address: nursery.address,
          status: nursery.status,
          phone: nursery.phone,
          visitDate: nursery.visitDate,
          visitTime: nursery.visitTime,
          memo: nursery.memo,
          checklist: nursery.checklist,
        }
      : EMPTY_DRAFT,
  );

  // 戻る操作（ブラウザ・スマホ）でこのモーダルを閉じる。開いている間だけ効かせる。
  useBackLayer(onClose, mode !== null);
  // 暗い部分を押しても閉じる。
  const backdropClose = useBackdropClose(onClose);

  if (!mode) return null;

  const set = (patch: Partial<NurseryDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div
      className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      {...backdropClose}
      {...swipeBoundary}
    >
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center px-5 py-3 border-b shrink-0">
          <h3 className="font-bold text-gray-800">{mode === 'add' ? '保育園を追加' : draft.name || '保育園を編集'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <div>
            <SectionTitle>園の情報</SectionTitle>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  園名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => set({ name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                  placeholder="例: 舞原保育園"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">住所</label>
                <input
                  type="text"
                  value={draft.address}
                  onChange={(e) => set({ address: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                  placeholder="例: 熊本市南区城南町舞原291-7"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">電話番号</label>
                <input
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                  placeholder="例: 0964-28-2121"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">状況</label>
                <select
                  value={draft.status}
                  onChange={(e) => set({ status: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none bg-white"
                >
                  {STATUSES.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <SectionTitle>見学の日時</SectionTitle>
            <div className="flex items-center space-x-2">
              <input
                type="date"
                value={draft.visitDate ?? ''}
                onChange={(e) => set({ visitDate: e.target.value || null })}
                className="flex-1 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 bg-white text-gray-800"
              />
              <input
                type="time"
                value={draft.visitTime ?? ''}
                onChange={(e) => set({ visitTime: e.target.value || null })}
                className="w-28 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 bg-white text-gray-800"
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">日時が決まったら、状況も「見学予約済」に変えておきましょう。</p>
          </div>

          <div>
            <SectionTitle>その他のメモ</SectionTitle>
            <textarea
              value={draft.memo}
              onChange={(e) => set({ memo: e.target.value })}
              placeholder="申請時期、園の雰囲気、夫婦で相談したいことなど"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 h-20 resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-3 pb-8 sm:pb-3 border-t shrink-0">
          <button
            onClick={() => onSubmit(draft)}
            disabled={!draft.name}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl shadow-sm active:bg-blue-600 transition disabled:bg-gray-300"
          >
            {mode === 'add' ? '追加する' : '保存する'}
          </button>
          {mode === 'edit' && nursery && onDelete && (
            <button
              onClick={() => onDelete(nursery.id)}
              className="w-full flex items-center justify-center text-xs text-red-500 font-medium py-2 mt-1"
            >
              <Trash2 size={14} className="mr-1" /> 削除する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
