import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Plus, Trash2, X } from 'lucide-react-native';
import type { ListGroup, ListItem } from '@/types/app';
import { colors } from '@/lib/theme';

// リストの中の行。Web版の `src/components/sukusuku/tabs/ListTab.tsx` の中にある
// ItemCheck / ItemRow / GroupHeader / AddRow を、そのまま置き換えたもの。

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

/**
 * 項目の行。押すとその場で入力欄になり、枠の中で書き換える
 * （Keepと同じで、項目のためだけの画面は出さない）。持っているのは内容だけ。
 */
export function ItemRow({
  item,
  onToggle,
  onRename,
  onDelete,
  divided,
}: {
  item: ListItem;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  /** 上に行があるときは、線を引いて区切る。 */
  divided?: boolean;
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
    <View style={[styles.itemRow, divided && styles.divided]}>
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
          onSubmitEditing={() => close(draft)}
          onBlur={() => close(draft)}
          autoFocus
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
}: {
  group: ListGroup;
  count: number;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  // null のあいだは読むだけの見出し。押すと書きかけを持って入力欄になる。
  const [draft, setDraft] = useState<string | null>(null);

  const close = (value: string) => {
    const name = value.trim();
    if (name && name !== group.name) onRename(name);
    setDraft(null);
  };

  return (
    <View style={styles.groupHeader}>
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
          onSubmitEditing={() => close(draft)}
          onBlur={() => close(draft)}
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
 * 押すまではただの「+ ○○」の行で、押すと入力欄になる。
 * 確定しても欄は開いたままにするので、思いついたものを続けて打てる
 * （Google Keepと同じ動き）。項目の追加にも枠の追加にも使う。
 */
export function AddRow({
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

  if (draft === null) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setDraft('')}
        style={[
          styles.addButton,
          tone === 'outlined' ? styles.outlined : divided && styles.divided,
        ]}
      >
        <Plus size={16} color={colors.textFaint} />
        <Text style={styles.addLabel}>{label}</Text>
      </Pressable>
    );
  }

  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    onSubmit(value);
    setDraft('');
  };

  return (
    <View
      style={[styles.addRow, tone === 'outlined' ? styles.outlined : divided && styles.divided]}
    >
      <TextInput
        style={[styles.input, styles.flex]}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={submit}
        // 打ち終わって他へ触れたときは、書きかけが無ければ欄を畳む。
        onBlur={() => setDraft((prev) => (prev && prev.trim() ? prev : null))}
        autoFocus
        blurOnSubmit={false}
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
      />
      <Pressable
        accessibilityRole="button"
        disabled={draft.trim() === ''}
        onPress={submit}
        style={styles.addSubmit}
      >
        <Text style={[styles.addSubmitText, draft.trim() === '' && styles.addSubmitDisabled]}>
          追加
        </Text>
      </Pressable>
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
  divided: { borderTopWidth: 1, borderTopColor: colors.background },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 10,
  },
  itemTitle: { fontSize: 14, color: colors.textSubtle },
  itemTitleDone: { color: colors.textFaint, textDecorationLine: 'line-through' },
  iconButton: { padding: 6 },

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
  groupName: { fontSize: 13, fontWeight: '700', color: colors.text },
  groupCount: { fontWeight: '400', color: colors.textFaint },
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
  addLabel: { fontSize: 14, color: colors.textFaint, flexShrink: 1 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 6,
  },
  outlined: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 12,
    justifyContent: 'center',
  },
  addSubmit: { paddingHorizontal: 8, paddingVertical: 8 },
  addSubmitText: { fontSize: 14, fontWeight: '700', color: colors.navActiveText },
  addSubmitDisabled: { color: colors.borderStrong },
});
