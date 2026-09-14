'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Settings2, Trash2, X } from 'lucide-react';
import type { ListBoard, ListGroup, ListItem } from '@/types/app';
import ListFormModal, { type ListDraft } from '../modals/ListFormModal';
import ListItemDetailModal, { type ListItemDraft } from '../modals/ListItemDetailModal';

/**
 * 買い出し・やりたいこと・やることなどのリスト（docs/lists.md）。
 *
 * Google Keepと同じく、**枠（カード）が操作の単位**になる。お店ごとに枠があり、
 * 枠は一覧の中で足せる・消せる。項目もその枠の中で足せる・消せる。
 * どのお店に足すかは「そのお店の枠で打つ」ことで決まるので、追加先を選ぶ手順はない。
 *
 * スクロールするのは枠の一覧だけで、リストの切り替えは上に固定する。
 */
interface ListTabProps {
  lists: ListBoard[];
  groups: ListGroup[];
  items: ListItem[];
  isLoading?: boolean;
  onAddList: (draft: ListDraft) => void;
  onUpdateList: (list: ListBoard, draft: ListDraft) => void;
  onDeleteList: (id: string) => void;
  onAddGroup: (listId: string, name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onAddItem: (listId: string, groupId: string | null, title: string) => void;
  onToggleItem: (id: string) => void;
  onUpdateItem: (item: ListItem, draft: ListItemDraft) => void;
  onDeleteItem: (id: string) => void;
  onClearDone: (listId: string) => void;
  onAddDefaultLists: () => void;
}

/** チェックの丸。押した先が分かるよう、未完了でも枠は出しておく。 */
function ItemCheck({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={done}
      className={`flex-none w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
        done ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300 text-transparent'
      }`}
    >
      <Check size={14} strokeWidth={3} />
    </button>
  );
}

function ItemRow({
  item,
  onToggle,
  onOpen,
  onDelete,
}: {
  item: ListItem;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-2 pl-3 pr-1 py-2.5 border-b border-gray-100 last:border-b-0">
      <ItemCheck done={item.done} onToggle={onToggle} label={`${item.title}を${item.done ? '戻す' : '完了にする'}`} />
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className={`block text-sm break-words ${item.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
          {item.title}
        </span>
        {item.note && <span className="block text-[11px] text-gray-400 break-words mt-0.5">{item.note}</span>}
      </button>
      {/* その場で消せるようにする。打ち間違いをすぐ取り消せるほうが、
          いちいち詳細を開くより手数が少ない。 */}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`${item.title}を削除`}
        className="flex-none text-gray-300 hover:text-red-500 p-1.5"
      >
        <X size={16} />
      </button>
    </div>
  );
}

/**
 * 押すまではただの「+ ○○」の行で、押すと入力欄になる。
 * 改行で確定しても欄は開いたままにするので、思いついたものを続けて打てる
 * （Google Keepと同じ動き）。項目の追加にも枠の追加にも使う。
 */
function AddRow({
  label,
  placeholder,
  onSubmit,
  tone = 'plain',
}: {
  label: string;
  placeholder: string;
  onSubmit: (value: string) => void;
  /** 枠そのものを足す行は、項目の追加と見分けられるよう破線にする。 */
  tone?: 'plain' | 'outlined';
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft('')}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-50 transition ${
          tone === 'outlined' ? 'border border-dashed border-gray-300 rounded-xl justify-center' : ''
        }`}
      >
        <Plus size={16} className="flex-none" />
        {label}
      </button>
    );
  }

  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    onSubmit(value);
    setDraft('');
  };

  return (
    <div
      className={`flex items-center gap-2 pl-3 pr-1 py-1.5 ${
        tone === 'outlined' ? 'border border-dashed border-gray-300 rounded-xl' : ''
      }`}
    >
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setDraft(null);
        }}
        // 打ち終わって他へ触れたときは、書きかけが無ければ欄を畳む。
        onBlur={() => setDraft((prev) => (prev && prev.trim() ? prev : null))}
        autoFocus
        placeholder={placeholder}
        className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-blue-500"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={submit}
        disabled={!draft.trim()}
        className="flex-none text-sm font-bold text-blue-600 px-2 py-2 disabled:text-gray-300"
      >
        追加
      </button>
    </div>
  );
}

