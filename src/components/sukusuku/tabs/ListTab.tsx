'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, GripVertical, Lock, Pin, PinOff, Plus, Trash2, X } from 'lucide-react';
import type { ListBoard, ListGroup, ListItem } from '@/types/app';
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
  /** 未分類に名前を付ける（その名前のグループを作り、未分類の項目を移す）。 */
  onNameUngrouped: (listId: string, name: string) => void;
  /**
   * 項目を足して、足した項目を返す（失敗したら null）。`at` を渡すと、リスト全体の並び
   * （order）の中で afterId の項目の下へ入れる。
   */
  onAddItem: (
    listId: string,
    groupId: string | null,
    title: string,
    at?: { order: string[]; afterId: string | null },
  ) => Promise<ListItem | null>;
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

/**
 * 入力欄の書きかけを、閉じる操作でも保存するための登録簿。
 * ブラウザの戻る操作などで編集モードが閉じるときは、入力欄のonBlurが来ない。
 * 入力欄を持つ行は自分の「いま保存する」を登録しておき、閉じる前にまとめて呼ぶ。
 * mobile版（`mobile/src/components/list/ListRows.tsx`）と同じ仕様。
 */
class DraftRegistry {
  private flushers = new Set<() => boolean>();

  register(flush: () => boolean): () => void {
    this.flushers.add(flush);
    return () => {
      this.flushers.delete(flush);
    };
  }

  /** 書きかけを全部保存する。1つでも保存したら true。 */
  flush(): boolean {
    let saved = false;
    for (const flush of [...this.flushers]) if (flush()) saved = true;
    return saved;
  }
}

const DraftRegistryContext = createContext<DraftRegistry | null>(null);

/**
 * 書きかけを持つ入力欄用。draft が null のあいだは読むだけの行。
 * commit は書きかけを取り出して欄を閉じ、save で保存する。blur・改行・閉じる操作の
 * どこから呼ばれても保存は1回だけ（取り出したあとは null に戻るため）。
 * save は、保存したら true を返す。
 */
function useDraftField(save: (value: string) => boolean, initial: string | null = null) {
  const [draft, setDraftState] = useState<string | null>(initial);
  const draftRef = useRef<string | null>(initial);
  const saveRef = useRef(save);
  saveRef.current = save;
  const registry = useContext(DraftRegistryContext);

  const setDraft = useCallback((value: string | null) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);

  const commit = useCallback(() => {
    const value = draftRef.current;
    if (value === null) return false;
    draftRef.current = null;
    setDraftState(null);
    return saveRef.current(value);
  }, []);

  useEffect(() => registry?.register(commit), [registry, commit]);

  return { draft, setDraft, commit };
}

/** 変換の確定で押した改行は、改行として扱わない（日本語入力で行が増えてしまうため）。 */
const isEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.nativeEvent.isComposing;

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
  onInsertBelow,
  attachRef,
  onGrab,
  dragging,
}: {
  item: ListItem;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  /** 書き換え中に改行したとき、この項目の下に新しい項目の入力欄を出す。渡さなければ確定するだけ。 */
  onInsertBelow?: () => void;
  /** 動かすための持ち手。完了した項目には渡さない（並びを持たない）。 */
  attachRef?: (el: HTMLElement | null) => void;
  onGrab?: (event: ReactPointerEvent<HTMLElement>) => void;
  dragging?: boolean;
}) {
  // null のあいだは読むだけの行。押すと書きかけを持って入力欄になる。
  const { draft, setDraft, commit } = useDraftField((value) => {
    const title = value.trim();
    // 空のまま離れたのが消したいのか打ち間違いかは分からないので、元に戻す（消すのは×）。
    if (!title || title === item.title) return false;
    onRename(title);
    return true;
  });

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
          <span className={`block min-h-5 text-base break-words ${item.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {item.title}
          </span>
        </button>
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isEnter(e)) {
              commit();
              onInsertBelow?.();
            }
            if (e.key === 'Escape') setDraft(null);
          }}
          onBlur={commit}
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
  const { draft, setDraft, commit } = useDraftField((value) => {
    const name = value.trim();
    if (!name || name === group.name) return false;
    onRename(name);
    return true;
  });

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
            if (isEnter(e)) commit();
            if (e.key === 'Escape') setDraft(null);
          }}
          onBlur={commit}
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
 * 未分類の見出し。押すと名前を付けられる。未分類はグループの行を持たないので、
 * 名前を付けるとその名前のグループができ、未分類の項目はそこへ移る。
 */
function UngroupedHeader({ onName }: { onName: (name: string) => void }) {
  // null のあいだは読むだけの見出し。書き始めは空にして、例を出しておく。
  const { draft, setDraft, commit } = useDraftField((value) => {
    const name = value.trim();
    if (!name) return false;
    onName(name);
    return true;
  });

  return (
    <div className="flex items-center pl-3 pr-1.5 py-2 bg-gray-100 border-b border-gray-200 select-none">
      {draft === null ? (
        <button
          type="button"
          onClick={() => setDraft('')}
          aria-label="未分類に名前を付ける"
          className="flex-1 min-w-0 text-left text-[13px] font-bold text-gray-900 py-0.5"
        >
          未分類
        </button>
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isEnter(e)) commit();
            if (e.key === 'Escape') setDraft(null);
          }}
          onBlur={commit}
          autoFocus
          placeholder="グループの名前（例: イオン）"
          aria-label="グループの名前"
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1 text-[13px] font-bold outline-none focus:border-blue-500"
        />
      )}
    </div>
  );
}

/** 「+ ○○」の行。押すと入力欄が開く。 */
function AddButton({
  label,
  onClick,
  tone = 'plain',
  divided = false,
}: {
  label: string;
  onClick: () => void;
  /** 枠そのものを足す行は、項目の追加と見分けられるよう破線にする。 */
  tone?: 'plain' | 'outlined';
  /** 上に項目が並んでいるときは、線を引いて区切る。 */
  divided?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2.5 text-base text-gray-400 hover:bg-gray-50 transition ${
        tone === 'outlined'
          ? 'border border-dashed border-gray-300 rounded-xl justify-center'
          : divided
            ? 'border-t border-gray-200'
            : ''
      }`}
    >
      <Plus size={16} className="flex-none" />
      {label}
    </button>
  );
}

