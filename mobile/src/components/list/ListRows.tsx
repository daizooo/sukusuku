import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, GripVertical, Plus, Trash2, X } from 'lucide-react-native';
import type { ListGroup, ListItem } from '@/types/app';
import { colors } from '@/lib/theme';
import type { GripProps } from '@/components/list/useDragReorder';

// リストの中の行。Web版の `src/components/sukusuku/tabs/ListTab.tsx` の中にある
// ItemCheck / ItemRow / GroupHeader / AddRow を、そのまま置き換えたもの。

/**
 * 入力欄の書きかけを、閉じる操作でも保存するための登録簿。
 *
 * 「閉じる」ボタンや暗い部分を押しても、キーボードの入力欄は外れた扱いにならない
 * （onBlurが来ない）。そのため、打ちかけのまま閉じると書きかけが捨てられていた。
 * 入力欄を持つ行は自分の「いま保存する」を登録しておき、編集モードを閉じる前に
 * まとめて呼ぶ（呼び出し側は list.tsx の closeEditor）。
 */
export class DraftRegistry {
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

export const DraftRegistryContext = createContext<DraftRegistry | null>(null);

/**
 * 書きかけを持つ入力欄用。draft が null のあいだは読むだけの行。
 * commit は書きかけを取り出して欄を閉じ、save で保存する。blur・改行・閉じる操作の
 * どこから呼ばれても保存は1回だけ（取り出したあとは null に戻るため）。
 * save は、保存したら true を返す。
 */
function useDraftField(save: (value: string) => boolean, initial: string | null = null) {
  const [draft, setDraftState] = useState<string | null>(initial);
  // 入力のたびに最新の文字をここへも置く。閉じる操作の直前に打った文字も拾うため。
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

export function ItemCheck({
  done,
  onToggle,
  label,
}: {
  done: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: done }}
      onPress={onToggle}
      hitSlop={6}
      style={[styles.check, done && styles.checkDone]}
    >
      <Check size={14} strokeWidth={3} color={done ? colors.primaryText : 'transparent'} />
    </Pressable>
  );
}

/** 並べ替えの持ち手（Keepと同じ左端の点々）。触れた瞬間に持ち上がるので、指で狙いやすいよう広めに取る。 */
function Grip({ gripProps, label }: { gripProps: GripProps; label: string }) {
  return (
    <View accessibilityLabel={label} {...gripProps} style={styles.grip}>
      <GripVertical size={18} color={colors.borderStrong} />
    </View>
  );
}

/**
 * 項目の行。押すとその場で入力欄になり、枠の中で書き換える
 * （Keepと同じで、項目のためだけの画面は出さない）。持っているのは内容だけ。
 */
