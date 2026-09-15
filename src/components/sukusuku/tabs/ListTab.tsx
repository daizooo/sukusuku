'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Plus, Settings2, Trash2, X } from 'lucide-react';
import type { ListBoard, ListGroup, ListItem } from '@/types/app';
import ListFormModal, { type ListDraft } from '../modals/ListFormModal';
import ListItemDetailModal, { type ListItemDraft } from '../modals/ListItemDetailModal';

/**
 * 買い出し・やりたいこと・やることなどのリスト（docs/lists.md）。
 *
 * Google Keepと同じく、**枠（カード）が操作の単位**になる。グループ（お店など）ごとに
 * 枠があり、枠は一覧の中で足せる・消せる。項目もその枠の中で足せる・消せる。
 * どのグループに足すかは「その枠で打つ」ことで決まるので、追加先を選ぶ手順はない。
 *
 * 開いたときはKeepと同じく**全部のリストがカードで並ぶ**（1画面に4〜5つ見える）。
 * カードを押すとそのリストだけの画面になり、そこで項目やグループを足す。
 *
 * スクロールするのはカード/枠の一覧だけで、見出しや戻るは上に固定する。
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

/** 一覧のカードに出す行数。多すぎるとカードが伸びて1画面に収まらない。 */
const OVERVIEW_ROWS = 6;

type OverviewRow =
  | { type: 'group'; key: string; name: string }
  | { type: 'item'; key: string; item: ListItem };

/**
 * 一覧（Keepのメモ一覧に当たる面）に出す1リストのカード。
 * 中身は読むだけにして、チェックや追加は開いた先で行う（押し間違いを避ける）。
 */
function ListOverviewCard({
  list,
  groups,
  items,
  onOpen,
}: {
  list: ListBoard;
  groups: ListGroup[];
  items: ListItem[];
  onOpen: () => void;
}) {
  const undone = items.filter((item) => !item.done);
  const rows: OverviewRow[] = [];
  const pushItems = (target: ListItem[]) => {
    target.forEach((item) => rows.push({ type: 'item', key: item.id, item }));
  };

  if (groups.length === 0) {
    pushItems(undone);
  } else {
    groups.forEach((group) => {
      // 中身が無いグループも、どの枠を作ったか分かるよう名前だけ出す。
      rows.push({ type: 'group', key: group.id, name: group.name });
      pushItems(undone.filter((item) => item.groupId === group.id));
    });
    const ungrouped = undone.filter((item) => item.groupId === null);
    if (ungrouped.length > 0) {
      rows.push({ type: 'group', key: `${list.id}-none`, name: '未分類' });
      pushItems(ungrouped);
    }
  }

  const shown = rows.slice(0, OVERVIEW_ROWS);
  const rest = rows.length - shown.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 hover:border-gray-300 transition"
    >
      <h3 className="text-sm font-bold text-gray-800 break-words">{list.name}</h3>
      <div className="mt-2 space-y-1">
        {shown.map((row) =>
          row.type === 'group' ? (
            <p key={row.key} className="text-[11px] font-bold text-gray-500 break-words pt-0.5">
              {row.name}
            </p>
          ) : (
            <div key={row.key} className="flex items-start gap-1.5">
              <span className="flex-none mt-[3px] w-3.5 h-3.5 rounded border border-gray-300" />
              <span className="flex-1 min-w-0 text-xs text-gray-700 break-words line-clamp-2">{row.item.title}</span>
            </div>
          ),
        )}
        {rows.length === 0 && <p className="text-xs text-gray-300">項目なし</p>}
        {rest > 0 && <p className="text-[11px] text-gray-400 pt-0.5">+{rest}件</p>}
      </div>
    </button>
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
  // nullのあいだはリストを並べた一覧を出す。カードを押すとそのリストを開く。
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [listModal, setListModal] = useState<{ mode: 'add' | 'edit'; list: ListBoard | null } | null>(null);
  const [detailItem, setDetailItem] = useState<ListItem | null>(null);

  // 開いていたリストが消えたときは一覧へ戻す。
  const selected = lists.find((list) => list.id === openListId) ?? null;
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
      {!selected ? (
        /* 一覧（スクロール）: Keepと同じく全部のリストをカードで並べる。2列にして1画面に4〜5つ入れる。 */
        <div className="flex-1 overflow-y-auto grid grid-cols-2 md:grid-cols-3 items-start gap-3 content-start">
          {lists.map((list) => (
            <ListOverviewCard
              key={list.id}
              list={list}
              groups={groups.filter((group) => group.listId === list.id)}
              items={items.filter((item) => item.listId === list.id)}
              onOpen={() => setOpenListId(list.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => setListModal({ mode: 'add', list: null })}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-5 text-sm text-gray-400 border border-dashed border-gray-300 rounded-xl hover:bg-gray-50 transition"
          >
            <Plus size={16} className="flex-none" />
            リストを追加
          </button>
        </div>
      ) : (
      <>
      {/* 上段（固定）: 開いているリストの名前と戻る。一覧のときは何も置かず高さを使わない。 */}
      <div className="shrink-0 flex items-center gap-1 pb-3 mb-3 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setOpenListId(null)}
          aria-label="リストの一覧へ戻る"
          className="flex-none text-gray-500 p-2 -ml-2 rounded-full hover:bg-gray-100 transition"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="flex-1 min-w-0 px-1 text-base font-bold text-gray-800 truncate">{selected?.name}</h2>
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
                  <div className="flex items-center justify-between pl-3 pr-1.5 py-2 bg-gray-50 border-b border-gray-200">
                    <h3 className="text-xs font-bold text-gray-700">
                      {group.name}
                      {groupItems.length > 0 && <span className="ml-1.5 text-gray-400">{groupItems.length}</span>}
                    </h3>
                    <button
                      onClick={() => deleteGroupWithConfirm(group)}
                      aria-label={`${group.name}を削除`}
                      className="text-gray-400 hover:text-red-500 p-1.5"
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
                <h3 className="text-xs font-bold text-gray-500 px-3 py-2 bg-gray-50 border-b border-gray-200">未分類</h3>
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
            label="グループを追加"
            placeholder="グループの名前（例: イオン）"
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
      </>
      )}

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
          setOpenListId(null);
          setListModal(null);
        }}
      />
      <ListItemDetailModal
        key={detailItem?.id ?? 'none'}
        item={detailItem}
        groups={listGroups}
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