/**
 * 項目の入力欄（まだ保存していない新しい行）。改行で確定して、続けて次を打てる
 * （Google Keepと同じ動き）。確定した項目は呼び出し側が足し、この欄はその下へ移る。
 * 追加ボタンは無い。入力を終えて他へ触れたとき・編集モードを閉じたときにも、
 * 書きかけがあれば足す（空のまま閉じたときは何も足さない）。
 * 改行だけを続けて押すと空の項目が入る（空行を挟んで見出しのように使える）。
 */
function NewItemRow({
  onSubmit,
  onDone,
}: {
  onSubmit: (title: string) => void;
  /** 欄を閉じるとき。 */
  onDone: () => void;
}) {
  const { draft, setDraft, commit } = useDraftField((value) => {
    const title = value.trim();
    if (title) onSubmit(title);
    onDone();
    return title !== '';
  }, '');

  if (draft === null) return null;

  return (
    <div className="flex items-center gap-2 pl-1 pr-1 py-2.5 border-b border-gray-100 last:border-b-0">
      {/* 他の行と文字の位置をそろえる（持ち手とチェックの場所を空けておく）。 */}
      <span className="flex-none w-7" />
      <span className="flex-none w-6 h-6 rounded-full border-2 border-gray-200" />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (isEnter(e)) {
            onSubmit(draft.trim());
            setDraft('');
          }
          if (e.key === 'Escape') {
            setDraft(null);
            onDone();
          }
        }}
        onBlur={commit}
        autoFocus
        aria-label="新しい項目の内容"
        className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
      />
      {/* 行の右端の×と幅をそろえる。 */}
      <span className="flex-none w-7" />
    </div>
  );
}

/**
 * 枠（グループ）を足す行。押すまではただの「+ ○○」の行で、押すと入力欄になる。
 * 改行で確定しても欄は開いたままにするので、続けて打てる。追加ボタンは無く、
 * 入力を終えて他へ触れたとき・編集モードを閉じたときにも、書きかけがあれば足す。
 */
function AddRow({
  label,
  placeholder,
  onSubmit,
}: {
  label: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}) {
  const { draft, setDraft, commit } = useDraftField((value) => {
    const name = value.trim();
    if (!name) return false;
    onSubmit(name);
    return true;
  });

  if (draft === null) return <AddButton label={label} tone="outlined" onClick={() => setDraft('')} />;

  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    onSubmit(name);
    setDraft('');
  };

  return (
    <div className="border border-dashed border-gray-300 rounded-xl">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isEnter(e)) submit();
            if (e.key === 'Escape') setDraft(null);
          }}
          onBlur={commit}
          autoFocus
          placeholder={placeholder}
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}

