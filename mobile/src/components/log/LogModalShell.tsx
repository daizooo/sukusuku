import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { colors } from '@/lib/theme';

// 記録の入力画面の外枠。PWA版の `src/components/sukusuku/modals/logModalParts.tsx` の
// LogModalShell と同じ組み立てにしてある。
//
// - 画面いっぱいではなく、画面の下に浮かぶ枠（SheetModal）の中身として使う
// - 見出しと「閉じる」は上に固定
// - 種類の切り替えなど、選び直しても動いてほしくないものは subheader に置いて固定
// - スクロールするのは中身だけ
// - **保存・削除は下に固定**。入力欄が増えても押す場所が変わらず、
//   長い画面で保存ボタンを探してスクロールする必要が無い

/**
 * 記録の入力の枠の高さ。PWA版の `LOG_MODAL_HEIGHT`（h-[640px] max-h-full）と同じ。
 * 母乳/搾乳/ミルクのように入力項目が入れ替わっても枠が伸び縮みしないよう、
 * どの記録でも同じ高さで開く。画面に入りきらないときは枠のほうが縮む。
 */
export const LOG_SHEET_HEIGHT = 640;

interface LogModalShellProps {
  title: string;
  onClose: () => void;
  /** 見出しの下に固定で置くもの（種類の切り替えなど）。 */
  subheader?: ReactNode;
  /** 下に固定で置くもの（保存・削除）。 */
  footer?: ReactNode;
  children: ReactNode;
}

export default function LogModalShell({
  title,
  onClose,
  subheader,
  footer,
  children,
}: LogModalShellProps) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={12}>
          <X size={20} color={colors.textFaint} />
        </Pressable>
      </View>

      {subheader && <View style={styles.subheader}>{subheader}</View>}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>

      {footer && <View style={styles.footer}>{footer}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  subheader: { paddingHorizontal: 16, paddingTop: 16 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 24 },
  footer: {
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
