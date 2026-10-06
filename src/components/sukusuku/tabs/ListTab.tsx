'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Check, ChevronDown, ChevronRight, GripVertical, Lock, Pin, PinOff, Plus, Trash2, X } from 'lucide-react';
import type { HouseholdProduct, ListBoard, ListGroup, ListItem } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { loadVisibleHouseholdProducts } from '@/lib/api/householdProducts';
import { suggestProducts } from '@/lib/shoppingUtils';
import { useDragReorder } from '../ui/useDragReorder';
import ListEditorModal, { DEFAULT_GROUP_LABEL, type ListDraft } from '../modals/ListEditorModal';

/**
 * 買い出し・やりたいこと・やることなどのリスト（docs/lists.md）。
 *
 * Google Keepと同じく、**枠（カード）が操作の単位**になる。グループ（お店など）ごとに
 * 枠があり、枠は一覧の中で足せる・消せる。項目もその枠の中で足せる・消せる。
 * どのグループに足すかは「その枠で打つ」ことで決まるので、追加先を選ぶ手順はない。
 *
 * 開いたときはKeepと同じく**全部のリストがカードで並ぶ**（1画面に4〜5つ見える）。
 * カードを押すとそのリストが**画面の中央に拡大して開き（編集モード）**、見出し・項目・
 * グループ・固定・共有・削除をそこで済ませる。設定の画面は無い（手間を減らすため）。
 *
 * スクロールするのは一覧と、編集モードの中身だけ。見出しと下の道具列は固定する。
 *
 * 追加・書き換え・削除はすべて**その枠の中で終える**（Keepと同じ）。項目を押せば
 * その行が入力欄になり、直せるのは**内容だけ**（メモも入れ先の選び直しも持たない）。
 * グループの名前も同じく見出しを押してその場で直す。
 *
 * 並べ替えとピン止めもKeepに合わせる。よく開くリストは一覧の先頭へ固定でき、
 * 並び順は、一覧のカードは**長押しして**、リストの中の項目・グループは**左端の持ち手を押して**
 * そのまま動かす（モードにも矢印にも入らない）。
 * 仕組みは ui/useDragReorder.ts。動かせるのは同じ枠の中だけ。
 */
