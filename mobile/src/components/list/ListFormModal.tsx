import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Lock, Trash2, X } from 'lucide-react-native';
import type { ListBoard, ListGroup } from '@/types/app';
import { colors } from '@/lib/theme';
import SheetModal from '@/components/ui/SheetModal';

// リストそのものの追加・編集。Web版の
// `src/components/sukusuku/modals/ListFormModal.tsx` を置き換えたもの。
//
// 束ねる区切りの呼び名はリストごとに変えられるようにしていたが、リストによって
// 「お店を追加」「ジャンルを追加」と文言が変わるのが読みにくかったため、
// 画面では「グループ」で統一する。groupLabel は保存済みの値をそのまま持ち回るだけで、
// 画面には出さない（docs/lists.md §3 からの変更点）。

export interface ListDraft {
  name: string;
  groupLabel: string;
  /** 自分だけのリストか。新しく作るときの既定は「自分だけ」。 */
  isPrivate: boolean;
}

export const DEFAULT_GROUP_LABEL = 'グループ';

/**
 * 共有設定の2択。予定（TaskForm）と同じ文言・同じ並びにする。
 * 新しいリストの既定は「自分だけ」で、家族に見せたいものだけ共有へ切り替える。
 */
const SHARING_TABS: { value: boolean; label: string }[] = [
  { value: false, label: '共有（家族全員）' },
  { value: true, label: '自分だけ' },
];

// リスト名に添える絵文字の候補。名前は自由入力なので絵文字を打ち込めば入るが、
// 探して打つのは手間なので、よく使うものをタップで足せるようにする。
const NAME_EMOJIS = ['🛒', '🧺', '📝', '✅', '🎁', '🏥', '🍼', '👶', '🧴', '💡'];

interface ListFormModalProps {
  mode: 'add' | 'edit' | null;
  list: ListBoard | null;
  /** 編集中のリストのグループ。ここで名前を直したり消したりできる。 */
  groups?: ListGroup[];
  onClose: () => void;
  onSubmit: (draft: ListDraft) => void;
  onDelete?: (id: string) => void;
  onRenameGroup?: (id: string, name: string) => void;
  onDeleteGroup?: (group: ListGroup) => void;
}

/**
 * グループ1件の行。名前は打つたびに保存すると重いので、入力中は手元で持ち、
 * 入力を終えた（focusが外れた）ときにだけ保存する。
 */
