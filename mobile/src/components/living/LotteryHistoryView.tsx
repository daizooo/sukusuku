import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SubsidyDraw } from '@/types/app';
import { colors } from '@/lib/theme';
import { ballOf, formatMonth, groupByMonth } from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import LotteryBall from '@/components/living/LotteryBall';

// 補助くじの「履歴」の面（docs/home.md §9）。PWA版の
// `src/components/sukusuku/living/LotteryHistoryView.tsx` と同じ項目・並び・文言。
// アカウント（家族）ごとに、過去のくじを月ごとに見る。家計の合計は出さない。

interface LotteryHistoryViewProps {
  draws: SubsidyDraw[];
  /** アカウントを持つ家族。 */
  members: { id: string; name: string }[];
  myId: string;
  isLoading: boolean;
  now: Date;
}

export default function LotteryHistoryView({ draws, members, myId, isLoading, now }: LotteryHistoryViewProps) {
  const [selected, setSelected] = useState(myId);
  const shown = draws.filter((draw) => draw.drawnBy === selected);
  const groups = groupByMonth(shown);

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        {members.map((member) => {
          const isSelected = member.id === selected;
          return (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => setSelected(member.id)}
              style={[styles.chip, isSelected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {member.id === myId ? `${member.name}（自分）` : member.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
      ) : shown.length === 0 ? (
        <View style={[styles.centered, styles.flex]}>
          <Text style={styles.message}>まだ引いていません</Text>
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
          {groups.map((group) => (
            <View key={group.month} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{formatMonth(group.month, now)}</Text>
                <Text style={styles.groupCount}>{group.draws.length}回</Text>
              </View>
              <View style={styles.list}>
                {group.draws.map((draw, index) => {
                  const date = new Date(draw.drawnAt);
                  const ball = ballOf(draw.ball);
                  return (
                    <View key={draw.id} style={[styles.row, index > 0 && styles.rowDivided]}>
                      <LotteryBall ball={draw.ball} size={28} />
                      <View style={styles.flex}>
                        <Text style={styles.name} numberOfLines={1}>
                          {draw.itemName || '（名前なし）'}
                        </Text>
                        <Text style={styles.sub}>
                          {date.getMonth() + 1}/{date.getDate()}・税込 {formatPrice(draw.price)}・{ball.name}
                          {draw.rateUpUsed ? '・アップ券' : ''}
                        </Text>
                      </View>
                      <View style={styles.right}>
                        <Text style={styles.rate}>{draw.rate}%</Text>
                        <Text style={styles.subsidy}>{draw.rate === 100 ? '全額' : formatPrice(draw.subsidy)}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  chipScroll: { flexGrow: 0 },
  chips: { gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.neutralSurface },
  chipSelected: { backgroundColor: colors.navActive },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextSelected: { color: colors.primaryText },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  group: { gap: 4 },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  groupCount: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2, fontVariant: ['tabular-nums'] },
  right: { alignItems: 'flex-end' },
  rate: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  subsidy: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
