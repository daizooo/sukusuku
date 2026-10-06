import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '@/lib/theme';

// 補助くじの「テストモード」の切り替えと、テストデータの削除（docs/home.md §9）。PWA版の
// `src/components/sukusuku/living/LotteryTestBar.tsx` と同じ項目・文言。
// 動作確認のために引いたくじ・券を、本物と分けて持ち、確認が済んだらまとめて消す。ヘルプの枠の下に置く。

interface LotteryTestBarProps {
  testMode: boolean;
  onToggle: (value: boolean) => void;
  /** 消せるテストのくじ・券の件数（0なら削除ボタンは押せない）。 */
  testCount: number;
  onDelete: () => void;
  isDeleting: boolean;
}

export default function LotteryTestBar({ testMode, onToggle, testCount, onDelete, isDeleting }: LotteryTestBarProps) {
  const canDelete = testCount > 0 && !isDeleting;
  return (
    <View style={[styles.bar, testMode && styles.barOn]}>
      <View style={styles.row}>
        <View style={styles.texts}>
          <Text style={[styles.title, testMode && styles.titleOn]}>テストモード</Text>
          <Text style={styles.sub}>
            {testMode
              ? 'テスト中。回数・履歴・券は本物と別で、あとで消せます'
              : '動作確認用。ONで引いても、本物の回数や履歴に残りません'}
          </Text>
        </View>
        <Switch value={testMode} onValueChange={onToggle} accessibilityLabel="テストモード" />
      </View>
      {testMode && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canDelete }}
          disabled={!canDelete}
          onPress={onDelete}
          style={[styles.deleteButton, !canDelete && styles.deleteButtonDisabled]}
        >
          <Text style={styles.deleteText}>
            {isDeleting ? '削除中…' : `テストデータを削除（${testCount}件）`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  barOn: { backgroundColor: colors.milkBadge, borderColor: colors.milkMark },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 13, fontWeight: '700', color: colors.text },
  titleOn: { color: colors.milkBadgeText },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textSubtle },
  deleteButton: { alignItems: 'center', borderRadius: 10, paddingVertical: 8, backgroundColor: colors.danger },
  deleteButtonDisabled: { backgroundColor: colors.borderStrong },
  deleteText: { fontSize: 13, fontWeight: '700', color: colors.primaryText },
});
