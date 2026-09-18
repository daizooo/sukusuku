import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { colors } from '@/lib/theme';

// 予定の追加・編集・詳細の外枠。Web版の `TaskForm.tsx` の中にある `ModalShell` にあたる。
//
// 見出しと下のボタンは固定し、スクロールするのは中身だけ。
// 保存・完了のボタンが隠れないよう、Web版と同じく下に置いたままにする。

interface TaskModalShellProps {
  show: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

export default function TaskModalShell({
  show,
  title,
  onClose,
  children,
  footer,
}: TaskModalShellProps) {
  return (
    <Modal visible={show} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={12}>
            <X size={20} color={colors.textFaint} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>

        <View style={styles.footer}>{footer}</View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.textSubtle, flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 16 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