export default function ListTab({
  lists,
  groups,
  items,
  isLoading,
  onAddList,
  onUpdateList,
  onDeleteList,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onAddItem,
  onToggleItem,
  onUpdateItem,
  onDeleteItem,
  onClearDone,
  onAddDefaultLists,
}: ListTabProps) {
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [listModal, setListModal] = useState<{ mode: 'add' | 'edit'; list: ListBoard | null } | null>(null);
  const [detailItem, setDetailItem] = useState<ListItem | null>(null);

  // 選んでいたリストが消えたときは先頭のリストへ戻す。
  const selected = lists.find((list) => list.id === selectedListId) ?? lists[0] ?? null;
  const listGroups = useMemo(
    () => (selected ? groups.filter((group) => group.listId === selected.id) : []),
    [groups, selected],
  );
  const listItems = useMemo(
    () => (selected ? items.filter((item) => item.listId === selected.id) : []),
    [items, selected],
  );

  const undoneItems = listItems.filter((item) => !item.done);
  const doneItems = listItems.filter((item) => item.done);
  const ungroupedItems = undoneItems.filter((item) => item.groupId === null);
  const groupLabel = selected?.groupLabel ?? 'グループ';

  const deleteGroupWithConfirm = (group: ListGroup) => {
    const count = listItems.filter((item) => item.groupId === group.id).length;
    const suffix = count > 0 ? `\n中の${count}件は「未分類」に残ります。` : '';
    if (!window.confirm(`「${group.name}」を削除しますか？${suffix}`)) return;
    onDeleteGroup(group.id);
  };

  if (isLoading) {
    return (
      <div className="p-4 h-full">
        <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
      </div>
    );
  }

  if (lists.length === 0) {
    return (
      <div className="p-4 h-full flex flex-col items-center justify-center text-center space-y-3">
        <p className="text-sm text-gray-400">リストはまだありません</p>
        <button
          onClick={onAddDefaultLists}
          className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 hover:bg-blue-100 transition"
        >
          よく使う3つのリストを作る
          <span className="block font-normal text-[10px] text-blue-400 mt-1">買い出し・やりたいこと・やること</span>
        </button>
        <button
          onClick={() => setListModal({ mode: 'add', list: null })}
          className="text-xs font-bold text-gray-500 px-4 py-2"
        >
          自分でリストを作る
        </button>
        <ListFormModal
          key={`${listModal?.mode}-${listModal?.list?.id ?? 'new'}`}
          mode={listModal?.mode ?? null}
          list={listModal?.list ?? null}
          onClose={() => setListModal(null)}
          onSubmit={(draft) => {
            onAddList(draft);
            setListModal(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      {/* 上段（固定）: リストの切り替えだけ。お店の出し入れは枠の側で行う。 */}
      <div className="shrink-0 flex items-center gap-2 pb-3 mb-3 border-b border-gray-200">
        {/* リストは1つずつ枠を持たせて切れ目を出す。 */}
        <div role="tablist" aria-label="リストの切り替え" className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto">
          {lists.map((list) => {
            const current = list.id === selected?.id;
            return (
              <button
                key={list.id}
                type="button"
                role="tab"
                aria-selected={current}
                onClick={() => setSelectedListId(list.id)}
                className={`flex-none min-h-9 px-3.5 rounded-xl text-sm font-bold border transition ${
                  current
                    ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
              >
                {list.name}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setListModal({ mode: 'add', list: null })}
          aria-label="リストを追加"
          className="flex-none text-blue-500 bg-blue-50 p-2 rounded-full hover:bg-blue-100 transition"
        >
          <Plus size={20} />
        </button>
        {selected && (
          <button
            onClick={() => setListModal({ mode: 'edit', list: selected })}
            aria-label="リストの設定"
            className="flex-none text-gray-400 p-2 rounded-full hover:bg-gray-100 transition"
          >
            <Settings2 size={20} />
          </button>
        )}
      </div>

      {/* 下段（スクロール）: 枠の一覧 */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {/* グループを作っていないリストは、枠1つのただのチェックリストになる。 */}
        {listGroups.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {undoneItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => onToggleItem(item.id)}
                onOpen={() => setDetailItem(item)}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}
            <AddRow
              label="追加"
              placeholder="追加する項目"
              onSubmit={(title) => selected && onAddItem(selected.id, null, title)}
            />
          </div>
        ) : (
          <>
            {listGroups.map((group) => {
              const groupItems = undoneItems.filter((item) => item.groupId === group.id);
              return (
                <section key={group.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* 名前は枠の中の一番上に小さく置くだけにする。帯で強く見出しにすると、
                      枠がいくつも並んだときに名前のほうが目立って中身が読みにくい。 */}
                  <div className="flex items-center justify-between pl-3 pr-1 pt-2 pb-1">
                    <span className="text-xs font-bold text-gray-500">
                      {group.name}
                      {groupItems.length > 0 && <span className="ml-1.5 font-normal text-gray-400">{groupItems.length}</span>}
                    </span>
                    <button
                      onClick={() => deleteGroupWithConfirm(group)}
                      aria-label={`${group.name}を削除`}
                      className="text-gray-300 hover:text-red-500 p-1.5"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {groupItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onToggle={() => onToggleItem(item.id)}
                      onOpen={() => setDetailItem(item)}
                      onDelete={() => onDeleteItem(item.id)}
                    />
                  ))}
                  <AddRow
                    label="追加"
                    placeholder={`${group.name}に追加`}
                    onSubmit={(title) => selected && onAddItem(selected.id, group.id, title)}
                  />
                </section>
              );
            })}

            {/* どの枠にも入れていない項目があるときだけ出す。 */}
            {ungroupedItems.length > 0 && (
              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="pl-3 pt-2 pb-1">
                  <span className="text-xs font-bold text-gray-400">未分類</span>
                </div>
                {ungroupedItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onToggle={() => onToggleItem(item.id)}
                    onOpen={() => setDetailItem(item)}
                    onDelete={() => onDeleteItem(item.id)}
                  />
                ))}
                <AddRow
                  label="追加"
                  placeholder="追加する項目"
                  onSubmit={(title) => selected && onAddItem(selected.id, null, title)}
                />
              </section>
            )}
          </>
        )}

        {/* 枠そのものを足す。お店が増えたらここから作る。 */}
        {selected && (
          <AddRow
            tone="outlined"
            label={`${groupLabel}を追加`}
            placeholder={`${groupLabel}の名前（例: イオン）`}
            onSubmit={(name) => onAddGroup(selected.id, name)}
          />
        )}

        {doneItems.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className={`flex items-center justify-between px-2 py-1.5 bg-gray-50 ${showDone ? 'border-b border-gray-200' : ''}`}>
              <button
                onClick={() => setShowDone((prev) => !prev)}
                className="flex items-center text-xs font-bold text-gray-500 py-1"
              >
                {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="ml-1">完了 {doneItems.length}</span>
              </button>
              {selected && (
                <button
                  onClick={() => {
                    if (!window.confirm(`「${selected.name}」の完了した項目をすべて削除しますか？`)) return;
                    onClearDone(selected.id);
                  }}
                  className="text-[11px] text-gray-400 px-2 py-1"
                >
                  まとめて消す
                </button>
              )}
            </div>
            {showDone &&
              doneItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onToggle={() => onToggleItem(item.id)}
                  onOpen={() => setDetailItem(item)}
                  onDelete={() => onDeleteItem(item.id)}
                />
              ))}
          </section>
        )}
      </div>

      <ListFormModal
        key={`${listModal?.mode}-${listModal?.list?.id ?? 'new'}`}
        mode={listModal?.mode ?? null}
        list={listModal?.list ?? null}
        groups={listGroups}
        onRenameGroup={onRenameGroup}
        onDeleteGroup={deleteGroupWithConfirm}
        onClose={() => setListModal(null)}
        onSubmit={(draft) => {
          if (listModal?.mode === 'edit' && listModal.list) onUpdateList(listModal.list, draft);
          else onAddList(draft);
          setListModal(null);
        }}
        onDelete={(id) => {
          if (!window.confirm('このリストを削除しますか？\n中の項目もすべて消えます。')) return;
          onDeleteList(id);
          setListModal(null);
        }}
      />
      <ListItemDetailModal
        key={detailItem?.id ?? 'none'}
        item={detailItem}
        groups={listGroups}
        groupLabel={groupLabel}
        onClose={() => setDetailItem(null)}
        onSubmit={(item, draft) => {
          onUpdateItem(item, draft);
          setDetailItem(null);
        }}
        onDelete={(id) => {
          onDeleteItem(id);
          setDetailItem(null);
        }}
      />
    </div>
  );
}
