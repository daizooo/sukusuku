import { useCallback, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Plus, Settings, Ticket } from 'lucide-react-native';
import { colors } from '@/lib/theme';

/**
 * 家計タブ右下の、1つの大きな丸いボタン（docs/kakei.md §2）。
 * 押すと「記録を追加」「家計の設定」「福引チャンス」の3つが上に開く。
 * 以前は＋と、その左の小さなピル（福引｜設定）に分かれていて押しづらかったので、1つにまとめて大きくした（2026-10-10）。
 * 開いている間は戻る操作で閉じる。暗い部分を押しても閉じる。
 */
export default function MoneyFab({
  addDisabled,
  settingsDisabled,
  onAdd,
  onSettings,
  onLottery,
}: {
  addDisabled?: boolean;
  settingsDisabled?: boolean;
  onAdd: () => void;
  onSettings: () => void;
  onLottery: () => void;
}) {
  const [open, setOpen] = useState(false);

  // 開いている間だけ、戻る操作で閉じる。タブを離れたら閉じておく。
  useFocusEffect(
    useCallback(() => {
      if (!open) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setOpen(false);
        return true;
      });
      return () => {
        subscription.remove();
        setOpen(false);
      };
    }, [open]),
  );

  // 選んだら閉じてから動かす。
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <View style={styles.layer} pointerEvents="box-none">
      {open && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="メニューを閉じる"
          onPress={() => setOpen(false)}
          style={styles.backdrop}
        />
      )}

      {open && (
        <View style={styles.menu} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="福引チャンス"
            onPress={choose(onLottery)}
            style={[styles.item, styles.itemLottery]}
          >
            <Ticket size={24} color={colors.livingLottery} />
            <Text style={[styles.itemText, { color: colors.livingLottery }]}>福引チャンス</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="家計の設定"
            onPress={choose(onSettings)}
            disabled={settingsDisabled}
            style={[styles.item, settingsDisabled && styles.itemDisabled]}
          >
            <Settings size={24} color={colors.textMuted} />
            <Text style={[styles.itemText, { color: colors.text }]}>家計の設定</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="記録を追加"
            onPress={choose(onAdd)}
            disabled={addDisabled}
            style={[styles.item, styles.itemAdd, addDisabled && styles.itemDisabled]}
          >
            <Plus size={24} color={colors.primaryText} />
            <Text style={[styles.itemText, { color: colors.primaryText }]}>記録を追加</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'メニューを閉じる' : 'メニューを開く'}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        {/* 開いている間は45度回して「×」にする。 */}
        <Plus size={32} color={colors.primaryText} style={open ? styles.rotated : undefined} />
      </Pressable>
    </View>
  );
}

const FAB = 64;

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
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
  fabPressed: { opacity: 0.85 },
  rotated: { transform: [{ rotate: '45deg' }] },
  // ボタンの上（下の余白16 + ボタン64 + すき間12）から、右にそろえて積む。
  menu: {
    position: 'absolute',
    right: 16,
    bottom: 16 + FAB + 12,
    alignItems: 'flex-end',
    gap: 12,
  },
  item: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 22,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    elevation: 6,
  },
  itemLottery: { backgroundColor: colors.livingLotterySurface },
  itemAdd: { backgroundColor: colors.money, borderColor: colors.money },
  itemDisabled: { opacity: 0.4 },
  itemText: { fontSize: 17, fontWeight: '700' },
});
