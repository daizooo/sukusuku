import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import SheetModal from '@/components/ui/SheetModal';

// 予定の追加・編集・詳細の外枠。Web版の `TaskForm.tsx` の中にある `ModalShell` にあたる。
//
// 画面いっぱいにはせず、Web版と同じく画面の下に浮かぶ枠にする（SheetModal）。
// 高さは中身なりで、入りきらないときだけ枠が縮んで中身がスクロールする
// （Web版の `max-h-[90vh]`）。見出しと下のボタンは固定し、保存・完了のボタンは隠れない。
//
// 追加・編集の入力は高さを決め打ちにする（fixedHeight）。予定とタスクで項目の数が違うので、
// 中身なりにすると、切り替えるたびに枠の大きさが変わってしまう（2026-10-13）。詳細の表示は中身なり。

/** 追加・編集の枠の高さ。記録の入力（LOG_SHEET_HEIGHT）と同じ。入りきらない画面では縮む。 */
const FORM_SHEET_HEIGHT = 640;

interface TaskModalShellProps {
  show: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  /** 追加・編集の入力で true。種別の切り替えで枠の大きさが変わらないよう、高さを決め打ちにする。 */
  fixedHeight?: boolean;
}

export default function TaskModalShell({
  show,
  title,
  onClose,
  children,
  footer,
  fixedHeight = false,
}: TaskModalShellProps) {
  return (
    <SheetModal visible={show} onClose={onClose} height={fixedHeight ? FORM_SHEET_HEIGHT : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={12}>
          <X size={20} color={colors.textFaint} />
        </Pressable>
      </View>

      <ScrollView
        style={[styles.scroll, fixedHeight && styles.scrollFill]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>

      <View style={styles.footer}>{footer}</View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  // 中身が多いときだけ縮めてスクロールさせる（flex: 1 にすると中身が少なくても枠が伸びる）。
  scroll: { flexShrink: 1 },
  // 高さを決め打ちにするときは、中身が少なくても余りを埋めて、下のボタンを枠の底に置く。
  scrollFill: { flexGrow: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 16 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
