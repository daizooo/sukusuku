import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Settings2 } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet, SpecialActual, SpecialItem } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildBudgetTiles,
  buildMonthSummary,
  fiscalYearOfMonth,
  formatSignedYen,
  formatYen,
  type BudgetTile,
} from '@/lib/moneyUtils';
import { buildYearRows } from '@/lib/specialUtils';
import { MonthBar, UsageRing } from '@/components/money/moneyVisual';

// 家計タブの「月」（docs/kakei.md §4.1）。PWA版の `src/components/sukusuku/money/MoneyMonthView.tsx` と同じ並び・文言。
//
// 上に結論（月の収支＝収入 − 生活費 − 貯金。特別費は別枠）、その下に生活費の大分類のタイル（使った割合の輪）を
// 予算を超えた順に。タイルを押すと開く「要因」・月のメモ・カードの締めは docs/kakei.md §7 の3 で足す。

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
}: MoneyMonthViewProps) {
  const summary = useMemo(
    () => buildMonthSummary(records, categories, budgets, wallets, monthKey),
    [records, categories, budgets, wallets, monthKey],
  );
  const tiles = useMemo(() => buildBudgetTiles(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  // その月の特別費の予定（済・まだ）。
  const special = useMemo(() => {
    const month = Number(monthKey.slice(5, 7));
    const rows = buildYearRows(specialItems, specialActuals, fiscalYearOfMonth(monthKey), 'expense').filter(
      (row) => row.month === month,
    );
    return {
      planned: rows.reduce((sum, row) => sum + row.budget, 0),
      pending: rows.filter((row) => row.planId !== null && row.actual === null).length,
    };
  }, [specialItems, specialActuals, monthKey]);
  const livingDiff = summary.livingBudget - summary.living;

  return (
    <View style={styles.flex}>
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <View style={styles.summaryHead}>
            <Text style={styles.summaryLabel}>月の収支（収入 − 生活費 − 貯金）</Text>
            <Text style={[styles.balance, summary.balance < 0 && styles.over]}>{formatSignedYen(summary.balance)}</Text>
          </View>
          <View style={styles.summaryLine}>
            <Text style={styles.summarySub}>予算どおりなら {formatSignedYen(summary.plannedBalance)}</Text>
            <Text style={[styles.summarySub, livingDiff < 0 && styles.over]}>
              生活費 {formatSignedYen(livingDiff)}（{livingDiff < 0 ? '予算超え' : '予算内'}）
            </Text>
          </View>
          {(summary.saving > 0 || summary.savingTarget > 0) && (
            <View style={styles.summaryLine}>
              <Text style={styles.summarySub}>貯金</Text>
              <Text style={styles.summarySub}>
                {formatYen(summary.saving)}
                {summary.savingTarget > 0 ? ` / 目標 ${formatYen(summary.savingTarget)}` : ''}
              </Text>
            </View>
          )}
          <View style={[styles.summaryLine, styles.divided]}>
            <Text style={styles.summarySub}>特別費（別枠）</Text>
            <Text style={styles.summarySub}>
              済 <Text style={styles.strong}>{formatYen(summary.special)}</Text> / 予定 {formatYen(special.planned)}
              {special.pending > 0 && <Text style={styles.over}>　まだ{special.pending}件</Text>}
            </Text>
          </View>
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>生活費</Text>
          <Text style={styles.sectionHint}>超えた順</Text>
          <View style={styles.flex} />
          <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={6} style={styles.edit}>
            <Settings2 size={14} color={colors.money} />
            <Text style={styles.editText}>種類と予算</Text>
          </Pressable>
        </View>
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
      <UsageRing percent={tile.percent} />
      <View style={styles.flex}>
        <Text style={styles.tileName} numberOfLines={1}>
          {tile.category.name}
        </Text>
        <Text
          style={[styles.tileHeadline, over && styles.over, (tile.budget === null || tile.diff === 0) && styles.muted]}
          numberOfLines={1}
        >
          {headline}
          {over && <Text style={styles.overLabel}> 超過</Text>}
        </Text>
        <Text style={styles.tileSub} numberOfLines={1}>
          {formatYen(tile.actual)}
          {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  summary: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 6,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summaryLabel: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.textMuted },
  balance: { fontSize: 26, fontWeight: '700', color: colors.text },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  summarySub: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  strong: { fontWeight: '700', color: colors.text },
  divided: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 4 },
  over: { color: colors.moneyOver },
  muted: { color: colors.textFaint },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 18, marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  sectionHint: { fontSize: 12, fontWeight: '500', color: colors.textFaint },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editText: { fontSize: 12, fontWeight: '700', color: colors.money },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileOver: { borderColor: colors.moneyOverBorder },
  tileName: { fontSize: 14, fontWeight: '600', color: colors.text },
  tileHeadline: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 1 },
  overLabel: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  tileSub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 1 },
});
