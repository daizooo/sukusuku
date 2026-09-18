import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';

// 記録の入力画面の外枠。PWA版の `src/components/sukusuku/modals/logModalParts.tsx` の
// LogModalShell と同じ組み立てにしてある。
//
// - 見出しと「閉じる」は上に固定
// - 種類の切り替えなど、選び直しても動いてほしくないものは subheader に置いて固定
// - スクロールするのは中身だけ
// - **保存・削除は下に固定**。入力欄が増えても押す場所が変わらず、
//   長い画面で保存ボタンを探してスクロールする必要が無い

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
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>閉じる</Text>
        </Pressable>
      </View>

      {subheader && <View style={styles.subheader}>{subheader}</View>}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>

      {footer && <View style={styles.footer}>{footer}</View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
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
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 },
  close: { fontSize: 14, color: colors.textMuted },
  subheader: { paddingHorizontal: 16, paddingTop: 16 },
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
