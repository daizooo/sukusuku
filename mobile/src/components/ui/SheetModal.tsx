import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';

// 入力画面の外枠。PWA版と同じく、画面いっぱいにはせず
// 「暗くした画面の上に、下から浮かぶ枠」にする。
//
// PWA版の作り（`src/components/sukusuku/modals/logModalParts.tsx` ほか）:
//   <div className="absolute inset-0 bg-black/50 flex items-end justify-center pt-4 sm:p-4">
//     <div className="bg-white w-full max-w-md rounded-t-2xl shadow-xl flex flex-col">
// 暗くするのは画面の上の帯（アプリの色で塗ってある部分）より下だけ。PWA版も
// safe-area のぶんは覆わないため、同じ見え方にそろえている。
// 暗い部分を押すと、戻る操作と同じく閉じる（onClose）。

interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * 枠の高さ。渡さなければ SHEET_HEIGHT。どの枠も同じ高さで開く（中身の量で伸び縮みしない）。
   * 画面に入りきらない端末では、枠のほうが縮む（中身がスクロールする）。
   */
  height?: number;
  children: ReactNode;
}

/** 枠の高さ。PWA版の `SHEET_SIZE`（src/components/sukusuku/ui/sheetSize.ts）と同じ。 */
export const SHEET_HEIGHT = 720;

/** PWA版の枠の横幅（Tailwindの max-w-md）。 */
const SHEET_MAX_WIDTH = 448;

/** PWA版の枠の上の余白（Tailwindの pt-4）。左右・下は画面の端に接するので余白なし（広い画面は maxWidth で止める）。 */
const SHEET_GAP = 16;

export default function SheetModal({ visible, onClose, height = SHEET_HEIGHT, children }: SheetModalProps) {
  const insets = useSafeAreaInsets();

  // PWA版は枠がそのまま出る（動きを付けていない）ので、暗い部分ごと薄く出す。
  // transparent と slide を組み合わせると、暗い部分まで下から流れてきて別物に見える。
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        // Androidも指定しないと、Modal（別ウィンドウで開く）の中はOSのwindowSoftInputMode
        // が効かず、キーボードが出てもメモ欄などの入力欄が隠れたままになる。
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        {...swipeBoundary}
      >
        <Pressable
          accessibilityLabel="閉じる"
          onPress={onClose}
          style={[styles.backdrop, { top: insets.top }]}
        />
        <View
          style={[
            styles.container,
            { paddingTop: insets.top + SHEET_GAP },
          ]}
          pointerEvents="box-none"
        >
          {/* 横幅いっぱいで、下は画面の端に接する。下の操作バーのぶんは、枠の中の余白で空ける。 */}
          <View style={[styles.sheet, { height }]}>
            {children}
            <View style={{ height: insets.bottom }} />
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
    justifyContent: 'flex-end',
    alignItems: 'center',
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
