import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { ListBoard } from '@/types/app';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 暮らしタブから送る先の買い出しリストを選ぶ（docs/home.md §4.2）。端末ごとに覚える。
// PWA版の `src/components/sukusuku/modals/ListPickerModal.tsx` と同じ。

interface ListPickerSheetProps {
  lists: ListBoard[];
  selectedId: string | null;
  onClose: () => void;
  onPick: (listId: string) => void;
}

export default function ListPickerSheet({ lists, selectedId, onClose, onPick }: ListPickerSheetProps) {
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell title="送り先のリスト" onClose={onClose}>
        {lists.length === 0 ? (
          <Text style={styles.empty}>リストがまだありません。リストタブで作ってください</Text>
        ) : (
          <View style={styles.card}>
            {lists.map((list, index) => {
              const selected = list.id === selectedId;
              return (
                <Pressable
                  key={list.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onPick(list.id)}
                  style={[styles.row, index > 0 && styles.rowDivided]}
                >
                  <Text style={[styles.name, selected && styles.nameSelected]}>{list.name || '（無題）'}</Text>
                  {selected && <Check size={18} color={colors.navActive} />}
                </Pressable>
              );
            })}
          </View>
        )}
        <Text style={styles.hint}>この端末で覚えます。あとで「送り先」から変えられます</Text>
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  nameSelected: { fontWeight: '700', color: colors.navActiveText },
  empty: { fontSize: 13, fontWeight: '500', color: colors.textMuted, textAlign: 'center', paddingVertical: 16 },
  hint: { fontSize: 11, fontWeight: '500', color: colors.textFaint, textAlign: 'center' },
});
