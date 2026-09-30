import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, Pin, PinOff, Trash2, Users } from 'lucide-react-native';
import type { ListBoard } from '@/types/app';
import { colors } from '@/lib/theme';

// リストの編集モード。Google Keepと同じく、一覧でタップしたカードが画面の中央に
// 拡大して開き、見出し・項目・グループ・共有・固定・削除までここで済ませる。
// 以前あった「リストの設定」の画面は無くした（開く手間を減らすため）。
//
// 項目やグループの中身は list.tsx が持つ（長押しの並べ替えが一覧と同じ仕組みを
// 使うため）。ここは外枠・見出し・下の道具列だけを受け持つ。
//
// 見出しは打つたびに保存すると重いので、入力中は手元で持ち、閉じるとき（と入力を
// 終えたとき）にだけ保存する。呼び出し側で対象のリストごとに作り直す前提。

interface ListEditorModalProps {
  list: ListBoard;
  /** 開いた直後に見出しへ入力を移す。新しく作ったリスト用。 */
  focusTitle?: boolean;
  /** 長押しで動かしているあいだは中身のスクロールを止める。 */
  scrollEnabled: boolean;
  /** 見出しを確定する。空のままなら呼ばない。 */
  onRename: (name: string) => void;
  onTogglePin: () => void;
  onToggleShare: () => void;
  onDelete: () => void;
  /** 閉じる。見出しの書きかけがあれば、先に渡してから呼ぶ。 */
  onClose: (draftName: string) => void;
  children: ReactNode;
}

/** 中央のカードの横幅の上限。PWA版と同じく広い画面でも広げすぎない。 */
const CARD_MAX_WIDTH = 448;

/** 画面の端とカードの間の余白。 */
const CARD_GAP = 16;

export default function ListEditorModal({
  list,
  focusTitle = false,
  scrollEnabled,
  onRename,
  onTogglePin,
  onToggleShare,
  onDelete,
  onClose,
  children,
}: ListEditorModalProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(list.name);

  const commitName = () => {
    const next = name.trim();
    // 空のまま確定させると何のリストか分からなくなるため、直前の名前へ戻す。
    if (!next) {
      setName(list.name);
      return;
    }
    if (next !== list.name) onRename(next);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onClose(name)}>
      <KeyboardAvoidingView
        style={styles.overlay}
        // Modalの中はOSのwindowSoftInputModeが効かないため、Androidも指定する（SheetModalと同じ）。
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* 暗い部分を押すと閉じる（Keepと同じ）。カードの外側だけがこの受け口になる。 */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          onPress={() => onClose(name)}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.container,
            { paddingTop: insets.top + CARD_GAP, paddingBottom: insets.bottom + CARD_GAP },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.card}>
            <View style={styles.header}>
              <TextInput
                style={styles.title}
                value={name}
                onChangeText={setName}
                onBlur={commitName}
                onSubmitEditing={commitName}
                autoFocus={focusTitle}
                returnKeyType="done"
                placeholder="タイトル"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="リスト名"
              />
              {/* よく開くリストを一覧の先頭へ固定する（Keepのピン止め）。 */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={list.pinned ? '固定を外す' : '一覧の先頭に固定する'}
                accessibilityState={{ selected: list.pinned }}
                onPress={onTogglePin}
                hitSlop={6}
                style={styles.headerButton}
              >
                {list.pinned ? (
                  <Pin size={18} color={colors.navActiveText} fill={colors.navActiveText} />
                ) : (
                  <PinOff size={18} color={colors.textFaint} />
                )}
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              scrollEnabled={scrollEnabled}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>

            {/* 下の道具列。共有・削除・閉じる。 */}
            <View style={styles.toolbar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  list.isPrivate ? '共有設定: 自分だけ。押すと家族全員に共有する' : '共有設定: 共有中。押すと自分だけにする'
                }
                onPress={onToggleShare}
                hitSlop={6}
                style={[styles.tool, styles.shareTool]}
              >
                {list.isPrivate ? (
                  <Lock size={16} color={colors.textMuted} />
                ) : (
                  <Users size={16} color={colors.navActiveText} />
                )}
                <Text
                  style={[styles.toolText, !list.isPrivate && styles.toolTextOn]}
                  numberOfLines={1}
                >
                  {list.isPrivate ? '自分だけ' : '共有中'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="このリストを削除する"
                onPress={onDelete}
                hitSlop={6}
                style={styles.tool}
              >
                <Trash2 size={16} color={colors.danger} />
              </Pressable>
              <View style={styles.spacer} />
              <Pressable
                accessibilityRole="button"
                onPress={() => onClose(name)}
                hitSlop={6}
                style={styles.tool}
              >
                <Text style={styles.closeText}>閉じる</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: CARD_GAP,
  },
  card: {
    // 中身が少ないうちは内容の高さ。多いときは画面に収まるところまで縮め、中身がスクロールする。
    flexShrink: 1,
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  headerButton: { padding: 8 },
  body: { flexShrink: 1 },
  // 中の枠は上に余白（cardSpaced）を持つので、上だけ空けない。
  bodyContent: { paddingHorizontal: 12, paddingBottom: 12 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  shareTool: { flexShrink: 1 },
  toolText: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  toolTextOn: { color: colors.navActiveText },
  spacer: { flex: 1 },
  closeText: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
});