/** 長押しで動かせる枠（セクション）。動かせるのは同じ枠の中だけ。 */
const LISTS_PINNED = 'lists:pinned';
const LISTS_OTHER = 'lists:other';
const GROUPS = 'groups';
const itemsSection = (groupId: string | null) => `items:${groupId ?? 'none'}`;

/**
 * 項目の入力欄を開いているあいだの持ち物。入力欄は afterId の項目の下に出し、確定するたびに
 * 新しい項目の下へ移る。保存は順番待ちで進める（続けて打っても並びが入れ替わらないように）ので、
 * 画面の状態とは別に、いまの並び（order）と位置（afterId）をここで持つ。
 * mobile版（`mobile/app/(tabs)/list.tsx`）と同じ仕様。
 */
interface ComposerSession {
  listId: string;
  /** 入れる枠。null は未分類（グループを作っていないリストもここ）。 */
  groupId: string | null;
  /** リスト全体の項目の並び（完了済みも含む）。 */
  order: string[];
  /** この項目の下に入れる。null は枠の先頭（枠が空のとき）。 */
  afterId: string | null;
}

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
      <h3 className="flex items-center gap-1 px-2.5 py-2 pr-9 bg-gray-50 border-b border-gray-200 text-lg font-bold text-gray-900">
        <span className="min-w-0 break-words">{list.name}</span>
        {/* 自分だけのリストは錠前を添える。 */}
        {list.isPrivate && <Lock size={11} className="flex-none text-gray-400" aria-label="自分だけ" />}
      </h3>
      <div className="px-2.5 py-2.5">
        {rows.map((row, index) =>
          row.type === 'group' ? (
            /* グループ名は下線で区切る。どこからどこまでが同じ枠かが線で分かる。 */
            <div
              key={row.key}
              className={`border-b border-gray-200 pb-1 mb-1.5 ${index === 0 ? '' : 'mt-2.5'}`}
            >
              <span className="block truncate text-base font-bold text-gray-900">{row.name}</span>
            </div>
          ) : (
            /* 項目どうしは線で区切らない（線が多いと詰まって見える）。 */
            <div key={row.key} className="flex items-start gap-1.5 py-[3px]">
              <span className="flex-none mt-[3px] w-3.5 h-3.5 rounded border border-gray-300" />
              <span className="flex-1 min-w-0 text-[15px] font-normal leading-[21px] text-gray-900 break-words line-clamp-2">{row.item.title}</span>
            </div>
          ),
        )}
        {rows.length === 0 && <p className="text-sm text-gray-300 py-1">項目なし</p>}
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
  onNameUngrouped,
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
  // 打ちかけの入力欄を、閉じる操作でも保存するための登録簿。
  const [drafts] = useState(() => new DraftRegistry());
  // 項目の入力欄。開いているあいだだけ持つ。
  const [composer, setComposer] = useState<{ session: ComposerSession; afterId: string | null } | null>(
    null,
  );
  const composeQueue = useRef<Promise<void>>(Promise.resolve());
  // 項目やグループを足したリスト。足した直後は画面の状態がまだ古いので、閉じるときの
  // 「空のリストか」の判定に使う。
  const touchedLists = useRef(new Set<string>());

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

  /**
   * 項目の入力欄を開く。groupId の枠で、afterId の項目の下（null なら枠の先頭）に出す。
   * 枠の末尾の「追加」と、項目の書き換え中の改行のどちらもここへ来る。
   */
  const openComposer = (listId: string, groupId: string | null, afterId: string | null) => {
    const order = items
      .filter((item) => item.listId === listId)
      .sort((a, b) => a.position - b.position)
      .map((item) => item.id);
    setComposer({ session: { listId, groupId, order, afterId }, afterId });
  };

  /**
   * 入力欄で確定した項目を、いまの位置（afterId の下）に足す。足したら入力欄をその下へ移す。
   * 保存は順番待ちで進める（続けて打っても、足した順に並ぶように）。
   */
  const composeItem = (session: ComposerSession, title: string) => {
    touchedLists.current.add(session.listId);
    composeQueue.current = composeQueue.current.then(async () => {
      const created = await onAddItem(session.listId, session.groupId, title, {
        order: session.order,
        afterId: session.afterId,
      });
      if (!created) return;
      const after = session.afterId === null ? -1 : session.order.indexOf(session.afterId);
      const ordered = [...session.order];
      ordered.splice(after < 0 ? ordered.length : after + 1, 0, created.id);
      session.order = ordered;
      session.afterId = created.id;
      setComposer((prev) => (prev?.session === session ? { ...prev, afterId: created.id } : prev));
    });
  };

  /**
   * 項目の行。左端の持ち手で動かす。この枠（groupId）に入力欄が開いているときは、
   * その位置の行の下に入力欄を挟む。入力欄は並びが変わっても作り直さない（key固定）。
   */
  const itemRows = (sectionKey: string, rows: ListItem[], groupId: string | null) => {
    const arranged = drag.arrange(sectionKey, rows);
    const open = composer && composer.session.groupId === groupId ? composer : null;
    // 入力欄を出す位置（この番号の行の下。-1は先頭）。基準の行が消えていたら枠の末尾。
    let slot: number | null = null;
    if (open) {
      const anchor = open.afterId === null ? -1 : arranged.findIndex((item) => item.id === open.afterId);
      slot = open.afterId === null ? -1 : anchor >= 0 ? anchor : arranged.length - 1;
    }
    const composerRow = open ? (
      <NewItemRow
        key="composer"
        onSubmit={(title) => composeItem(open.session, title)}
        onDone={() => setComposer((prev) => (prev?.session === open.session ? null : prev))}
      />
    ) : null;

    const children: ReactNode[] = [];
    if (slot === -1) children.push(composerRow);
    arranged.forEach((item, index) => {
      children.push(
        <ItemRow
          key={item.id}
          item={item}
          onToggle={() => onToggleItem(item.id)}
          onRename={(title) => onRenameItem(item, title)}
          onInsertBelow={() => openComposer(item.listId, item.groupId, item.id)}
          onDelete={() => onDeleteItem(item.id)}
          attachRef={drag.dragRef(item.id)}
          onGrab={drag.gripProps(sectionKey, arranged, item.id).onPointerDown}
          dragging={drag.isDragging(item.id)}
        />,
      );
      if (slot === index) children.push(composerRow);
    });
    return children;
  };

  /** 枠の末尾の「追加」。その枠に入力欄が開いているあいだは出さない。 */
  const addItemButton = (listId: string, groupId: string | null, rows: ListItem[]) =>
    composer?.session.groupId === groupId ? null : (
      <AddButton
        label="追加"
        divided={rows.length > 0}
        onClick={() => openComposer(listId, groupId, rows.length > 0 ? rows[rows.length - 1].id : null)}
      />
    );

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
    // 打ちかけの項目・グループ名があれば、閉じる前に保存する。戻る操作などでは
    // 入力欄からonBlurが来ず、書きかけが捨てられていたため。
    drafts.flush();
    const name = draftName.trim();
    const isEmpty =
      !touchedLists.current.has(list.id) &&
      !groups.some((group) => group.listId === list.id) &&
      !items.some((item) => item.listId === list.id);
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
      <div className="p-4 h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3">
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
      </div>
    );
  }

  return (
    <div className="px-1.5 py-3 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      {/* 一覧: Keepと同じく全部のリストをカードで並べる。2列にして1画面に4〜5つ入れる。
          固定したものは上にまとめる（見出しは付けず、カードのピンの色で分かる）。
          並べ替えは長押ししてそのまま動かす。 */}
        <div className="flex-1 overflow-y-auto">
          {pinnedLists.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 items-start gap-2.5 content-start mb-2.5">
              {overviewCards(LISTS_PINNED, pinnedLists)}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 items-start gap-2.5 content-start">
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
        <DraftRegistryContext.Provider value={drafts}>
        {/* グループを作っていないリストは、枠1つのただのチェックリストになる。 */}
        {listGroups.length === 0 ? (
          <div
            className={`bg-white rounded-xl border border-gray-200 ${lifting(undoneItems) ? '' : 'overflow-hidden'}`}
          >
            {itemRows(itemsSection(null), undoneItems, null)}
            {addItemButton(selected.id, null, undoneItems)}
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
                  {itemRows(itemsSection(group.id), groupItems, group.id)}
                  {addItemButton(selected.id, group.id, groupItems)}
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
                {/* 見出しを押すと名前を付けられる（その名前のグループになる）。 */}
                <UngroupedHeader onName={(name) => selected && onNameUngrouped(selected.id, name)} />
                {itemRows(itemsSection(null), ungroupedItems, null)}
                {addItemButton(selected.id, null, ungroupedItems)}
              </section>
            )}
          </>
        )}

        {/* 枠そのものを足す。お店が増えたらここから作る。 */}
        {selected && (
          <AddRow
            label="グループを追加"
            placeholder="グループの名前（例: イオン）"
            onSubmit={(name) => {
              touchedLists.current.add(selected.id);
              onAddGroup(selected.id, name);
            }}
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
        </DraftRegistryContext.Provider>

        </ListEditorModal>
      )}
    </div>
  );
}
