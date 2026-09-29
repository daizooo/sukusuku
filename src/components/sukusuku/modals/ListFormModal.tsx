'use client';

import { useState } from 'react';
import { Lock, Trash2, X } from 'lucide-react';
import type { ListBoard, ListGroup } from '@/types/app';

// リストそのものの追加・編集。
//
// 束ねる区切りの呼び名はリストごとに変えられるようにしていたが、リストによって
// 「お店を追加」「ジャンルを追加」と文言が変わるのが読みにくかったため、
// 画面では「グループ」で統一する。groupLabel は保存済みの値をそのまま持ち回るだけで、
// 画面には出さない（docs/lists.md §3 からの変更点）。
export interface ListDraft {
  name: string;
  groupLabel: string;
  /** 自分だけのリストか。新しく作るときの既定は「自分だけ」。 */
  isPrivate: boolean;
}

export const DEFAULT_GROUP_LABEL = 'グループ';

/**
 * 共有設定の2択。mobile版（ListFormModal）と同じ文言・同じ並びにする。
 * 新しいリストの既定は「自分だけ」で、家族に見せたいものだけ共有へ切り替える。
 */
const SHARING_TABS: { value: boolean; label: string }[] = [
  { value: false, label: '共有（家族全員）' },
  { value: true, label: '自分だけ' },
];

// リスト名に添える絵文字の候補。名前は自由入力なので絵文字を打ち込めば入るが、
// PCのブラウザからは打ちにくいため、よく使うものをタップで足せるようにする。
const NAME_EMOJIS = ['🛒', '🧺', '📝', '✅', '🎁', '🏥', '🍼', '👶', '🧴', '💡'];

interface ListFormModalProps {
  mode: 'add' | 'edit' | null;
  list: ListBoard | null;
  /** 編集中のリストのグループ。ここで名前を直したり消したりできる。 */
  groups?: ListGroup[];
  onClose: () => void;
  onSubmit: (draft: ListDraft) => void;
  onDelete?: (id: string) => void;
  onRenameGroup?: (id: string, name: string) => void;
  onDeleteGroup?: (group: ListGroup) => void;
}

/**
 * グループ1件の行。名前は打つたびに保存すると重いので、入力中は手元で持ち、
 * 入力を終えた（フォーカスが外れた）ときにだけ保存する。
 */
function GroupRow({
  group,
  onRename,
  onDelete,
}: {
  group: ListGroup;
  onRename: (id: string, name: string) => void;
  onDelete: (group: ListGroup) => void;
}) {
  const [name, setName] = useState(group.name);

  const commit = () => {
    const next = name.trim();
    // 空のまま確定させると、どのお店だったのか分からなくなるため元に戻す。
    if (!next) {
      setName(group.name);
      return;
    }
    if (next !== group.name) onRename(group.id, next);
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="flex-1 min-w-0 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
      />
      <button
        type="button"
        onClick={() => onDelete(group)}
        aria-label={`${group.name}を削除`}
        className="flex-none text-gray-400 hover:text-red-500 p-2"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

// 呼び出し側で key={mode + list?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function ListFormModal({
  mode,
  list,
  groups = [],
  onClose,
  onSubmit,
  onDelete,
  onRenameGroup,
  onDeleteGroup,
}: ListFormModalProps) {
  const [draft, setDraft] = useState<ListDraft>(() =>
    mode === 'edit' && list
      ? { name: list.name, groupLabel: list.groupLabel, isPrivate: list.isPrivate }
      : { name: '', groupLabel: DEFAULT_GROUP_LABEL, isPrivate: true },
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
              placeholder="例: 買い出し🛒 / やりたいこと / やること"
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {NAME_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => set({ name: draft.name + emoji })}
                  aria-label={`${emoji}を名前に足す`}
                  className="text-base leading-none w-9 h-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              絵文字は名前の末尾に足されます。自分で打ち込んでも構いません。
            </p>
          </div>

          {/* 共有設定。自分だけにすると、家族の他のメンバーにはリストごと（中の項目も）
              表示されなくなる。 */}
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-gray-700 mb-1">
              <Lock size={12} className="text-gray-400" />
              共有設定
            </label>
            <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
              {SHARING_TABS.map((tab) => (
                <button
                  key={String(tab.value)}
                  type="button"
                  onClick={() => set({ isPrivate: tab.value })}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                    draft.isPrivate === tab.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              「自分だけ」にすると、このリストと中の項目は自分にしか表示されません。
            </p>
          </div>

          {/* 枠のゴミ箱からも消せるが、名前を直せるのはここだけなので一覧を置く。 */}
          {mode === 'edit' && groups.length > 0 && onRenameGroup && onDeleteGroup && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">グループの一覧</label>
              <div className="space-y-2">
                {groups.map((group) => (
                  <GroupRow key={group.id} group={group} onRename={onRenameGroup} onDelete={onDeleteGroup} />
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                名前は入力を終えると保存されます。消しても中の項目は「未分類」に残ります。
              </p>
            </div>
          )}
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
