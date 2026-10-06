import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { colors } from '@/lib/theme';

// 補助くじの、画面の中央に出す枠（docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryDialog.tsx` と同じ組み立て。
// 賞品一覧・券・履歴・ヘルプ・くじの結果に使う。戻る操作・枠の外を押すと閉じる。

interface LotteryDialogProps {
  /** 見出し。無ければ見出しの帯を出さない（くじの結果）。 */
  title?: string;
  onClose: () => void;
  /** 中身の高さを画面に合わせて決め打ちにする（中身が自分でスクロールする券・履歴）。 */
  fill?: boolean;
  /** 下に固定で置くもの。 */
  footer?: ReactNode;
  children: ReactNode;
}

export default function LotteryDialog({ title, onClose, fill, footer, children }: LotteryDialogProps) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="閉じる" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, fill && styles.cardFill]}>
          {title !== undefined && (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={12}>
                <X size={20} color={colors.textFaint} />
              </Pressable>
            </View>
          )}
          <View style={fill ? styles.bodyFill : styles.body}>{children}</View>
          {footer && <View style={styles.footer}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardFill: { height: '80%' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { flexShrink: 1 },
  bodyFill: { flex: 1, paddingTop: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
});
