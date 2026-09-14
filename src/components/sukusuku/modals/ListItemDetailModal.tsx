'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { ListGroup, ListItem } from '@/types/app';

// 項目の中身（タイトル・メモ）と、どのグループに入れるかを変える。
// 一覧では打ち込んだ順にチェックを付けていくだけなので、入れ替えや補足はここへ逃がす。
export interface ListItemDraft {
  title: string;
  note: string;
  groupId: string | null;
}

interface ListItemDetailModalProps {
  item: ListItem | null;
  /** 表示中のリストのグループ。0件なら移動先の選択は出さない。 */
  groups: ListGroup[];
  /** リストごとの「グループ」の呼び名（「お店」など）。 */
  groupLabel: string;
  onClose: () => void;
  onSubmit: (item: ListItem, draft: ListItemDraft) => void;
  onDelete: (id: string) => void;
}

// 呼び出し側で key={item?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function ListItemDetailModal({
  item,
  groups,
  groupLabel,
  onClose,
  onSubmit,
  onDelete,
}: ListItemDetailModalProps) {
  const [draft, setDraft] = useState<ListItemDraft>(() => ({
    title: item?.title ?? '',
    note: item?.note ?? '',
    groupId: item?.groupId ?? null,
  }));

  if (!item) return null;

  const set = (patch: Partial<ListItemDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center px-5 py-3 border-b shrink-0">
          <h3 className="font-bold text-gray-800">項目</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              内容 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder="例: 牛乳2本"
            />
            <p className="text-[10px] text-gray-400 mt-1.5">個数は「牛乳2本」のように内容へ書きます。</p>
          </div>

          {groups.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">{groupLabel}</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => set({ groupId: null })}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-full border transition ${
                    draft.groupId === null
                      ? 'bg-blue-50 border-blue-300 text-blue-600'
                      : 'bg-white border-gray-200 text-gray-500'
                  }`}
                >
                  未分類
                </button>
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => set({ groupId: group.id })}
                    className={`text-xs font-bold px-2.5 py-1.5 rounded-full border transition ${
                      draft.groupId === group.id
                        ? 'bg-blue-50 border-blue-300 text-blue-600'
                        : 'bg-white border-gray-200 text-gray-500'
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">メモ</label>
            <textarea
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="銘柄、売り場、頼んだ相手など"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 h-20 resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-3 pb-8 sm:pb-3 border-t shrink-0">
          <button
            onClick={() => onSubmit(item, { ...draft, title: draft.title.trim() })}
            disabled={!draft.title.trim()}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl shadow-sm active:bg-blue-600 transition disabled:bg-gray-300"
          >
            保存する
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="w-full flex items-center justify-center text-xs text-red-500 font-medium py-2 mt-1"
          >
            <Trash2 size={14} className="mr-1" /> 削除する
          </button>
        </div>
      </div>
    </div>
  );
}
