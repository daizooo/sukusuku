import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react-native';
import type { ListBoard, ListGroup, ListItem } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useScrollTopOnFocus } from '@/hooks/useScrollTopOnFocus';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { useFamilyRefresh } from '@/lib/familySync';
import {
  deleteDoneItems,
  deleteGroup,
  deleteItem,
  deleteList,
  insertGroup,
  insertItem,
  insertList,
  loadLists,
  moveUngroupedItems,
  seedDefaultLists,
  updateGroupName,
  updateGroupPositions,
  updateItemDone,
  updateItemPositions,
  updateItemTitle,
  updateList,
  updateListPinned,
  updateListPositions,
} from '@/lib/api/lists';
import ListEditorModal from '@/components/list/ListEditorModal';
import ListOverviewCard from '@/components/list/ListOverviewCard';
import {
  AddItemButton,
  AddRow,
  DraftRegistry,
  DraftRegistryContext,
  GroupHeader,
  ItemRow,
  NewItemRow,
  UngroupedHeader,
} from '@/components/list/ListRows';
import { useDragReorder } from '@/components/list/useDragReorder';

/**
 * 買い出し・やりたいこと・やることなどのリスト（docs/lists.md）。
 * Web版の `src/components/sukusuku/tabs/ListTab.tsx` を置き換えたもの。
 * 出す項目・並び・文言・操作の仕方は同じにしてある。
 *
 * Google Keepと同じく、**枠（カード）が操作の単位**になる。グループ（お店など）ごとに
 * 枠があり、枠は一覧の中で足せる・消せる。項目もその枠の中で足せる・消せる。
 *
 * 開いたときはKeepと同じく**全部のリストがカードで並ぶ**（1画面に4〜5つ見える）。
 * カードを押すとそのリストが**画面の中央に拡大して開き（編集モード）**、見出し・項目・
 * グループ・固定・共有・削除をそこで済ませる。設定の画面は無い（手間を減らすため）。
 *
 * スクロールするのは一覧と、編集モードの中身だけ。見出しと下の道具列は固定する。
 *
 * 並べ替えとピン止めもKeepに合わせる。よく開くリストは一覧の先頭へ固定でき、
 * 並び順は、一覧のカードは**長押し**、リストの中の項目・グループは**左端の持ち手を押して**
 * そのまま動かす。仕組みは components/list/useDragReorder.ts。
 *
 * Web版はアプリ全体で持っている状態を受け取るが、こちらはタブごとの画面なので
 * リスト・グループ・項目をこの画面で読み書きする。
 */

/** 束ねる区切りの呼び名の既定。画面には出さず、保存済みの値をそのまま持ち回る。 */
const DEFAULT_GROUP_LABEL = 'グループ';

/** 長押しで動かせる枠（セクション）。動かせるのは同じ枠の中だけ。 */
const LISTS_PINNED = 'lists:pinned';
const LISTS_OTHER = 'lists:other';
const GROUPS = 'groups';
const itemsSection = (groupId: string | null) => `items:${groupId ?? 'none'}`;

