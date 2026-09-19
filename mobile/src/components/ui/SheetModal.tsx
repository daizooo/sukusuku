import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';

// 入力画面の外枠。PWA版と同じく、画面いっぱいにはせず
// 「暗くした画面の上に、下から浮かぶ枠」にする。
//
// PWA版の作り（`src/components/sukusuku/modals/logModalParts.tsx` ほか）:
//   <div className="absolute inset-0 bg-black/50 flex items-end justify-center p-4">
//     <div className="bg-white w-full max-w-md rounded-t-2xl shadow-xl flex flex-col">
// 暗くするのは画面の上の帯（アプリの色で塗ってある部分）より下だけ。PWA版も
// safe-area のぶんは覆わないため、同じ見え方にそろえている。

interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * 枠の高さ。PWA版で高さを決め打ちしている入力（記録の入力＝640px）に合わせるとき渡す。
   * 渡さなければ中身の高さになり、入りきらないぶんは枠のほうが縮む（中身がスクロールする）。
   */
  height?: number;
  children: ReactNode;
}

/** PWA版の枠の横幅（Tailwindの max-w-md）。 */
const SHEET_MAX_WIDTH = 448;

/** PWA版の枠の外側の余白（Tailwindの p-4）。 */
const SHEET_GAP = 16;

export default function SheetModal({ visible, onClose, height, children }: SheetModalProps) {
  const insets = useSafeAreaInsets();

  // PWA版は枠がそのまま出る（動きを付けていない）ので、暗い部分ごと薄く出す。
  // transparent と slide を組み合わせると、暗い部分まで下から流れてきて別物に見える。
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.backdrop, { top: insets.top }]} pointerEvents="none" />
        <View
          style={[
            styles.container,
            { paddingTop: insets.top + SHEET_GAP, paddingBottom: insets.bottom + SHEET_GAP },
          ]}
          pointerEvents="box-none"
        >
          <View style={[styles.sheet, height !== undefined && { height }]}>{children}</View>
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
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: SHEET_GAP,
  },
  sheet: {
    // 中身が多いときは画面に収まるところまで縮める（PWA版の max-h と同じ）。
    flexShrink: 1,
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    // Androidの影。PWA版の shadow-xl にあたる。
    elevation: 8,
  },
});
