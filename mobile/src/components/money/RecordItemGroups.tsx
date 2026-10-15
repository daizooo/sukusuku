import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { editorGroupTotal, editorLineAmount, formatBalance, formatYen, isBlankLine, type EditorGroup } from '@/lib/moneyUtils';
import { CategoryIcon } from '@/components/money/moneyVisual';

// 記録のカテゴリごとの品目（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/RecordItemGroups.tsx` と同じ並び・文言。
// 記録の詳細（読むだけ）と編集の両方で同じ書き方にする（2026-10-15）。
// カテゴリの行（アイコン・カテゴリ名・小計）の下に、品目を1行ずつ（品名・個数 × 単価・金額）。品目が1つでも複数でも同じ。
// 小計は黒、品目の金額は灰色（合計とのメリハリ）。onOpen があれば、カテゴリのまとまりを押せる（編集で品目の画面を開く）。

interface RecordItemGroupsProps {
  groups: EditorGroup[];
  /** カテゴリの見出し（「食費 › 食料品」）。 */
  title: (group: EditorGroup) => string;
  /** カテゴリのアイコンの key。 */
  iconKey: (group: EditorGroup) => string;
  /** large は詳細、small は編集（文字を一回り小さく）。 */
  size: 'large' | 'small';
  onOpen?: (group: EditorGroup) => void;
}

export default function RecordItemGroups({ groups, title, iconKey, size, onOpen }: RecordItemGroupsProps) {
  const large = size === 'large';
  return (
    <>
      {groups.map((group) => {
        const lines = group.lines.filter((line) => !isBlankLine(line));
        const content = (
          <>
            <View style={styles.icon}>
              <CategoryIcon iconKey={iconKey(group)} size={large ? 30 : 24} />
            </View>
            <View style={styles.main}>
              <View style={styles.top}>
                <Text style={[styles.path, large && styles.pathLarge]} numberOfLines={1}>
                  {title(group)}
                </Text>
                <Text style={[styles.total, large && styles.totalLarge]}>{formatBalance(editorGroupTotal(group))}</Text>
              </View>
              {lines.map((line) => (
                <View key={line.key} style={styles.line}>
                  <Text style={[styles.name, large && styles.nameLarge, line.name.trim() === '' && styles.noName]} numberOfLines={1}>
                    {line.name.trim() !== '' ? line.name.trim() : '品名なし'}
                  </Text>
                  {line.quantity > 1 && (
                    <Text style={[styles.unit, large && styles.unitLarge]}>
                      {formatYen(Math.abs(line.unitPrice))} × {line.quantity}
                    </Text>
                  )}
                  <Text style={[styles.amount, large && styles.amountLarge]}>{formatBalance(editorLineAmount(line))}</Text>
                </View>
              ))}
            </View>
          </>
        );
        return onOpen ? (
          <Pressable
            key={group.key}
            accessibilityRole="button"
            onPress={() => onOpen(group)}
            style={({ pressed }) => [styles.group, large && styles.groupLarge, pressed && styles.pressed]}
          >
            {content}
          </Pressable>
        ) : (
          <View key={group.key} style={[styles.group, large && styles.groupLarge]}>
            {content}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  groupLarge: { gap: 14, paddingTop: 12, paddingBottom: 10 },
  pressed: { backgroundColor: colors.background },
  icon: { marginTop: 1 },
  main: { flex: 1, minWidth: 0 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  // カテゴリ名は灰色、小計は黒（品目の金額より濃く）。数字を出す Text には fontWeight を必ず付ける（CLAUDE.md）。
  path: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.textMuted },
  pathLarge: { fontSize: 14, color: colors.textSubtle },
  total: { fontSize: 14, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  totalLarge: { fontSize: 16 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: 3 },
  name: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.textSubtle },
  nameLarge: { fontSize: 13 },
  noName: { color: colors.textFaint },
  unit: { fontSize: 10, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  unitLarge: { fontSize: 11 },
  amount: { fontSize: 12, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  amountLarge: { fontSize: 14 },
});
