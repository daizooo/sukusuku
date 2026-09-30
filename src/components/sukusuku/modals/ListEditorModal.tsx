'use client';

import { useState, type ReactNode } from 'react';
import { Lock, Pin, PinOff, Trash2, Users } from 'lucide-react';
import type { ListBoard } from '@/types/app';

// リストの編集モード。Google Keepと同じく、一覧でクリックしたカードが画面の中央に
// 拡大して開き、見出し・項目・グループ・固定・共有・削除までここで済ませる。
// 以前あった「リストの設定」のモーダルは無くした（開く手間を減らすため）。
// mobile版（`mobile/src/components/list/ListEditorModal.tsx`）と同じ仕様。
//
// 項目やグループの中身は ListTab が持つ（長押しの並べ替えが一覧と同じ仕組みを使うため）。
// ここは外枠・見出し・下の道具列だけを受け持つ。
//
// 見出しは打つたびに保存すると重いので、入力中は手元で持ち、閉じるとき（と入力を
// 終えたとき）にだけ保存する。呼び出し側で対象のリストごとに作り直す前提。

/**
 * リスト自身の保存内容。束ねる区切りの呼び名（groupLabel）は画面には出さず、
 * 保存済みの値をそのまま持ち回るだけ（docs/lists.md §3 からの変更点）。
 */
export interface ListDraft {
  name: string;
  groupLabel: string;
  /** 自分だけのリストか。新しく作るときの既定は「自分だけ」。 */
  isPrivate: boolean;
}

export const DEFAULT_GROUP_LABEL = 'グループ';

interface ListEditorModalProps {
  list: ListBoard;
  /** 開いた直後に見出しへ入力を移す。新しく作ったリスト用。 */
  focusTitle?: boolean;
  /** 見出しを確定する。空のままなら呼ばない。 */
  onRename: (name: string) => void;
  onTogglePin: () => void;
  onToggleShare: () => void;
  onDelete: () => void;
  /** 閉じる。見出しの書きかけがあれば、先に渡してから呼ぶ。 */
  onClose: (draftName: string) => void;
  children: ReactNode;
}

export default function ListEditorModal({
  list,
  focusTitle = false,
  onRename,
  onTogglePin,
  onToggleShare,
  onDelete,
  onClose,
  children,
}: ListEditorModalProps) {
  const [name, setName] = useState(list.name);

  const commitName = () => {
    const next = name.trim();
    // 空のまま確定させると何のリストか分からなくなるため、直前の名前へ戻す。
    if (!next) {
      setName(list.name);
      return;
    }
    if (next !== list.name) onRename(next);
  };

  return (
    // 暗い部分を押すと閉じる（Keepと同じ）。カードの中の操作は伝えない。
    <div
      className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={() => onClose(name)}
    >
      <div
        role="dialog"
        aria-label="リストの編集"
        // 中身が少ないうちは内容の高さ。多いときは画面に収まるところまで縮め、中身がスクロールする。
        className="bg-white w-full max-w-md max-h-full rounded-2xl shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-1 pl-4 pr-2 py-2 border-b border-gray-200">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            autoFocus={focusTitle}
            placeholder="タイトル"
            aria-label="リスト名"
            className="flex-1 min-w-0 py-2 text-[17px] font-bold text-gray-900 outline-none placeholder:text-gray-400"
          />
          {/* よく開くリストを一覧の先頭へ固定する（Keepのピン止め）。 */}
          <button
            type="button"
            onClick={onTogglePin}
            aria-label={list.pinned ? '固定を外す' : '一覧の先頭に固定する'}
            aria-pressed={list.pinned}
            className={`flex-none p-2 rounded-full transition ${
              list.pinned ? 'text-blue-600' : 'text-gray-400 hover:bg-gray-100'
            }`}
          >
            {list.pinned ? <Pin size={18} fill="currentColor" /> : <PinOff size={18} />}
          </button>
        </div>

        {/* 中の枠は上に余白（mt-3）を持つので、上だけ空けない。 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 [&>*]:mt-3">{children}</div>

        {/* 下の道具列。共有・削除・閉じる。 */}
        <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-t border-gray-200">
          <button
            type="button"
            onClick={onToggleShare}
            aria-label={
              list.isPrivate
                ? '共有設定: 自分だけ。押すと家族全員に共有する'
                : '共有設定: 共有中。押すと自分だけにする'
            }
            className={`flex items-center gap-1.5 px-2.5 py-2.5 rounded-lg text-xs font-medium hover:bg-gray-100 transition ${
              list.isPrivate ? 'text-gray-500' : 'text-blue-600'
            }`}
          >
            {list.isPrivate ? <Lock size={16} /> : <Users size={16} />}
            {list.isPrivate ? '自分だけ' : '共有中'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="このリストを削除する"
            className="p-2.5 rounded-lg text-red-500 hover:bg-red-50 transition"
          >
            <Trash2 size={16} />
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onClose(name)}
            className="px-2.5 py-2.5 rounded-lg text-[13px] font-bold text-gray-700 hover:bg-gray-100 transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
