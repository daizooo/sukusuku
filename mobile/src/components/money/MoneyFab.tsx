import { Pressable, StyleSheet, View } from 'react-native';
import { Plus, Settings } from 'lucide-react-native';
import { colors } from '@/lib/theme';

/**
 * 家計タブ右下の、大きな丸い＋と、その上の小さな丸い設定のボタン（docs/kakei.md §2）。
 * ＋は押すとすぐ記録の入力を開く。設定も1回で開く（2026-10-20。以前は＋でメニューを開いてから選ぶ2回の操作だった）。
 * レシートは記録の入力の「レシートから追加」から読む（docs/kakei.md §10）。
 * 福引チャンスは家計と連動していないので、2026-10-13にその他タブへ移した。
 */
export default function MoneyFab({
  addDisabled,
  settingsDisabled,
  onAdd,
  onSettings,
}: {
  addDisabled?: boolean;
  settingsDisabled?: boolean;
  onAdd: () => void;
  onSettings: () => void;
}) {
  return (
    <View style={styles.layer} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="家計の設定"
        onPress={onSettings}
        disabled={settingsDisabled}
        style={({ pressed }) => [styles.mini, pressed && styles.pressed, settingsDisabled && styles.disabled]}
      >
        <Settings size={20} color={colors.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="記録を追加"
        onPress={onAdd}
        disabled={addDisabled}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed, addDisabled && styles.disabled]}
      >
        <Plus size={28} color={colors.primaryText} />
      </Pressable>
    </View>
  );
}

const FAB = 56;
const MINI = 40;

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.money,
    elevation: 8,
  },
  // ＋の上（下の余白16 + ボタン56 + すき間12）に、＋の中心にそろえて置く。
  mini: {
    position: 'absolute',
    right: 16 + (FAB - MINI) / 2,
    bottom: 16 + FAB + 12,
    width: MINI,
    height: MINI,
    borderRadius: MINI / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    elevation: 6,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
});
