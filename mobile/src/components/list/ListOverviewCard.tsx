import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Lock, Pin, PinOff } from 'lucide-react-native';
import type { ListBoard, ListGroup, ListItem } from '@/types/app';
import { colors } from '@/lib/theme';

// 一覧（Keepのメモ一覧に当たる面）に出す1リストのカード。Web版の
// `ListTab.tsx` の中にある ListOverviewCard を置き換えたもの。
// 中身は読むだけにして、チェックや追加は開いた先で行う（押し間違いを避ける）。

/** 一覧のカードに出す行数。多すぎるとカードが伸びて1画面に収まらない。 */
const OVERVIEW_ROWS = 6;

type OverviewRow =
  | { type: 'group'; key: string; name: string }
  | { type: 'item'; key: string; item: ListItem };

interface ListOverviewCardProps {
  list: ListBoard;
  groups: ListGroup[];
  items: ListItem[];
  onOpen: () => void;
  onTogglePin: () => void;
  /** 長押しで動かすための受け口。位置を測るのと動かすのは、外のマスの側で行う。 */
  holdProps: { onLongPress: () => void; delayLongPress: number };
  dragging: boolean;
}

export default function ListOverviewCard({
  list,
  groups,
  items,
  onOpen,
  onTogglePin,
  holdProps,
  dragging,
}: ListOverviewCardProps) {
  const undone = items.filter((item) => !item.done);
  const rows: OverviewRow[] = [];
  const pushItems = (target: ListItem[]) => {
    target.forEach((item) => rows.push({ type: 'item', key: item.id, item }));
  };

  if (groups.length === 0) {
    pushItems(undone);
  } else {
    groups.forEach((group) => {
      // 中身が無いグループも、どの枠を作ったか分かるよう名前だけ出す。
      rows.push({ type: 'group', key: group.id, name: group.name });
      pushItems(undone.filter((item) => item.groupId === group.id));
    });
    const ungrouped = undone.filter((item) => item.groupId === null);
    if (ungrouped.length > 0) {
      rows.push({ type: 'group', key: `${list.id}-none`, name: '未分類' });
      pushItems(ungrouped);
    }
  }

  const shown = rows.slice(0, OVERVIEW_ROWS);
  const rest = rows.length - shown.length;

  return (
    /* ピンは「開く」の中に入れられないため、カードを枠にして、開く部分と並べて置く。
       長押しはこの枠でつかむ。 */
    <View style={[styles.card, dragging && styles.cardDragging]}>
      <Pressable accessibilityRole="button" onPress={onOpen} {...holdProps}>
        {/* 見出し（リスト名）は帯にして、中身と一目で分かれるようにする。
            自分だけのリストは錠前を添える（予定の一覧と同じ印）。 */}
        <View style={styles.titleRow}>
          {/* 長い名前は今までどおり折り返す（行数は絞らない）。 */}
          <Text style={styles.title}>{list.name}</Text>
          {list.isPrivate && <Lock size={11} color={colors.textFaint} />}
        </View>
        <View style={styles.body}>
          {shown.map((row, index) =>
            row.type === 'group' ? (
              /* グループ名は下線で区切る。どこからどこまでが同じ枠かが線で分かる。 */
              <View key={row.key} style={[styles.groupRow, index > 0 && styles.groupRowSpaced]}>
                <Text numberOfLines={1} style={styles.groupName}>
                  {row.name}
                </Text>
              </View>
            ) : (
              /* 項目どうしは線で区切らない（線が多いと詰まって見える）。 */
              <View key={row.key} style={styles.itemRow}>
                <View style={styles.itemBox} />
                <Text numberOfLines={2} style={styles.itemTitle}>
                  {row.item.title}
                </Text>
              </View>
            ),
          )}
          {rows.length === 0 && <Text style={styles.empty}>項目なし</Text>}
          {rest > 0 && <Text style={styles.rest}>+{rest}件</Text>}
        </View>
      </Pressable>

      {/* よく開くリストを上に固定する（Keepのピン止め）。 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${list.name}の固定を${list.pinned ? '外す' : 'する'}`}
        accessibilityState={{ selected: list.pinned }}
        onPress={onTogglePin}
        hitSlop={6}
        style={styles.pin}
      >
        {list.pinned ? (
          <Pin size={15} color={colors.navActiveText} fill={colors.navActiveText} />
        ) : (
          <PinOff size={15} color={colors.borderStrong} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardDragging: { borderColor: colors.dragBorder, elevation: 8 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    // 右上のピンと重ならないように空けておく。
    paddingRight: 36,
    paddingVertical: 8,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  body: { paddingHorizontal: 12, paddingVertical: 8 },
  groupRow: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 4, marginBottom: 6 },
  groupRowSpaced: { marginTop: 10 },
  groupName: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 3 },
  itemBox: {
    width: 14,
    height: 14,
    marginTop: 3,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  itemTitle: { flex: 1, fontSize: 12, color: colors.textSubtle, lineHeight: 17 },
  empty: { fontSize: 12, color: colors.borderStrong, paddingVertical: 4 },
  rest: { fontSize: 11, color: colors.textFaint, paddingTop: 6, fontWeight: '500' },
  pin: { position: 'absolute', top: 4, right: 4, padding: 6, borderRadius: 999 },
});