function GroupRow({
  group,
  onRename,
  onDelete,
}: {
  group: ListGroup;
  onRename: (id: string, name: string) => void;
  onDelete: (group: ListGroup) => void;
}) {
  const [name, setName] = useState(group.name);

  const commit = () => {
    const next = name.trim();
    // 空のまま確定させると、どのお店だったのか分からなくなるため元に戻す。
    if (!next) {
      setName(group.name);
      return;
    }
    if (next !== group.name) onRename(group.id, next);
  };

  return (
    <View style={styles.groupRow}>
      <TextInput
        style={[styles.input, styles.flex]}
        value={name}
        onChangeText={setName}
        onBlur={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${group.name}を削除`}
        onPress={() => onDelete(group)}
        style={styles.iconButton}
      >
        <Trash2 size={16} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

// 呼び出し側で対象が変わるたびに作り直す前提（初期値をそのとき計算するため）。
export default function ListFormModal({
  mode,
  list,
  groups = [],
  onClose,
  onSubmit,
  onDelete,
  onRenameGroup,
  onDeleteGroup,
}: ListFormModalProps) {
  const [draft, setDraft] = useState<ListDraft>(() =>
    mode === 'edit' && list
      ? { name: list.name, groupLabel: list.groupLabel, isPrivate: list.isPrivate }
      : { name: '', groupLabel: DEFAULT_GROUP_LABEL, isPrivate: true },
  );

  const set = (patch: Partial<ListDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const canSubmit = draft.name.trim() !== '';

  return (
    <SheetModal visible={mode !== null} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {mode === 'add' ? 'リストを追加' : 'リストの設定'}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={12}>
          <X size={20} color={colors.textFaint} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={styles.label}>
            リスト名 <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => set({ name })}
            placeholder="例: 買い出し🛒 / やりたいこと / やること"
            placeholderTextColor={colors.textFaint}
          />
          <View style={styles.emojiRow}>
            {NAME_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`${emoji}を名前に足す`}
                onPress={() => set({ name: draft.name + emoji })}
                style={styles.emoji}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            絵文字は名前の末尾に足されます。自分で打ち込んでも構いません。
          </Text>
        </View>

        {/* 共有設定。自分だけにすると、家族の他のメンバーにはリストごと（中の項目も）
            表示されなくなる。予定の共有設定と同じ2択・同じ文言にしてある。 */}
        <View>
          <View style={styles.shareLabel}>
            <Lock size={12} color={colors.textFaint} />
            <Text style={styles.label}>共有設定</Text>
          </View>
          <View style={styles.switcher}>
            {SHARING_TABS.map((tab) => {
              const selected = draft.isPrivate === tab.value;
              return (
                <Pressable
                  key={String(tab.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => set({ isPrivate: tab.value })}
                  style={[styles.switcherTab, selected && styles.switcherTabOn]}
                >
                  <Text style={[styles.switcherText, selected && styles.switcherTextOn]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>
            「自分だけ」にすると、このリストと中の項目は自分にしか表示されません。
          </Text>
        </View>

        {/* 枠のゴミ箱からも消せるが、名前を直せるのはここだけなので一覧を置く。 */}
        {mode === 'edit' && groups.length > 0 && onRenameGroup && onDeleteGroup && (
          <View>
            <Text style={styles.label}>グループの一覧</Text>
            <View style={styles.groupList}>
              {groups.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  onRename={onRenameGroup}
                  onDelete={onDeleteGroup}
                />
              ))}
            </View>
            <Text style={styles.hint}>
              名前は入力を終えると保存されます。消しても中の項目は「未分類」に残ります。
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={() =>
            onSubmit({ ...draft, groupLabel: draft.groupLabel.trim() || DEFAULT_GROUP_LABEL })
          }
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
        >
          <Text style={styles.submitText}>{mode === 'add' ? '追加する' : '保存する'}</Text>
        </Pressable>
        {mode === 'edit' && list && onDelete && (
          <Pressable
            accessibilityRole="button"
            onPress={() => onDelete(list.id)}
            style={styles.deleteButton}
          >
            <Trash2 size={14} color={colors.danger} />
            <Text style={styles.deleteText}>このリストを削除する</Text>
          </Pressable>
        )}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  // 中身が多いときだけ縮めてスクロールさせる（flex: 1 にすると中身が少なくても枠が伸びる）。
  scroll: { flexShrink: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  content: { paddingHorizontal: 20, paddingVertical: 16, gap: 20 },
  label: { fontSize: 12, fontWeight: '500', color: colors.textSubtle, marginBottom: 4 },
  shareLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  switcher: {
    flexDirection: 'row',
    backgroundColor: colors.neutralSurface,
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  switcherTab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 6 },
  switcherTabOn: { backgroundColor: colors.surface },
  switcherText: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  switcherTextOn: { color: colors.navActiveText },
  required: { color: colors.danger },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textSubtle,
    backgroundColor: colors.surface,
  },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  emoji: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 16 },
  hint: { fontSize: 10, color: colors.textFaint, marginTop: 6, lineHeight: 15 },
  groupList: { gap: 8 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { padding: 8 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  submit: {
    backgroundColor: colors.navActive,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: colors.borderStrong },
  submitText: { fontSize: 15, fontWeight: '500', color: colors.primaryText },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    marginTop: 4,
  },
  deleteText: { fontSize: 12, fontWeight: '500', color: colors.danger },
});
