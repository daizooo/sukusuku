import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet, SpecialActual, SpecialItem } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildSpecialProgress,
  fiscalYearOfMonth,
  formatSignedYen,
  formatYen,
  type BudgetTile,
} from '@/lib/moneyUtils';
import { buildYearRows } from '@/lib/specialUtils';
import { Hero, MonthBar, ProgressBar, SectionHeader, StatRow, UsageRing, type } from '@/components/money/moneyVisual';

// 家計タブの「月」（docs/kakei.md §4.1）。PWA版の `src/components/sukusuku/money/MoneyMonthView.tsx` と同じ並び・文言。
//
// 結論は月の収支（収入 − 生活費 − 貯金）。内訳に収入・生活費（予算との差）・貯金。
// 特別費は月の収支に入れず、1行だけ「今月払った額・年度の予算の残り」を出す（押すと「特別費」へ）。
// その下に生活費の大分類のタイル（使った割合の輪）を予算を超えた順に。
// タイルを押すと開く「要因」・月のメモ・カードの締めは docs/kakei.md §7 の3 で足す。

interface MoneyMonthViewProps {
  monthKey: string;
  onMonth: (monthKey: string) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onEditCategories: () => void;
  onOpenSpecial: () => void;
}

export default function MoneyMonthView({
  monthKey,
  onMonth,
  records,
  categories,
  budgets,
  wallets,
  specialItems,
  specialActuals,
  onEditCategories,
  onOpenSpecial,
}: MoneyMonthViewProps) {
  const summary = useMemo(
    () => buildMonthSummary(records, categories, budgets, wallets, monthKey),
    [records, categories, budgets, wallets, monthKey],
  );
  const tiles = useMemo(() => buildBudgetTiles(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  // 特別費の年度の予算が、この月にどれだけ減ったか（月の収支には入れない）。
  const special = useMemo(
    () =>
      buildSpecialProgress(buildYearRows(specialItems, specialActuals, fiscalYearOfMonth(monthKey), 'expense'), monthKey),
    [specialItems, specialActuals, monthKey],
  );
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="特別費を見る"
          onPress={onOpenSpecial}
          style={({ pressed }) => [styles.special, pressed && styles.pressed]}
        >
          <View style={styles.specialHead}>
            <Text style={styles.specialLabel}>特別費</Text>
            <Text style={type.faint}>月の収支とは別</Text>
            <View style={styles.flex} />
            <Text style={type.amount}>今月 −{formatYen(special.spentThisMonth)}</Text>
            <ChevronRight size={16} color={colors.textFaint} />
          </View>
          <ProgressBar
            ratio={special.yearBudget > 0 ? special.spentToDate / special.yearBudget : 0}
            over={special.remaining < 0}
          />
          <Text style={[type.faint, special.remaining < 0 && type.minus]}>
            年度の予算 {formatYen(special.yearBudget)}・
            {special.remaining < 0 ? `${formatYen(special.remaining)} 超過` : `残り ${formatYen(special.remaining)}`}
          </Text>
          {special.pendingThisMonth > 0 && (
            <Text style={[type.faint, type.minus]}>この月の予定でまだ払っていないもの {special.pendingThisMonth}件</Text>
          )}
        </Pressable>

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
          <View style={styles.grid}>
            {tiles.map((tile) => (
              <Tile key={tile.category.id} tile={tile} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Tile({ tile }: { tile: BudgetTile }) {
  const over = tile.budget !== null && tile.diff < 0;
  const headline =
    tile.budget === null
      ? '予算なし'
      : tile.diff < 0
        ? formatSignedYen(tile.diff)
        : tile.diff === 0
          ? '予算どおり'
          : `残り ${formatYen(tile.diff)}`;
  return (
    <View style={[styles.tile, over && styles.tileOver]}>
      <View style={styles.tileTop}>
        <UsageRing percent={tile.percent} size={40} />
        <Text style={styles.tileName} numberOfLines={2}>
          {tile.category.name}
        </Text>
      </View>
      <Text
        style={[styles.tileHeadline, over && type.minus, (tile.budget === null || tile.diff === 0) && styles.muted]}
        numberOfLines={1}
      >
        {headline}
      </Text>
      <Text style={type.faint} numberOfLines={1}>
        {formatYen(tile.actual)}
        {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」にタイルが隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  special: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  pressed: { backgroundColor: colors.background },
  specialHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  specialLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // 2列。輪と名前を上に、超えた額・残り額を大きく、実績 / 予算を薄く。
  tile: {
    width: '48.5%',
    gap: 6,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileOver: { borderColor: colors.moneyOverBorder, backgroundColor: colors.moneyOverSurface },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tileName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  tileHeadline: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { color: colors.textFaint },
});
