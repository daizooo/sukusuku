import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildBudgetTiles,
  buildMonthSummary,
  formatSignedYen,
  formatYen,
  iconKeyOf,
  type BudgetTile,
} from '@/lib/moneyUtils';
import { CategoryIcon, Hero, MonthBar, ProgressBar, SectionHeader, StatRow, type } from '@/components/money/moneyVisual';

// 家計タブの「月」（docs/kakei.md §4.1）。PWA版の `src/components/sukusuku/money/MoneyMonthView.tsx` と同じ並び・文言。
//
// 結論は月の収支（収入 − 生活費 − 貯金）。内訳に収入・生活費（予算との差）・貯金。
// 特別費はここに出さない（「特別費」の面だけで見る。2026-10-07に決定）。
// その下に生活費の大分類を小さな一覧で（アイコン・超えた額／残り額・使った割合の帯）、予算を超えた順に。
// 行を押すと開く「要因」・月のメモ・カードの締めは docs/kakei.md §7 の3 で足す。

interface MoneyMonthViewProps {
  monthKey: string;
  onMonth: (monthKey: string) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  onEditCategories: () => void;
}

export default function MoneyMonthView({
  monthKey,
  onMonth,
  records,
  categories,
  budgets,
  wallets,
  onEditCategories,
}: MoneyMonthViewProps) {
  const summary = useMemo(
    () => buildMonthSummary(records, categories, budgets, wallets, monthKey),
    [records, categories, budgets, wallets, monthKey],
  );
  const tiles = useMemo(() => buildBudgetTiles(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  const livingDiff = summary.livingBudget - summary.living;

  return (
    <View style={styles.flex}>
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Hero
          label="月の収支"
          value={formatSignedYen(summary.balance)}
          minus={summary.balance < 0}
          note={`予算どおりなら ${formatSignedYen(summary.plannedBalance)}`}
        >
          <StatRow label="収入" value={`+${formatYen(summary.income)}`} />
          <StatRow
            label="生活費"
            note={`予算 ${formatYen(summary.livingBudget)}（${livingDiff < 0 ? `${formatYen(livingDiff)} 超過` : `残り ${formatYen(livingDiff)}`}）`}
            noteMinus={livingDiff < 0}
            value={`−${formatYen(summary.living)}`}
          />
          <StatRow
            label="貯金"
            note={summary.savingTarget > 0 ? `目標 ${formatYen(summary.savingTarget)}` : undefined}
            value={`−${formatYen(summary.saving)}`}
          />
        </Hero>

        <SectionHeader
          title="生活費"
          hint="予算を超えた順"
          right={
            <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={8}>
              <Text style={type.link}>種類と予算</Text>
            </Pressable>
          }
        />
        {tiles.length === 0 ? (
          <Text style={styles.message}>「種類と予算」で種類と月の予算を決めると、ここに予算との差が出ます</Text>
        ) : (
          <View style={styles.card}>
            {tiles.map((tile, index) => (
              <CategoryRow key={tile.category.id} tile={tile} divided={index > 0} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・超えた額／残り額、使った割合の帯、実績 / 予算。 */
function CategoryRow({ tile, divided }: { tile: BudgetTile; divided: boolean }) {
  const over = tile.budget !== null && tile.diff < 0;
  const quiet = tile.budget === null || tile.diff === 0;
  const headline =
    tile.budget === null
      ? '予算なし'
      : tile.diff < 0
        ? `${formatYen(tile.diff)} 超過`
        : tile.diff === 0
          ? '予算どおり'
          : `残り ${formatYen(tile.diff)}`;
  return (
    <View style={[styles.row, divided && styles.rowDivided]}>
      <CategoryIcon iconKey={iconKeyOf(tile.category)} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            {tile.category.name}
          </Text>
          <Text style={[styles.rowHeadline, over && type.minus, quiet && styles.muted]}>{headline}</Text>
        </View>
        <ProgressBar ratio={tile.budget ? tile.actual / tile.budget : 0} over={over} />
        <Text style={type.faint}>
          {formatYen(tile.actual)}
          {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
          {tile.percent !== null ? `・${tile.percent}%` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  rowHeadline: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { color: colors.textFaint },
});