interface ListTabProps {
  lists: ListBoard[];
  groups: ListGroup[];
  items: ListItem[];
  isLoading?: boolean;
  /** 作ったリストを返す（作ってすぐ編集モードで開くため）。失敗したら null。 */
  onAddList: (draft: ListDraft) => Promise<ListBoard | null>;
  onUpdateList: (list: ListBoard, draft: ListDraft) => void;
  onDeleteList: (id: string) => void;
  onAddGroup: (listId: string, name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onAddItem: (listId: string, groupId: string | null, title: string) => void;
  onToggleItem: (id: string) => void;
  /** 項目の内容を書き換える。持てるのは内容だけなので、渡すのも内容だけ。 */
  onRenameItem: (item: ListItem, title: string) => void;
  onDeleteItem: (id: string) => void;
  onClearDone: (listId: string) => void;
  onAddDefaultLists: () => void;
  onToggleListPin: (list: ListBoard) => void;
  /** 並べ替えの保存。渡した順に position を振り直す。 */
  onReorderLists: (orderedIds: string[]) => void;
  onReorderGroups: (orderedIds: string[]) => void;
  onReorderItems: (orderedIds: string[]) => void;
}

/** チェックの丸。押した先が分かるよう、未完了でも枠は出しておく。 */
function ItemCheck({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      // 書き換え中に押しても入力欄から焦点が外れない（続けて書ける）ようにする。
      onMouseDown={(e) => e.preventDefault()}
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

/**
 * 項目の行。押すとその場で入力欄になり、枠の中で書き換える
 * （Keepと同じで、項目のためだけの画面は出さない）。持っているのは内容だけ。
 */
function ItemRow({
  item,
  onToggle,
  onRename,
  onDelete,
  attachRef,
  onGrab,
  dragging,
}: {
  item: ListItem;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  /** 動かすための持ち手。完了した項目には渡さない（並びを持たない）。 */
  attachRef?: (el: HTMLElement | null) => void;
  onGrab?: (event: ReactPointerEvent<HTMLElement>) => void;
  dragging?: boolean;
}) {
  // null のあいだは読むだけの行。押すと書きかけを持って入力欄になる。
  const [draft, setDraft] = useState<string | null>(null);

  const close = (value: string) => {
    const title = value.trim();
    // 空のまま離れたのが消したいのか打ち間違いかは分からないので、元に戻す（消すのは×）。
    if (title && title !== item.title) onRename(title);
    setDraft(null);
  };

  return (
    <div
      ref={draft === null ? attachRef : undefined}
      className={`flex items-center gap-2 ${onGrab ? 'pl-1' : 'pl-3'} pr-1 py-2.5 border-b border-gray-100 last:border-b-0 ${
        dragging ? 'relative z-20 bg-white rounded-lg shadow-lg' : ''
      }`}
    >
      {onGrab && <Grip onGrab={onGrab} label={`${item.title}を並べ替え`} />}
      <ItemCheck done={item.done} onToggle={onToggle} label={`${item.title}を${item.done ? '戻す' : '完了にする'}`} />
      {draft === null ? (
        <button type="button" onClick={() => setDraft(item.title)} className="flex-1 min-w-0 text-left">
          <span className={`block min-h-5 text-sm break-words ${item.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
            {item.title}
          </span>
        </button>
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close(draft);
            if (e.key === 'Escape') setDraft(null);
          }}
          onBlur={() => close(draft)}
          autoFocus
          aria-label="項目の内容"
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
        />
      )}
      {/* その場で消せるようにする。打ち間違いをすぐ取り消せるほうが、
          いちいち書き換えに入るより手数が少ない。 */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
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
 * 枠（グループ）の見出し。名前を押すとその場で直せる（設定の画面を出さない）。
 * 枠ごと動かすときは、左端の持ち手を押したまま動かす。
 */
function GroupHeader({
  group,
  count,
  onRename,
  onDelete,
  handleProps,
}: {
  group: ListGroup;
  count: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  handleProps?: { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void };
}) {
  // null のあいだは読むだけの見出し。押すと書きかけを持って入力欄になる。
  const [draft, setDraft] = useState<string | null>(null);

  const close = (value: string) => {
    const name = value.trim();
    if (name && name !== group.name) onRename(name);
    setDraft(null);
  };

  return (
    <div className={`flex items-center justify-between ${handleProps ? 'pl-1' : 'pl-3'} pr-1.5 py-2 bg-gray-100 border-b border-gray-200 select-none`}>
      {handleProps && <Grip onGrab={handleProps.onPointerDown} label={`${group.name}を並べ替え`} />}
      {draft === null ? (
        <button
          type="button"
          onClick={() => setDraft(group.name)}
          className="flex-1 min-w-0 text-left text-[13px] font-bold text-gray-900 py-0.5"
        >
          {group.name}
          {count > 0 && <span className="ml-1.5 text-gray-400">{count}</span>}
        </button>
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close(draft);
            if (e.key === 'Escape') setDraft(null);
          }}
          onBlur={() => close(draft)}
          autoFocus
          aria-label="グループの名前"
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1 text-[13px] font-bold outline-none focus:border-blue-500"
        />
      )}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDelete}
        aria-label={`${group.name}を削除`}
        className="flex-none text-gray-400 hover:text-red-500 p-1.5"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

/** 並べ替えの持ち手（Keepと同じ左端の点々）。触れた瞬間に持ち上がるので、指で狙いやすいよう広めに取る。 */
function Grip({ onGrab, label }: { onGrab: (event: ReactPointerEvent<HTMLElement>) => void; label: string }) {
  return (
    <span
      role="button"
      aria-label={label}
      onPointerDown={onGrab}
      className="flex-none flex items-center justify-center w-7 self-stretch -my-2 text-gray-300 cursor-grab touch-none select-none"
    >
      <GripVertical size={16} />
    </span>
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
  allowEmpty = false,
  suggest,
}: {
  label: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  /** 打っている文字から候補を出す（日用品の台帳。docs/home.md §4.2）。押すとその内容で追加する。 */
  suggest?: (typed: string) => string[];
  /** 空のままでも追加できるようにする（項目の追加用。空行を挟んで見出しのように使える）。 */
  allowEmpty?: boolean;
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
    if (!value && !allowEmpty) return;
    onSubmit(value);
    setDraft('');
  };

  const suggestions = suggest ? suggest(draft) : [];

  return (
    <div className={tone === 'outlined' ? 'border border-dashed border-gray-300 rounded-xl' : divider}>
      <div className="flex items-center gap-2 pl-3 pr-1 py-1.5">
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
          disabled={!allowEmpty && !draft.trim()}
          className="flex-none text-sm font-bold text-blue-600 px-2 py-2 disabled:text-gray-300"
        >
          追加
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              // 押した瞬間に入力欄から外れて欄が畳まれないように。
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSubmit(suggestion);
                setDraft('');
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-xs font-bold text-blue-600 hover:bg-blue-100"
            >
              <Plus size={12} />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 長押しで動かせる枠（セクション）。動かせるのは同じ枠の中だけ。 */
const LISTS_PINNED = 'lists:pinned';
const LISTS_OTHER = 'lists:other';
const GROUPS = 'groups';
const itemsSection = (groupId: string | null) => `items:${groupId ?? 'none'}`;

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
  attachRef,
  onGrab,
  dragging,
}: {
  list: ListBoard;
  groups: ListGroup[];
  items: ListItem[];
  onOpen: () => void;
  onTogglePin: () => void;
  /** 長押しで動かすための持ち手。カード全体をつかめるようにする。 */
  attachRef: (el: HTMLElement | null) => void;
  onGrab: (event: ReactPointerEvent<HTMLElement>) => void;
  dragging: boolean;
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

  return (
    /* ピンは「開く」の中に入れられない（ボタンの入れ子になる）ため、
       カードを枠にして、開く部分と並べて置く。長押しはこの枠でつかむ。 */
    <div
      ref={attachRef}
      onPointerDown={onGrab}
      className={`relative bg-white rounded-xl border border-gray-200 overflow-hidden select-none ${
        dragging ? 'z-20 shadow-xl border-blue-300' : ''
      }`}
    >
      <button type="button" onClick={onOpen} className="w-full text-left block hover:border-gray-300 transition">
      {/* 見出し（リスト名）は帯にして、中身と一目で分かれるようにする。 */}
      <h3 className="flex items-center gap-1 px-3 py-2 pr-9 bg-gray-50 border-b border-gray-200 text-[13px] font-bold text-gray-900">
        <span className="min-w-0 break-words">{list.name}</span>
        {/* 自分だけのリストは錠前を添える。 */}
        {list.isPrivate && <Lock size={11} className="flex-none text-gray-400" aria-label="自分だけ" />}
      </h3>
      <div className="px-3 py-2">
        {rows.map((row, index) =>
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
      </div>
      </button>
      {/* よく開くリストを上に固定する（Keepのピン止め）。 */}
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
  onRenameItem,
  onDeleteItem,
  onClearDone,
  onAddDefaultLists,
  onToggleListPin,
  onReorderLists,
  onReorderGroups,
  onReorderItems,
}: ListTabProps) {
  // nullのあいだはリストを並べた一覧だけを出す。カードを押すとそのリストを編集モードで開く。
  const [openListId, setOpenListId] = useState<string | null>(null);
  // 今の編集が「新しく作ったリスト」か。見出しへ入力を移し、何も書かずに閉じたら消す。
  const [isNewList, setIsNewList] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // 項目の追加欄の候補に出す日用品の台帳（docs/home.md §4.2）。読めなくてもリストは出す。
  const [products, setProducts] = useState<HouseholdProduct[]>([]);
  useEffect(() => {
    let isMounted = true;
    loadVisibleHouseholdProducts(createClient())
      .then((loaded) => {
        if (isMounted) setProducts(loaded);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);
  const suggestFromProducts = (typed: string) => suggestProducts(products, typed).map((product) => product.name);

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
   * 長押しで動かしたあとの保存。枠（セクション）ごとに宛先を分ける。
   * リストは固定とその他をつないだ「画面の並び」で振り直す。
   */
  const drag = useDragReorder((sectionKey, orderedIds) => {
    if (sectionKey === LISTS_PINNED) onReorderLists([...orderedIds, ...otherLists.map((list) => list.id)]);
    else if (sectionKey === LISTS_OTHER) onReorderLists([...pinnedLists.map((list) => list.id), ...orderedIds]);
    else if (sectionKey === GROUPS) onReorderGroups(orderedIds);
    else onReorderItems(orderedIds);
  });

  const overviewCards = (sectionKey: string, section: ListBoard[]) => {
    const arranged = drag.arrange(sectionKey, section);
    return arranged.map((list) => (
      <ListOverviewCard
        key={list.id}
        list={list}
        /* 並べ替えたあとも一覧の中身が同じ順で出るよう、ここでも position で並べる。 */
        groups={groups.filter((group) => group.listId === list.id).sort((a, b) => a.position - b.position)}
        items={items.filter((item) => item.listId === list.id).sort((a, b) => a.position - b.position)}
        onOpen={() => setOpenListId(list.id)}
        onTogglePin={() => onToggleListPin(list)}
        attachRef={drag.dragRef(list.id)}
        onGrab={drag.handleProps(sectionKey, arranged, list.id).onPointerDown}
        dragging={drag.isDragging(list.id)}
      />
    ));
  };

  /** 項目の行。左端の持ち手で動かす。 */
  const itemRows = (sectionKey: string, rows: ListItem[]) => {
    const arranged = drag.arrange(sectionKey, rows);
    return arranged.map((item) => (
      <ItemRow
        key={item.id}
        item={item}
        onToggle={() => onToggleItem(item.id)}
        onRename={(title) => onRenameItem(item, title)}
        onDelete={() => onDeleteItem(item.id)}
        attachRef={drag.dragRef(item.id)}
        onGrab={drag.gripProps(sectionKey, arranged, item.id).onPointerDown}
        dragging={drag.isDragging(item.id)}
      />
    ));
  };

  /** 持ち上げた項目が枠からはみ出して切れないよう、そのあいだだけ枠を開ける。 */
  const lifting = (rows: ListItem[]) => rows.some((item) => drag.isDragging(item.id));

  const deleteGroupWithConfirm = (group: ListGroup) => {
    const count = listItems.filter((item) => item.groupId === group.id).length;
    const suffix = count > 0 ? `\n中の${count}件は「未分類」に残ります。` : '';
    if (!window.confirm(`「${group.name}」を削除しますか？${suffix}`)) return;
    onDeleteGroup(group.id);
  };

  /**
   * 新しいリストを作って、そのまま編集モードで開く（見出しから打ち始める）。
   * 名前は空で作り、何も書かずに閉じたときは closeEditor が消す。
   * 新しいリストの既定は「自分だけ」。家族に見せたいものだけ共有へ切り替える。
   */
  const createList = async () => {
    const created = await onAddList({ name: '', groupLabel: DEFAULT_GROUP_LABEL, isPrivate: true });
    if (!created) return;
    setIsNewList(true);
    setOpenListId(created.id);
  };

  /** 名前・共有設定など、リスト自身の項目を直す。 */
  const patchList = (list: ListBoard, patch: Partial<Pick<ListDraft, 'name' | 'isPrivate'>>) =>
    onUpdateList(list, { name: list.name, groupLabel: list.groupLabel, isPrivate: list.isPrivate, ...patch });

  /**
   * 編集モードを閉じる。見出しの書きかけがあれば保存してから閉じる。
   * 新しく作ったまま何も入れなかったリストは、空のカードが残らないよう消す。
   */
  const closeEditor = (list: ListBoard, draftName: string) => {
    const name = draftName.trim();
    const isEmpty =
      !groups.some((group) => group.listId === list.id) && !items.some((item) => item.listId === list.id);
    setOpenListId(null);
    setIsNewList(false);
    if (!name && list.name === '' && isEmpty) {
      onDeleteList(list.id);
      return;
    }
    // 見出しを空にしたまま項目だけ入れたときは、名前が無いカードにならないよう仮の名前を付ける。
    const next = name || list.name || '無題';
    if (next !== list.name) patchList(list, { name: next });
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
        <button onClick={() => void createList()} className="text-xs font-bold text-gray-500 px-4 py-2">
          自分でリストを作る
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      {/* 一覧: Keepと同じく全部のリストをカードで並べる。2列にして1画面に4〜5つ入れる。
          固定したものは上にまとめる（見出しは付けず、カードのピンの色で分かる）。
          並べ替えは長押ししてそのまま動かす。 */}
        <div className="flex-1 overflow-y-auto">
          {pinnedLists.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 items-start gap-3 content-start mb-3">
              {overviewCards(LISTS_PINNED, pinnedLists)}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 items-start gap-3 content-start">
            {overviewCards(LISTS_OTHER, otherLists)}
            <button
              type="button"
              onClick={() => void createList()}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-5 text-sm text-gray-400 border border-dashed border-gray-300 rounded-xl hover:bg-gray-50 transition"
            >
              <Plus size={16} className="flex-none" />
              リストを追加
            </button>
          </div>
          {/* 長押しで動かせることは見ただけでは分からないので、小さく添える。 */}
          {sortedLists.length > 1 && (
            <p className="text-[10px] text-gray-300 text-center pt-3">長押しで並べ替え</p>
          )}
        </div>

      {/* 編集モード: 開いたカードを画面の中央に拡大して出す（Keepと同じ）。
          見出し・項目・グループ・固定・共有・削除をここで済ませる。 */}
      {selected && (
        <ListEditorModal
          // 対象が変わるたびに作り直して、見出しの書きかけを持ち越さない。
          key={selected.id}
          list={selected}
          focusTitle={isNewList}
          onRename={(name) => patchList(selected, { name })}
          onTogglePin={() => onToggleListPin(selected)}
          onToggleShare={() => patchList(selected, { isPrivate: !selected.isPrivate })}
          onDelete={() => {
            if (!window.confirm('このリストを削除しますか？\n中の項目もすべて消えます。')) return;
            onDeleteList(selected.id);
            setOpenListId(null);
            setIsNewList(false);
          }}
          onClose={(draftName) => closeEditor(selected, draftName)}
        >
        {/* グループを作っていないリストは、枠1つのただのチェックリストになる。 */}
        {listGroups.length === 0 ? (
          <div
            className={`bg-white rounded-xl border border-gray-200 ${lifting(undoneItems) ? '' : 'overflow-hidden'}`}
          >
            {itemRows(itemsSection(null), undoneItems)}
            <AddRow
              divided={undoneItems.length > 0}
              label="追加"
              allowEmpty
              suggest={suggestFromProducts}
              onSubmit={(title) => selected && onAddItem(selected.id, null, title)}
            />
          </div>
        ) : (
          <>
            {drag.arrange(GROUPS, listGroups).map((group) => {
              const groupItems = undoneItems.filter((item) => item.groupId === group.id);
              return (
                <section
                  key={group.id}
                  ref={drag.dragRef(group.id)}
                  className={`bg-white rounded-xl border border-gray-200 ${
                    lifting(groupItems) ? '' : 'overflow-hidden'
                  } ${drag.isDragging(group.id) ? 'relative z-20 shadow-xl border-blue-300' : ''}`}
                >
                  <GroupHeader
                    group={group}
                    count={groupItems.length}
                    onRename={(name) => onRenameGroup(group.id, name)}
                    onDelete={() => deleteGroupWithConfirm(group)}
                    handleProps={drag.gripProps(GROUPS, drag.arrange(GROUPS, listGroups), group.id)}
                  />
                  {itemRows(itemsSection(group.id), groupItems)}
                  <AddRow
                    divided={groupItems.length > 0}
                    label="追加"
                    allowEmpty
                    suggest={suggestFromProducts}
                    onSubmit={(title) => selected && onAddItem(selected.id, group.id, title)}
                  />
                </section>
              );
            })}

            {/* どの枠にも入れていない項目があるときだけ出す。 */}
            {ungroupedItems.length > 0 && (
              <section
                className={`bg-white rounded-xl border border-gray-200 ${
                  lifting(ungroupedItems) ? '' : 'overflow-hidden'
                }`}
              >
                <h3 className="text-[13px] font-bold text-gray-500 px-3 py-2 bg-gray-100 border-b border-gray-200">未分類</h3>
                {itemRows(itemsSection(null), ungroupedItems)}
                <AddRow
                  divided
                  label="追加"
                  allowEmpty
                  suggest={suggestFromProducts}
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
                  onRename={(title) => onRenameItem(item, title)}
                  onDelete={() => onDeleteItem(item.id)}
                />
              ))}
          </section>
        )}

        </ListEditorModal>
      )}
    </div>
  );
}