/**
 * 項目の入力欄を開いているあいだの持ち物。入力欄は afterId の項目の下に出し、確定するたびに
 * 新しい項目の下へ移る。保存は順番待ちで進める（続けて打っても並びが入れ替わらないように）ので、
 * 画面の状態とは別に、いまの並び（order）と位置（afterId）をここで持つ。
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

export default function ListScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [lists, setLists] = useState<ListBoard[]>([]);
  const [groups, setGroups] = useState<ListGroup[]>([]);
  const [items, setItems] = useState<ListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // nullのあいだはリストを並べた一覧だけを出す。カードを押すとそのリストを編集モードで開く。
  const [openListId, setOpenListId] = useState<string | null>(null);
  // 今の編集が「新しく作ったリスト」か。見出しへ入力を移し、何も書かずに閉じたら消す。
  const [isNewList, setIsNewList] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // 打ちかけの入力欄を、閉じる操作でも保存するための登録簿（ListRows.tsx の DraftRegistry）。
  const [drafts] = useState(() => new DraftRegistry());
  // 項目の入力欄。開いているあいだだけ持つ。
  const [composer, setComposer] = useState<{ session: ComposerSession; afterId: string | null } | null>(
    null,
  );
  const composeQueue = useRef<Promise<void>>(Promise.resolve());
  // 項目やグループを足したリスト。足した直後は画面の状態がまだ古いので、閉じるときの
  // 「空のリストか」の判定に使う。
  const touchedLists = useRef(new Set<string>());

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const snapshot = await loadLists(supabase, membership.familyId);
        if (!isMounted) return;
        setLists(snapshot.lists);
        setGroups(snapshot.groups);
        setItems(snapshot.items);
      } catch {
        // 圏外でも画面は出す。出せるところまで出して、残りは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  useFamilyRefresh(['lists', 'list_groups', 'list_items'], () => {
    if (!familyId) return;
    void loadLists(supabase, familyId)
      .then((snapshot) => {
        setLists(snapshot.lists);
        setGroups(snapshot.groups);
        setItems(snapshot.items);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

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

  // --- 保存（画面を先に直してから送る。失敗したら元に戻す） ---

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  /** 渡した順に position を振り直す。画面の並びもその順にそろえる。 */
  const applyOrder = <T extends { id: string; position: number }>(rows: T[], orderedIds: string[]): T[] =>
    rows.map((row) => {
      const position = orderedIds.indexOf(row.id);
      return position < 0 ? row : { ...row, position };
    });

  const reorderLists = async (orderedIds: string[]) => {
    const previous = lists;
    setLists((prev) => applyOrder(prev, orderedIds));
    try {
      await updateListPositions(supabase, orderedIds);
    } catch {
      setLists(previous);
      failed('並べ替えを保存');
    }
  };

  const reorderGroups = async (orderedIds: string[]) => {
    const previous = groups;
    setGroups((prev) => applyOrder(prev, orderedIds));
    try {
      await updateGroupPositions(supabase, orderedIds);
    } catch {
      setGroups(previous);
      failed('並べ替えを保存');
    }
  };

  const reorderItems = async (orderedIds: string[]) => {
    const previous = items;
    setItems((prev) => applyOrder(prev, orderedIds));
    try {
      await updateItemPositions(supabase, orderedIds);
    } catch {
      setItems(previous);
      failed('並べ替えを保存');
    }
  };

  /**
   * 長押しで動かしたあとの保存。枠（セクション）ごとに宛先を分ける。
   * リストは固定とその他をつないだ「画面の並び」で振り直す。
   */
  const drag = useDragReorder(
    useCallback(
      (sectionKey: string, orderedIds: string[]) => {
        if (sectionKey === LISTS_PINNED)
          void reorderLists([...orderedIds, ...otherLists.map((list) => list.id)]);
        else if (sectionKey === LISTS_OTHER)
          void reorderLists([...pinnedLists.map((list) => list.id), ...orderedIds]);
        else if (sectionKey === GROUPS) void reorderGroups(orderedIds);
        else void reorderItems(orderedIds);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [otherLists, pinnedLists, lists, groups, items],
    ),
  );

  /**
   * 新しいリストを作って、そのまま編集モードで開く（見出しから打ち始める）。
   * 名前は空で作り、何も書かずに閉じたときは closeEditor が消す。
   * 新しいリストの既定は「自分だけ」。家族に見せたいものだけ共有へ切り替える。
   */
  const createList = async () => {
    if (!familyId || !userId) return;
    try {
      const created = await insertList(
        supabase,
        familyId,
        { name: '', groupLabel: DEFAULT_GROUP_LABEL, position: lists.length, isPrivate: true },
        userId,
      );
      setLists((prev) => [...prev, created]);
      setIsNewList(true);
      setOpenListId(created.id);
    } catch {
      failed('リストの追加');
    }
  };

  /** 名前・共有設定など、リスト自身の項目を直す。 */
  const patchList = async (list: ListBoard, patch: Partial<Pick<ListBoard, 'name' | 'isPrivate'>>) => {
    const previous = lists;
    const updated: ListBoard = {
      ...list,
      ...patch,
      // 共有設定が入る前に作られたリストは作成者を持たない。そのまま「自分だけ」に
      // すると誰にも見えなくなるため、切り替えた本人を作成者として入れる。
      createdBy: list.createdBy ?? (patch.isPrivate ? userId : null),
    };
    setLists((prev) => prev.map((l) => (l.id === list.id ? updated : l)));
    try {
      await updateList(supabase, updated);
    } catch {
      setLists(previous);
      failed('リストの保存');
    }
  };

  /**
   * 編集モードを閉じる。見出しの書きかけがあれば保存してから閉じる。
   * 新しく作ったまま何も入れなかったリストは、空のカードが残らないよう消す。
   */
  const closeEditor = (list: ListBoard, draftName: string) => {
    // 打ちかけの項目・グループ名があれば、閉じる前に保存する。閉じるボタンを押しても
    // キーボードの入力欄からはonBlurが来ず、書きかけが捨てられていたため。
    drafts.flush();
    const name = draftName.trim();
    const isEmpty =
      !touchedLists.current.has(list.id) &&
      !groups.some((group) => group.listId === list.id) &&
      !items.some((item) => item.listId === list.id);
    setOpenListId(null);
    setIsNewList(false);
    if (!name && list.name === '' && isEmpty) {
      void removeList(list.id);
      return;
    }
    // 見出しを空にしたまま項目だけ入れたときは、名前が無いカードにならないよう仮の名前を付ける。
    const next = name || list.name || '無題';
    if (next !== list.name) void patchList(list, { name: next });
  };

  const removeList = async (id: string) => {
    const previous = lists;
    setLists((prev) => prev.filter((list) => list.id !== id));
    setOpenListId(null);
    try {
      await deleteList(supabase, id);
      // 中のグループ・項目もDB側で消えるので、画面からも外す。
      setGroups((prev) => prev.filter((group) => group.listId !== id));
      setItems((prev) => prev.filter((item) => item.listId !== id));
    } catch {
      setLists(previous);
      failed('リストの削除');
    }
  };

  const togglePin = async (list: ListBoard) => {
    const previous = lists;
    setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, pinned: !l.pinned } : l)));
    try {
      await updateListPinned(supabase, list.id, !list.pinned);
    } catch {
      setLists(previous);
      failed('固定の切り替え');
    }
  };

  const addGroup = async (listId: string, name: string) => {
    touchedLists.current.add(listId);
    try {
      const created = await insertGroup(supabase, {
        listId,
        name,
        position: groups.filter((group) => group.listId === listId).length,
      });
      setGroups((prev) => [...prev, created]);
    } catch {
      failed('グループの追加');
    }
  };

  const renameGroup = async (id: string, name: string) => {
    const previous = groups;
    setGroups((prev) => prev.map((group) => (group.id === id ? { ...group, name } : group)));
    try {
      await updateGroupName(supabase, id, name);
    } catch {
      setGroups(previous);
      failed('グループの保存');
    }
  };

  /**
   * 未分類に名前を付ける。未分類はグループの行を持たないので、その名前のグループを
   * 末尾（未分類が出ていた位置）に作り、未分類の項目をそこへ移す。
   */
  const nameUngrouped = async (listId: string, name: string) => {
    let created: ListGroup;
    try {
      created = await insertGroup(supabase, {
        listId,
        name,
        position: groups.filter((group) => group.listId === listId).length,
      });
    } catch {
      failed('グループの追加');
      return;
    }
    setGroups((prev) => [...prev, created]);
    const previousItems = items;
    setItems((prev) =>
      prev.map((item) => (item.listId === listId && item.groupId === null ? { ...item, groupId: created.id } : item)),
    );
    try {
      await moveUngroupedItems(supabase, listId, created.id);
    } catch {
      // グループはできているので残し、項目だけ未分類へ戻す。
      setItems(previousItems);
      failed('項目の移動');
    }
  };

  const removeGroup = async (id: string) => {
    const previousGroups = groups;
    setGroups((prev) => prev.filter((group) => group.id !== id));
    // 中の項目は消さず未分類へ落ちる（DB側の on delete set null と同じ）。
    setItems((prev) => prev.map((item) => (item.groupId === id ? { ...item, groupId: null } : item)));
    try {
      await deleteGroup(supabase, id);
    } catch {
      setGroups(previousGroups);
      failed('グループの削除');
    }
  };

  const deleteGroupWithConfirm = (group: ListGroup) => {
    const count = listItems.filter((item) => item.groupId === group.id).length;
    const suffix = count > 0 ? `\n中の${count}件は「未分類」に残ります。` : '';
    Alert.alert(`「${group.name}」を削除しますか？${suffix}`, undefined, [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => void removeGroup(group.id) },
    ]);
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
   * 末尾に足すときは position を件数にするだけ。途中に入れるときは、全体の並びを振り直す。
   */
  const composeItem = (session: ComposerSession, title: string) => {
    touchedLists.current.add(session.listId);
    composeQueue.current = composeQueue.current.then(async () => {
      const after = session.afterId === null ? -1 : session.order.indexOf(session.afterId);
      const previousOrder = session.order;
      const insertAt = after < 0 ? previousOrder.length : after + 1;
      const isInsertion = insertAt < previousOrder.length;
      try {
        const created = await insertItem(supabase, {
          listId: session.listId,
          groupId: session.groupId,
          title,
          position: previousOrder.length,
        });
        const ordered = [...previousOrder];
        ordered.splice(insertAt, 0, created.id);
        session.order = ordered;
        session.afterId = created.id;
        setItems((prev) => (isInsertion ? applyOrder([...prev, created], ordered) : [...prev, created]));
        setComposer((prev) => (prev?.session === session ? { ...prev, afterId: created.id } : prev));
        if (isInsertion) {
          try {
            await updateItemPositions(supabase, ordered);
          } catch {
            setItems((prev) => applyOrder(prev, [...previousOrder, created.id]));
            failed('並び順の保存');
          }
        }
      } catch {
        failed('項目の追加');
      }
    });
  };

  const toggleItem = async (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!target) return;
    const done = !target.done;
    const doneAt = done ? new Date() : null;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, done, doneAt } : item)));
    try {
      await updateItemDone(supabase, id, done, doneAt);
    } catch {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, done: target.done, doneAt: target.doneAt } : item,
        ),
      );
      failed('項目の保存');
    }
  };

  const renameItem = async (target: ListItem, title: string) => {
    setItems((prev) => prev.map((item) => (item.id === target.id ? { ...item, title } : item)));
    try {
      await updateItemTitle(supabase, target.id, title);
    } catch {
      setItems((prev) => prev.map((item) => (item.id === target.id ? target : item)));
      failed('項目の保存');
    }
  };

  const removeItem = async (id: string) => {
    const previous = items;
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await deleteItem(supabase, id);
    } catch {
      setItems(previous);
      failed('項目の削除');
    }
  };

  const clearDone = (listId: string, name: string) => {
    Alert.alert(`「${name}」の完了した項目をすべて削除しますか？`, undefined, [
      { text: 'やめる', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: () => {
          const previous = items;
          setItems((prev) => prev.filter((item) => !(item.listId === listId && item.done)));
          void deleteDoneItems(supabase, listId).catch(() => {
            setItems(previous);
            failed('まとめて削除');
          });
        },
      },
    ]);
  };

  const addDefaultLists = async () => {
    if (!familyId || !userId) return;
    try {
      const created = await seedDefaultLists(supabase, familyId, userId);
      setLists((prev) => [...prev, ...created]);
    } catch {
      failed('リストの作成');
    }
  };

  // --- 画面 ---

  // タブを開くたびに、スクロールはいちばん上から（2026-10-16）。
  const scrollRef = useRef<ScrollView>(null);
  useScrollTopOnFocus(scrollRef);

  if (isSessionLoading) {
    return (
      <SafeAreaView edges={['top']} style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  if (isLoading) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <Text style={styles.message}>読み込み中...</Text>
      </SafeAreaView>
    );
  }

  if (lists.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={[styles.screen, styles.centered, styles.padded]}>
        <Text style={styles.message}>リストはまだありません</Text>
        <Pressable accessibilityRole="button" onPress={() => void addDefaultLists()} style={styles.seedButton}>
          <Text style={styles.seedTitle}>よく使う3つのリストを作る</Text>
          <Text style={styles.seedNote}>買い出し・やりたいこと・やること</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void createList()} style={styles.seedOwn}>
          <Text style={styles.seedOwnText}>自分でリストを作る</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  /** 一覧のカード。2列に並べる（Web版の grid-cols-2 と同じ）。 */
  const overviewCards = (sectionKey: string, section: ListBoard[]) => (
    <View style={styles.grid} {...drag.panHandlers}>
      {section.map((list) => (
        <Animated.View
          key={list.id}
          {...drag.measureProps(list.id)}
          style={[styles.gridCell, drag.styleFor(list.id)]}
        >
          <ListOverviewCard
            list={list}
            /* 並べ替えたあとも一覧の中身が同じ順で出るよう、ここでも position で並べる。 */
            groups={groups
              .filter((group) => group.listId === list.id)
              .sort((a, b) => a.position - b.position)}
            items={items.filter((item) => item.listId === list.id).sort((a, b) => a.position - b.position)}
            onOpen={() => setOpenListId(list.id)}
            onTogglePin={() => void togglePin(list)}
            holdProps={drag.holdProps(sectionKey, section, list.id)}
            dragging={drag.isDragging(list.id)}
          />
        </Animated.View>
      ))}
      {sectionKey === LISTS_OTHER && (
        <View style={styles.gridCell}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void createList()}
            style={styles.addList}
          >
            <Plus size={16} color={colors.textFaint} />
            <Text style={styles.addListText}>リストを追加</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  /**
   * 項目の行。左端の持ち手で動かす。この枠（groupId）に入力欄が開いているときは、
   * その位置の行の下に入力欄を挟む。入力欄は並びが変わっても作り直さない（key固定）。
   */
  const itemRows = (sectionKey: string, rows: ListItem[], groupId: string | null) => {
    const open = composer && composer.session.groupId === groupId ? composer : null;
    // 入力欄を出す位置（この番号の行の下。-1は先頭）。基準の行が消えていたら枠の末尾。
    let slot: number | null = null;
    if (open) {
      const anchor = open.afterId === null ? -1 : rows.findIndex((item) => item.id === open.afterId);
      slot = open.afterId === null ? -1 : anchor >= 0 ? anchor : rows.length - 1;
    }
    const composerRow = open ? (
      <NewItemRow
        key="composer"
        divided={slot !== null && slot >= 0}
        onSubmit={(title) => composeItem(open.session, title)}
        onDone={() => setComposer((prev) => (prev?.session === open.session ? null : prev))}
      />
    ) : null;

    const children: ReactNode[] = [];
    if (slot === -1) children.push(composerRow);
    rows.forEach((item, index) => {
      children.push(
        <Animated.View
          key={item.id}
          {...drag.measureProps(item.id)}
          style={[drag.styleFor(item.id), drag.isDragging(item.id) && styles.lifted]}
        >
          <ItemRow
            item={item}
            divided={index > 0}
            gripProps={drag.gripProps(sectionKey, rows, item.id)}
            onToggle={() => void toggleItem(item.id)}
            onRename={(title) => void renameItem(item, title)}
            onInsertBelow={() => openComposer(item.listId, item.groupId, item.id)}
            onDelete={() => void removeItem(item.id)}
          />
        </Animated.View>,
      );
      if (slot === index) children.push(composerRow);
    });
    return <View {...drag.panHandlers}>{children}</View>;
  };

  /** 枠の末尾の「追加」。その枠に入力欄が開いているあいだは出さない。 */
  const addItemButton = (listId: string, groupId: string | null, rows: ListItem[]) =>
    composer?.session.groupId === groupId ? null : (
      <AddItemButton
        divided={rows.length > 0}
        onPress={() => openComposer(listId, groupId, rows.length > 0 ? rows[rows.length - 1].id : null)}
      />
    );

  /* 編集モード: 開いたカードを画面の中央に拡大して出す（Keepと同じ）。
     見出し・項目・グループ・固定・共有・削除をここで済ませる。 */
  const editor = selected && (
    <ListEditorModal
      // 対象が変わるたびに作り直して、見出しの書きかけを持ち越さない。
      key={selected.id}
      list={selected}
      focusTitle={isNewList}
      scrollEnabled={!drag.isActive}
      onRename={(name) => void patchList(selected, { name })}
      onTogglePin={() => void togglePin(selected)}
      onToggleShare={() => void patchList(selected, { isPrivate: !selected.isPrivate })}
      onDelete={() =>
        Alert.alert('このリストを削除しますか？', '中の項目もすべて消えます。', [
          { text: 'やめる', style: 'cancel' },
          { text: '削除', style: 'destructive', onPress: () => void removeList(selected.id) },
        ])
      }
      onClose={(draftName) => closeEditor(selected, draftName)}
    >
      <DraftRegistryContext.Provider value={drafts}>
        {/* グループを作っていないリストは、枠1つのただのチェックリストになる。 */}
        {listGroups.length === 0 ? (
          <View style={[styles.card, styles.cardSpaced]}>
            {itemRows(itemsSection(null), undoneItems, null)}
            {addItemButton(selected.id, null, undoneItems)}
          </View>
        ) : (
          <View {...drag.panHandlers}>
            {listGroups.map((group) => {
              const groupItems = undoneItems.filter((item) => item.groupId === group.id);
              return (
                <Animated.View
                  key={group.id}
                  {...drag.measureProps(group.id)}
                  style={[
                    styles.card,
                    styles.cardSpaced,
                    drag.styleFor(group.id),
                    drag.isDragging(group.id) && styles.liftedCard,
                  ]}
                >
                  {/* 枠ごと動かすときは、見出しの左端の持ち手を押したまま動かす。 */}
                  <GroupHeader
                    group={group}
                    gripProps={drag.gripProps(GROUPS, listGroups, group.id)}
                    count={groupItems.length}
                    onRename={(name) => void renameGroup(group.id, name)}
                    onDelete={() => deleteGroupWithConfirm(group)}
                  />
                  {itemRows(itemsSection(group.id), groupItems, group.id)}
                  {addItemButton(selected.id, group.id, groupItems)}
                </Animated.View>
              );
            })}

            {/* どの枠にも入れていない項目があるときだけ出す。 */}
            {ungroupedItems.length > 0 && (
              <View style={[styles.card, styles.cardSpaced]}>
                {/* 見出しを押すと名前を付けられる（その名前のグループになる）。 */}
                <UngroupedHeader onName={(name) => void nameUngrouped(selected.id, name)} />
                {itemRows(itemsSection(null), ungroupedItems, null)}
                {addItemButton(selected.id, null, ungroupedItems)}
              </View>
            )}
          </View>
        )}

        {/* 枠そのものを足す。お店が増えたらここから作る。 */}
        <View style={styles.cardSpaced}>
          <AddRow
            label="グループを追加"
            placeholder="グループの名前（例: イオン）"
            onSubmit={(name) => void addGroup(selected.id, name)}
          />
        </View>

        {doneItems.length > 0 && (
          <View style={[styles.card, styles.cardSpaced]}>
            <View style={[styles.doneHeader, showDone && styles.doneHeaderOpen]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showDone }}
                onPress={() => setShowDone((prev) => !prev)}
                style={styles.doneToggle}
              >
                {showDone ? (
                  <ChevronDown size={14} color={colors.textMuted} />
                ) : (
                  <ChevronRight size={14} color={colors.textMuted} />
                )}
                <Text style={styles.doneToggleText}>完了 {doneItems.length}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => clearDone(selected.id, selected.name)}
                style={styles.clearDone}
              >
                <Text style={styles.clearDoneText}>まとめて消す</Text>
              </Pressable>
            </View>
            {showDone &&
              doneItems.map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  divided={index > 0}
                  onToggle={() => void toggleItem(item.id)}
                  onRename={(title) => void renameItem(item, title)}
                  onDelete={() => void removeItem(item.id)}
                />
              ))}
          </View>
        )}
      </DraftRegistryContext.Provider>
    </ListEditorModal>
  );

  /* 一覧: Keepと同じく全部のリストをカードで並べる。2列にして1画面に4〜5つ入れる。
     固定したものは上にまとめる（見出しは付けず、カードのピンの色で分かる）。
     並べ替えは長押ししてそのまま動かす。 */
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        style={styles.page}
        contentContainerStyle={styles.overviewContent}
        // 持ち上げているあいだは指で並べ替えるので、スクロールを止める。
        scrollEnabled={!drag.isActive}
      >
        {pinnedLists.length > 0 && overviewCards(LISTS_PINNED, pinnedLists)}
        {overviewCards(LISTS_OTHER, otherLists)}
        {/* 長押しで動かせることは見ただけでは分からないので、小さく添える。 */}
        {sortedLists.length > 1 && <Text style={styles.holdHint}>長押しで並べ替え</Text>}
      </ScrollView>
      {editor}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  padded: { padding: 16, gap: 12 },
  flex: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 4, paddingVertical: 12 },
  message: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },

  seedButton: {
    alignItems: 'center',
    backgroundColor: colors.diaperSurface,
    borderWidth: 1,
    borderColor: colors.diaperBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  seedTitle: { fontSize: 12, fontWeight: '700', color: colors.navActiveText },
  seedNote: { fontSize: 10, color: colors.navActive, marginTop: 4 },
  seedOwn: { paddingHorizontal: 16, paddingVertical: 8 },
  seedOwnText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },

  overviewContent: { paddingBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  gridCell: { width: '50%', padding: 5 },
  addList: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 12,
  },
  addListText: { fontSize: 14, color: colors.textFaint },
  holdHint: { fontSize: 10, color: colors.borderStrong, textAlign: 'center', paddingTop: 12 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardSpaced: { marginTop: 12 },
  lifted: { zIndex: 20, elevation: 8, backgroundColor: colors.surface, borderRadius: 8 },
  liftedCard: { borderColor: colors.dragBorder },

  doneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.background,
  },
  doneHeaderOpen: { borderBottomWidth: 1, borderBottomColor: colors.border },
  doneToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  doneToggleText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  clearDone: { paddingHorizontal: 8, paddingVertical: 4 },
  clearDoneText: { fontSize: 11, color: colors.textFaint, fontWeight: '500' },
});
