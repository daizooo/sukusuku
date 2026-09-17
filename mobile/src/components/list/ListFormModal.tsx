import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Trash2, X } from 'lucide-react-native';
import type { ListBoard, ListGroup } from '@/types/app';
import { colors } from '@/lib/theme';

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
}

export const DEFAULT_GROUP_LABEL = 'グループ';

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
      ? { name: list.name, groupLabel: list.groupLabel }
      : { name: '', groupLabel: DEFAULT_GROUP_LABEL },
  );

  const set = (patch: Partial<ListDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const canSubmit = draft.name.trim() !== '';

  return (
    <Modal visible={mode !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {mode === 'add' ? 'リストを追加' : 'リストの設定'}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={12}>
            <X size={20} color={colors.textFaint} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
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
