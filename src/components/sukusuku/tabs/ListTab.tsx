'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Settings2, Trash2, X } from 'lucide-react';
import type { ListBoard, ListGroup, ListItem } from '@/types/app';
import ListFormModal, { type ListDraft } from '../modals/ListFormModal';
import ListItemDetailModal, { type ListItemDraft } from '../modals/ListItemDetailModal';

/**
 * 買い出し・やりたいこと・やることなどのリスト（docs/lists.md）。
 *
 * 打ち込む場所を常に一番上に固定し、スクロールするのは項目の一覧だけにする。
 * 項目そのものは場所を持たず、「どのグループに追加するか」を先に選んでから打つ
 * （買い出しでお店を選んでから商品を打つ、いままでのやり方をそのまま形にしたもの）。
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
  onDeleteGroup: (id: string) => void;
  onAddItem: (listId: string, groupId: string | null, title: string) => void;
  onToggleItem: (id: string) => void;
  onUpdateItem: (item: ListItem, draft: ListItemDraft) => void;
  onDeleteItem: (id: string) => void;
  onClearDone: (listId: string) => void;
  onAddDefaultLists: () => void;
}

/** 絞り込みと「追加先」を兼ねる選択。'all' はどのグループにも寄せない状態。 */
type GroupFilter = string | 'all';

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
}: {
  item: ListItem;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 border-b border-gray-100 last:border-b-0">
      <ItemCheck done={item.done} onToggle={onToggle} label={`${item.title}を${item.done ? '戻す' : '完了にする'}`} />
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className={`block text-sm break-words ${item.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
          {item.title}
        </span>
        {item.note && <span className="block text-[11px] text-gray-400 break-words mt-0.5">{item.note}</span>}
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
  onDeleteGroup,
  onAddItem,
  onToggleItem,
  onUpdateItem,
  onDeleteItem,
  onClearDone,
  onAddDefaultLists,
}: ListTabProps) {
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [draftTitle, setDraftTitle] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
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

  // 消えたグループで絞り込んだままにならないようにする。
  const activeFilter: GroupFilter =
    groupFilter !== 'all' && !listGroups.some((group) => group.id === groupFilter) ? 'all' : groupFilter;
  const visibleItems = activeFilter === 'all' ? listItems : listItems.filter((item) => item.groupId === activeFilter);
  const undoneItems = visibleItems.filter((item) => !item.done);
  const doneItems = visibleItems.filter((item) => item.done);

  const selectList = (id: string) => {
    setSelectedListId(id);
    setGroupFilter('all');
    setDraftTitle('');
    setNewGroupName(null);
  };

  const submitItem = () => {
    const title = draftTitle.trim();
    if (!selected || !title) return;
    onAddItem(selected.id, activeFilter === 'all' ? null : activeFilter, title);
    setDraftTitle('');
  };

  const submitGroup = () => {
    const name = (newGroupName ?? '').trim();
    if (!selected || !name) return;
    onAddGroup(selected.id, name);
    setNewGroupName(null);
  };

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

  // 絞り込んでいるグループが「追加先」になる。どれも選んでいなければ未分類へ入る。
  const addTargetName = activeFilter === 'all' ? null : listGroups.find((g) => g.id === activeFilter)?.name ?? null;

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      {/* 上段（固定）: リストの切り替え・打ち込む欄・グループの絞り込み。
          スクロールするのは項目の一覧だけにする。 */}
      <div className="shrink-0 space-y-2 pb-3 mb-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {/* リストは1つずつ枠を持たせて切れ目を出す。下のグループのチップとは濃さで段を分ける
              （上＝選んでいるものを塗りつぶし、下＝枠だけ）。 */}
          <div role="tablist" aria-label="リストの切り替え" className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto">
            {lists.map((list) => {
              const current = list.id === selected?.id;
              return (
                <button
                  key={list.id}
                  type="button"
                  role="tab"
                  aria-selected={current}
                  onClick={() => selectList(list.id)}
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

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitItem();
            }}
            placeholder={addTargetName ? `${addTargetName}に追加` : '追加する項目'}
            className="flex-1 min-w-0 border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={submitItem}
            disabled={!draftTitle.trim()}
            className="flex-none bg-blue-500 text-white rounded-xl px-4 py-2.5 text-sm font-bold active:bg-blue-600 transition disabled:bg-gray-300"
          >
            追加
          </button>
        </div>

        {/* グループのチップ。絞り込みと追加先を兼ねる（お店にいる間はそこだけを見る）。 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setGroupFilter('all')}
            className={`flex-none text-xs font-bold px-3 py-1.5 rounded-full border transition ${
              activeFilter === 'all'
                ? 'bg-blue-50 border-blue-300 text-blue-600'
                : 'bg-white border-gray-200 text-gray-500'
            }`}
          >
            すべて
          </button>
          {listGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setGroupFilter(group.id)}
              className={`flex-none text-xs font-bold px-3 py-1.5 rounded-full border transition ${
                activeFilter === group.id
                  ? 'bg-blue-50 border-blue-300 text-blue-600'
                  : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              {group.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNewGroupName('')}
            aria-label={`${selected?.groupLabel ?? 'グループ'}を追加`}
            className="flex-none text-gray-400 border border-dashed border-gray-300 rounded-full px-3 py-1.5 hover:bg-gray-50 transition"
          >
            <Plus size={14} />
          </button>
        </div>

        {newGroupName !== null && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitGroup();
                if (e.key === 'Escape') setNewGroupName(null);
              }}
              autoFocus
              placeholder={`${selected?.groupLabel ?? 'グループ'}の名前（例: イオン）`}
              className="flex-1 min-w-0 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <button
              onClick={submitGroup}
              disabled={!newGroupName.trim()}
              className="flex-none text-sm font-bold text-blue-600 px-2 py-2 disabled:text-gray-300"
            >
              追加
            </button>
            <button
              onClick={() => setNewGroupName(null)}
              aria-label="やめる"
              className="flex-none text-gray-400 p-2"
            >
              <X size={18} />
            </button>
          </div>
        )}
      </div>

      {/* 下段（スクロール）: 項目の一覧 */}
      <div className="flex-1 overflow-y-auto">
        {/* グループごとの見出しが出る面では、見出しの下の「なし」で足りるため重ねて出さない。 */}
        {visibleItems.length === 0 && (activeFilter !== 'all' || listGroups.length === 0) && (
          <p className="text-sm text-gray-400 text-center py-8">項目はまだありません</p>
        )}

        {activeFilter === 'all' && listGroups.length > 0 ? (
          <div className="space-y-3">
            {listGroups.map((group) => {
              const groupItems = undoneItems.filter((item) => item.groupId === group.id);
              return (
                <section key={group.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between pl-3 pr-1.5 py-2 bg-gray-50 border-b border-gray-200">
                    <h3 className="text-xs font-bold text-gray-700">
                      {group.name}
                      {groupItems.length > 0 && <span className="ml-1.5 text-gray-400">{groupItems.length}</span>}
                    </h3>
                    <button
                      onClick={() => deleteGroupWithConfirm(group)}
                      aria-label={`${group.name}を削除`}
                      className="text-gray-300 hover:text-red-400 p-1.5"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {groupItems.length === 0 ? (
                    <p className="text-[11px] text-gray-300 px-3 py-2.5">なし</p>
                  ) : (
                    groupItems.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        onToggle={() => onToggleItem(item.id)}
                        onOpen={() => setDetailItem(item)}
                      />
                    ))
                  )}
                </section>
              );
            })}

            {/* 未分類はグループが1つでもあるときだけ見出しを出す（分けていないリストでは不要）。 */}
            {undoneItems.some((item) => item.groupId === null) && (
              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <h3 className="text-xs font-bold text-gray-500 px-3 py-2 bg-gray-50 border-b border-gray-200">未分類</h3>
                {undoneItems
                  .filter((item) => item.groupId === null)
                  .map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onToggle={() => onToggleItem(item.id)}
                      onOpen={() => setDetailItem(item)}
                    />
                  ))}
              </section>
            )}
          </div>
        ) : (
          undoneItems.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {undoneItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onToggle={() => onToggleItem(item.id)}
                  onOpen={() => setDetailItem(item)}
                />
              ))}
            </div>
          )
        )}

        {doneItems.length > 0 && (
          <section className="mt-3 bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                    // 絞り込んでいてもリスト全体の完了分が対象になるため、リスト名を出して確かめる。
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
                />
              ))}
          </section>
        )}
      </div>

      <ListFormModal
        key={`${listModal?.mode}-${listModal?.list?.id ?? 'new'}`}
        mode={listModal?.mode ?? null}
        list={listModal?.list ?? null}
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
        groupLabel={selected?.groupLabel ?? 'グループ'}
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