export function ItemRow({
  item,
  onToggle,
  onRename,
  onDelete,
  onInsertBelow,
  divided,
  gripProps,
}: {
  item: ListItem;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  /** 書き換え中に改行したとき、この項目の下に新しい項目の入力欄を出す。渡さなければ確定するだけ。 */
  onInsertBelow?: () => void;
  /** 上に行があるときは、線を引いて区切る。 */
  divided?: boolean;
  /** 並べ替えの持ち手。完了した項目には渡さない（並びを持たない）。 */
  gripProps?: GripProps;
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
    <View style={[styles.itemRow, gripProps && styles.itemRowWithGrip, divided && styles.divided]}>
      {gripProps && <Grip gripProps={gripProps} label={`${item.title}を並べ替え`} />}
      <ItemCheck
        done={item.done}
        onToggle={onToggle}
        label={`${item.title}を${item.done ? '戻す' : '完了にする'}`}
      />
      {draft === null ? (
        <Pressable accessibilityRole="button" onPress={() => setDraft(item.title)} style={styles.flex}>
          <Text style={[styles.itemTitle, item.done && styles.itemTitleDone]}>{item.title}</Text>
        </Pressable>
      ) : (
        <TextInput
          style={[styles.input, styles.flex]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => {
            commit();
            onInsertBelow?.();
          }}
          onBlur={commit}
          autoFocus
          // 改行のあとすぐ下の入力欄へ移るので、キーボードを閉じない。
          blurOnSubmit={false}
          returnKeyType="done"
          accessibilityLabel="項目の内容"
        />
      )}
      {/* その場で消せるようにする。打ち間違いをすぐ取り消せるほうが、
          いちいち書き換えに入るより手数が少ない。 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.title}を削除`}
        onPress={onDelete}
        hitSlop={6}
        style={styles.iconButton}
      >
        <X size={16} color={colors.borderStrong} />
      </Pressable>
    </View>
  );
}

/**
 * 枠（グループ）の見出し。名前を押すとその場で直せる（設定の画面を出さない）。
 */
export function GroupHeader({
  group,
  count,
  onRename,
  onDelete,
  gripProps,
}: {
  group: ListGroup;
  count: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** 枠ごと動かすための持ち手。 */
  gripProps?: GripProps;
}) {
  // null のあいだは読むだけの見出し。押すと書きかけを持って入力欄になる。
  const { draft, setDraft, commit } = useDraftField((value) => {
    const name = value.trim();
    if (!name || name === group.name) return false;
    onRename(name);
    return true;
  });

  return (
    <View style={[styles.groupHeader, gripProps && styles.groupHeaderWithGrip]}>
      {gripProps && <Grip gripProps={gripProps} label={`${group.name}を並べ替え`} />}
      {draft === null ? (
        <Pressable accessibilityRole="button" onPress={() => setDraft(group.name)} style={styles.flex}>
          <Text style={styles.groupName}>
            {group.name}
            {count > 0 ? <Text style={styles.groupCount}>{`  ${count}`}</Text> : null}
          </Text>
        </Pressable>
      ) : (
        <TextInput
          style={[styles.input, styles.flex, styles.groupInput]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          onBlur={commit}
          autoFocus
          returnKeyType="done"
          accessibilityLabel="グループの名前"
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${group.name}を削除`}
        onPress={onDelete}
        hitSlop={6}
        style={styles.iconButton}
      >
        <Trash2 size={16} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

/**
 * 未分類の見出し。押すと名前を付けられる。未分類はグループの行を持たないので、
 * 名前を付けるとその名前のグループができ、未分類の項目はそこへ移る。
 */
export function UngroupedHeader({ onName }: { onName: (name: string) => void }) {
  // null のあいだは読むだけの見出し。書き始めは空にして、例を出しておく。
  const { draft, setDraft, commit } = useDraftField((value) => {
    const name = value.trim();
    if (!name) return false;
    onName(name);
    return true;
  });

  return (
    <View style={styles.groupHeader}>
      {draft === null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="未分類に名前を付ける"
          onPress={() => setDraft('')}
          style={styles.flex}
        >
          <Text style={[styles.groupName, styles.ungroupedName]}>未分類</Text>
        </Pressable>
      ) : (
        <TextInput
          style={[styles.input, styles.flex, styles.groupInput]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          onBlur={commit}
          autoFocus
          returnKeyType="done"
          placeholder="グループの名前（例: イオン）"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="グループの名前"
        />
      )}
    </View>
  );
}

/** 「+ ○○」の行。押すと入力欄が開く。 */
function AddButton({
  label,
  onPress,
  tone = 'plain',
  divided = false,
}: {
  label: string;
  onPress: () => void;
  /** 枠そのものを足す行は、項目の追加と見分けられるよう破線にする。 */
  tone?: 'plain' | 'outlined';
  /** 上に項目が並んでいるときは、線を引いて区切る。 */
  divided?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.addButton, tone === 'outlined' ? styles.outlined : divided && styles.divided]}
    >
      <Plus size={16} color={colors.textFaint} />
      <Text style={styles.addLabel}>{label}</Text>
    </Pressable>
  );
}

/** 枠（グループ）の末尾の「+ 追加」。押すと、その枠の末尾に新しい項目の入力欄が開く。 */
export function AddItemButton({ onPress, divided }: { onPress: () => void; divided?: boolean }) {
  return <AddButton label="追加" onPress={onPress} divided={divided} />;
}

/**
 * 項目の入力欄（まだ保存していない新しい行）。改行で確定して、続けて次を打てる
 * （Google Keepと同じ動き）。確定した項目は呼び出し側が足し、この欄はその下へ移る。
 * 追加ボタンは無い。入力を終えて他へ触れたとき・編集モードを閉じたときにも、
 * 書きかけがあれば足す（空のまま閉じたときは何も足さない）。
 * 改行だけを続けて押すと空の項目が入る（空行を挟んで見出しのように使える）。
 */
export function NewItemRow({
  onSubmit,
  onDone,
  divided,
}: {
  onSubmit: (title: string) => void;
  /** 欄を閉じるとき。 */
  onDone: () => void;
  divided?: boolean;
}) {
  const { draft, setDraft, commit } = useDraftField((value) => {
    const title = value.trim();
    if (title) onSubmit(title);
    onDone();
    return title !== '';
  }, '');

  if (draft === null) return null;

  return (
    <View style={[styles.itemRow, styles.itemRowWithGrip, divided && styles.divided]}>
      {/* 他の行と文字の位置をそろえる（持ち手とチェックの場所を空けておく）。 */}
      <View style={styles.gripSpacer} />
      <View style={[styles.check, styles.checkPending]} />
      <TextInput
        style={[styles.input, styles.flex]}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => {
          onSubmit(draft.trim());
          setDraft('');
        }}
        onBlur={commit}
        autoFocus
        blurOnSubmit={false}
        returnKeyType="done"
        accessibilityLabel="新しい項目の内容"
      />
      {/* 行の右端の×と幅をそろえる。 */}
      <View style={styles.iconSpacer} />
    </View>
  );
}

/**
 * 枠（グループ）を足す行。押すまではただの「+ ○○」の行で、押すと入力欄になる。
 * 改行で確定しても欄は開いたままにするので、続けて打てる。追加ボタンは無く、
 * 入力を終えて他へ触れたとき・編集モードを閉じたときにも、書きかけがあれば足す。
 */
export function AddRow({
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

  if (draft === null) return <AddButton label={label} tone="outlined" onPress={() => setDraft('')} />;

  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    onSubmit(name);
    setDraft('');
  };

  return (
    <View style={styles.outlined}>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          onBlur={commit}
          autoFocus
          blurOnSubmit={false}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.navActive, borderColor: colors.navActive },
  // まだ保存していない行の丸。押せないので薄くしておく。
  checkPending: { borderColor: colors.border },
  divided: { borderTopWidth: 1, borderTopColor: colors.background },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 10,
  },
  itemRowWithGrip: { paddingLeft: 0 },
  grip: { width: 32, alignSelf: 'stretch', marginVertical: -10, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 16, color: colors.text, minHeight: 22 },
  itemTitleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  iconButton: { padding: 6 },
  gripSpacer: { width: 32 },
  // ×（16px＋左右の余白6px×2）と同じ幅。
  iconSpacer: { width: 28 },

  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 8,
    backgroundColor: colors.neutralSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupHeaderWithGrip: { paddingLeft: 0 },
  groupName: { fontSize: 15, fontWeight: '700', color: colors.text },
  groupCount: { fontWeight: '400', color: colors.textFaint },
  ungroupedName: { color: colors.text },
  groupInput: { paddingVertical: 4 },

  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: colors.textSubtle,
    backgroundColor: colors.surface,
  },

  addButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  addLabel: { fontSize: 16, color: colors.textFaint },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 12,
    paddingVertical: 6,
  },
  outlined: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 12,
    justifyContent: 'center',
  },
});
