'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Pin,
  PinOff,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
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
 *
 * 並べ替えとピン止めもKeepに合わせる。よく開くリストは一覧の先頭へ固定でき、
 * 並び順は「並べ替え」に入ってから上下ボタンで動かす（ドラッグは指の当たり判定が
 * チェックと取り合いになるため使わない。docs/lists.md §9）。
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
  onToggleListPin: (list: ListBoard) => void;
  /** 並べ替えの保存。渡した順に position を振り直す。 */
  onReorderLists: (orderedIds: string[]) => void;
  onReorderGroups: (orderedIds: string[]) => void;
  onReorderItems: (orderedIds: string[]) => void;
}

/**
 * 並べ替えの上下ボタン。端まで来たら押せなくして、いま端にいることを見せる。
 */
function MoveButtons({
  label,
  onMove,
  canUp,
  canDown,
}: {
  label: string;
  onMove: (delta: number) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  return (
    <div className="flex-none flex items-center">
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={!canUp}
        aria-label={`${label}を上へ`}
        className="text-gray-400 disabled:text-gray-200 p-1.5"
      >
        <ArrowUp size={16} />
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={!canDown}
        aria-label={`${label}を下へ`}
        className="text-gray-400 disabled:text-gray-200 p-1.5"
      >
        <ArrowDown size={16} />
      </button>
    </div>
  );
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
  reordering = false,
  onMove,
  canUp = false,
  canDown = false,
}: {
  item: ListItem;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
  /** 並べ替え中はチェックも削除も出さない（動かすだけの面にする）。 */
  reordering?: boolean;
  onMove?: (delta: number) => void;
  canUp?: boolean;
  canDown?: boolean;
}) {
  if (reordering && onMove) {
    return (
      <div className="flex items-center gap-2 pl-3 pr-1 py-2.5 border-b border-gray-100 last:border-b-0">
        <span className="flex-1 min-w-0 text-sm text-gray-800 break-words">{item.title}</span>
        <MoveButtons label={item.title} onMove={onMove} canUp={canUp} canDown={canDown} />
      </div>
    );
  }

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
  divided = false,
}: {
  label: string;
  placeholder: string;
  onSubmit: (value: string) => void;
  /** 枠そのものを足す行は、項目の追加と見分けられるよう破線にする。 */
  tone?: 'plain' | 'outlined';
  /** 上に項目が並んでいるときは、線を引いて区切る。 */
  divided?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const divider = divided ? 'border-t border-gray-200' : '';

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft('')}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-50 transition ${
          tone === 'outlined' ? 'border border-dashed border-gray-300 rounded-xl justify-center' : divider
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
        tone === 'outlined' ? 'border border-dashed border-gray-300 rounded-xl' : divider
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
  onTogglePin,
  reordering,
  onMove,
  canUp,
  canDown,
}: {
  list: ListBoard;
  groups: ListGroup[];
  items: ListItem[];
  onOpen: () => void;
  onTogglePin: () => void;
  /** 並べ替え中はカードを開けず、上下ボタンだけを出す。 */
  reordering: boolean;
  onMove: (delta: number) => void;
  canUp: boolean;
  canDown: boolean;
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
    /* ピンと上下ボタンは「開く」の中に入れられない（ボタンの入れ子になる）ため、
       カードを枠にして、開く部分と並べて置く。 */
    <div className="relative bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        disabled={reordering}
        className="w-full text-left block hover:border-gray-300 transition"
      >
      {/* 見出し（リスト名）は帯にして、中身と一目で分かれるようにする。 */}
      <h3
        className={`px-3 py-2 bg-gray-50 border-b border-gray-200 text-[13px] font-bold text-gray-900 break-words ${
          reordering ? 'pr-16' : 'pr-9'
        }`}
      >
        {list.name}
      </h3>
      <div className="px-3 py-2">
        {shown.map((row, index) =>
          row.type === 'group' ? (
            /* グループ名は下線で区切る。どこからどこまでが同じ枠かが線で分かる。 */
            <div
              key={row.key}
              className={`border-b border-gray-200 pb-1 mb-1.5 ${index === 0 ? '' : 'mt-2.5'}`}
            >
              <span className="block truncate text-[11px] font-bold text-gray-600">{row.name}</span>
            </div>
          ) : (
            /* 項目どうしは線で区切らない（線が多いと詰まって見える）。 */
            <div key={row.key} className="flex items-start gap-1.5 py-[3px]">
              <span className="flex-none mt-[3px] w-3.5 h-3.5 rounded border border-gray-300" />
              <span className="flex-1 min-w-0 text-xs text-gray-700 break-words line-clamp-2">{row.item.title}</span>
            </div>
          ),
        )}
        {rows.length === 0 && <p className="text-xs text-gray-300 py-1">項目なし</p>}
        {rest > 0 && <p className="text-[11px] text-gray-400 pt-1.5">+{rest}件</p>}
      </div>
      </button>
      {reordering ? (
        <div className="absolute top-0.5 right-0.5">
          <MoveButtons label={list.name} onMove={onMove} canUp={canUp} canDown={canDown} />
        </div>
      ) : (
        /* よく開くリストを上に固定する（Keepのピン止め）。 */
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={`${list.name}の固定を${list.pinned ? '外す' : 'する'}`}
          aria-pressed={list.pinned}
          className={`absolute top-1 right-1 p-1.5 rounded-full transition ${
            list.pinned ? 'text-blue-600' : 'text-gray-300 hover:text-gray-500'
          }`}
        >
          {list.pinned ? <Pin size={15} fill="currentColor" /> : <PinOff size={15} />}
        </button>
      )}
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
  onToggleListPin,
  onReorderLists,
  onReorderGroups,
  onReorderItems,
}: ListTabProps) {
  // nullのあいだはリストを並べた一覧を出す。カードを押すとそのリストを開く。
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  // 並べ替えは一覧（リスト）と開いた先（グループ・項目）で別々に入る。
  const [reorderingLists, setReorderingLists] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [listModal, setListModal] = useState<{ mode: 'add' | 'edit'; list: ListBoard | null } | null>(null);
  const [detailItem, setDetailItem] = useState<ListItem | null>(null);

  // 固定したリストが先。中は並び順（position）で、同じなら読み込んだ順のまま。
  const sortedLists = useMemo(
    () => [...lists].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position),
    [lists],
  );
  const pinnedLists = useMemo(() => sortedLists.filter((list) => list.pinned), [sortedLists]);
  const otherLists = useMemo(() => sortedLists.filter((list) => !list.pinned), [sortedLists]);

  // 開いていたリストが消えたときは一覧へ戻す。
  const selected = lists.find((list) => list.id === openListId) ?? null;
  const listGroups = useMemo(
    () =>
      selected
        ? groups.filter((group) => group.listId === selected.id).sort((a, b) => a.position - b.position)
        : [],
    [groups, selected],
  );
  const listItems = useMemo(
    () =>
      selected
        ? items.filter((item) => item.listId === selected.id).sort((a, b) => a.position - b.position)
        : [],
    [items, selected],
  );

  const undoneItems = listItems.filter((item) => !item.done);
  const doneItems = listItems.filter((item) => item.done);
  const ungroupedItems = undoneItems.filter((item) => item.groupId === null);

  /**
   * 並べ替えの計算。同じ枠（固定の中・グループの中）だけで入れ替え、
   * 画面に出ている順のまま id を返す。保存側はその順に position を振り直す。
   */
  const moved = <T extends { id: string }>(section: T[], id: string, delta: number): T[] | null => {
    const index = section.findIndex((entry) => entry.id === id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= section.length) return null;
    const result = [...section];
    [result[index], result[next]] = [result[next], result[index]];
    return result;
  };

  const moveList = (list: ListBoard, delta: number) => {
    const section = list.pinned ? pinnedLists : otherLists;
    const result = moved(section, list.id, delta);
    if (!result) return;
    // 固定とその他をつないだ「画面の並び」で振り直す。
    const ordered = list.pinned ? [...result, ...otherLists] : [...pinnedLists, ...result];
    onReorderLists(ordered.map((entry) => entry.id));
  };

  const moveGroup = (group: ListGroup, delta: number) => {
    const result = moved(listGroups, group.id, delta);
    if (result) onReorderGroups(result.map((entry) => entry.id));
  };

  const moveItem = (item: ListItem, delta: number) => {
    // 動かせるのは同じグループの中だけ。グループを変えるのは項目の詳細から。
    const section = listItems.filter((entry) => !entry.done && entry.groupId === item.groupId);
    const result = moved(section, item.id, delta);
    if (result) onReorderItems(result.map((entry) => entry.id));
  };

  const closeList = () => {
    setOpenListId(null);
    setReordering(false);
  };

  const overviewCards = (section: ListBoard[]) =>
    section.map((list, index) => (
      <ListOverviewCard
        key={list.id}
        list={list}
        groups={groups.filter((group) => group.listId === list.id)}
        items={items.filter((item) => item.listId === list.id)}
        onOpen={() => setOpenListId(list.id)}
        onTogglePin={() => onToggleListPin(list)}
        reordering={reorderingLists}
        onMove={(delta) => moveList(list, delta)}
        canUp={index > 0}
        canDown={index < section.length - 1}
      />
    ));

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
        /* 一覧: Keepと同じく全部のリストをカードで並べる。2列にして1画面に4〜5つ入れる。
           固定したものは上にまとめ、並べ替えは切り替えてから上下ボタンで動かす。 */
        <>
          {sortedLists.length > 1 && (
            <div className="shrink-0 flex justify-end pb-2">
              <button
                type="button"
                onClick={() => setReorderingLists((prev) => !prev)}
                className={`text-xs font-bold px-2 py-1 rounded-lg transition ${
                  reorderingLists ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {reorderingLists ? '並べ替えを終える' : '並べ替え'}
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {pinnedLists.length > 0 && (
              <>
                <h3 className="flex items-center gap-1 text-[11px] font-bold text-gray-400 pb-1.5">
                  <Pin size={11} fill="currentColor" />
                  固定
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 items-start gap-3 content-start">
                  {overviewCards(pinnedLists)}
                </div>
                {otherLists.length > 0 && (
                  <h3 className="text-[11px] font-bold text-gray-400 pt-4 pb-1.5">その他</h3>
                )}
              </>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 items-start gap-3 content-start">
              {overviewCards(otherLists)}
              {/* 並べ替え中は動かすことだけに絞る（追加は終えてから）。 */}
              {!reorderingLists && (
                <button
                  type="button"
                  onClick={() => setListModal({ mode: 'add', list: null })}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-5 text-sm text-gray-400 border border-dashed border-gray-300 rounded-xl hover:bg-gray-50 transition"
                >
                  <Plus size={16} className="flex-none" />
                  リストを追加
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
      <>
      {/* 上段（固定）: 開いているリストの名前と戻る。一覧のときは何も置かず高さを使わない。 */}
      <div className="shrink-0 flex items-center gap-1 pb-3 mb-3 border-b border-gray-200">
        <button
          type="button"
          onClick={closeList}
          aria-label="リストの一覧へ戻る"
          className="flex-none text-gray-500 p-2 -ml-2 rounded-full hover:bg-gray-100 transition"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="flex-1 min-w-0 px-1 text-base font-bold text-gray-800 truncate">{selected?.name}</h2>
        {/* 並べ替え中はチェックも追加も出さず、動かすことだけに絞る。
            動かす相手が1つも無いうちはボタンを出さない。 */}
        {(undoneItems.length > 1 || listGroups.length > 1) && (
        <button
          type="button"
          onClick={() => setReordering((prev) => !prev)}
          aria-label={reordering ? '並べ替えを終える' : '項目を並べ替える'}
          aria-pressed={reordering}
          className={`flex-none p-2 rounded-full transition ${
            reordering ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-100'
          }`}
        >
          <ArrowUpDown size={20} />
        </button>
        )}
        {selected && !reordering && (
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
            {undoneItems.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => onToggleItem(item.id)}
                onOpen={() => setDetailItem(item)}
                onDelete={() => onDeleteItem(item.id)}
                reordering={reordering}
                onMove={(delta) => moveItem(item, delta)}
                canUp={index > 0}
                canDown={index < undoneItems.length - 1}
              />
            ))}
            {!reordering && (
              <AddRow
                divided={undoneItems.length > 0}
                label="追加"
                placeholder="追加する項目"
                onSubmit={(title) => selected && onAddItem(selected.id, null, title)}
              />
            )}
          </div>
        ) : (
          <>
            {listGroups.map((group, groupIndex) => {
              const groupItems = undoneItems.filter((item) => item.groupId === group.id);
              return (
                <section key={group.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between pl-3 pr-1.5 py-2 bg-gray-100 border-b border-gray-200">
                    <h3 className="text-[13px] font-bold text-gray-900">
                      {group.name}
                      {groupItems.length > 0 && <span className="ml-1.5 text-gray-400">{groupItems.length}</span>}
                    </h3>
                    {reordering ? (
                      /* 枠そのものの順番も、ここで動かせるようにする。 */
                      <MoveButtons
                        label={group.name}
                        onMove={(delta) => moveGroup(group, delta)}
                        canUp={groupIndex > 0}
                        canDown={groupIndex < listGroups.length - 1}
                      />
                    ) : (
                      <button
                        onClick={() => deleteGroupWithConfirm(group)}
                        aria-label={`${group.name}を削除`}
                        className="text-gray-400 hover:text-red-500 p-1.5"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  {groupItems.map((item, index) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onToggle={() => onToggleItem(item.id)}
                      onOpen={() => setDetailItem(item)}
                      onDelete={() => onDeleteItem(item.id)}
                      reordering={reordering}
                      onMove={(delta) => moveItem(item, delta)}
                      canUp={index > 0}
                      canDown={index < groupItems.length - 1}
                    />
                  ))}
                  {!reordering && (
                    <AddRow
                      divided={groupItems.length > 0}
                      label="追加"
                      placeholder={`${group.name}に追加`}
                      onSubmit={(title) => selected && onAddItem(selected.id, group.id, title)}
                    />
                  )}
                </section>
              );
            })}

            {/* どの枠にも入れていない項目があるときだけ出す。 */}
            {ungroupedItems.length > 0 && (
              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <h3 className="text-[13px] font-bold text-gray-500 px-3 py-2 bg-gray-100 border-b border-gray-200">未分類</h3>
                {ungroupedItems.map((item, index) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onToggle={() => onToggleItem(item.id)}
                    onOpen={() => setDetailItem(item)}
                    onDelete={() => onDeleteItem(item.id)}
                    reordering={reordering}
                    onMove={(delta) => moveItem(item, delta)}
                    canUp={index > 0}
                    canDown={index < ungroupedItems.length - 1}
                  />
                ))}
                {!reordering && (
                  <AddRow
                    divided
                    label="追加"
                    placeholder="追加する項目"
                    onSubmit={(title) => selected && onAddItem(selected.id, null, title)}
                  />
                )}
              </section>
            )}
          </>
        )}

        {/* 枠そのものを足す。お店が増えたらここから作る。 */}
        {selected && !reordering && (
          <AddRow
            tone="outlined"
            label="グループを追加"
            placeholder="グループの名前（例: イオン）"
            onSubmit={(name) => onAddGroup(selected.id, name)}
          />
        )}

        {doneItems.length > 0 && !reordering && (
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
          closeList();
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
