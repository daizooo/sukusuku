import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Settings2 } from 'lucide-react-native';
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
import { buildYearRows, formatFiscalYear } from '@/lib/specialUtils';
import { MonthBar, UsageRing } from '@/components/money/moneyVisual';

// 家計タブの「月」（docs/kakei.md §4.1）。PWA版の `src/components/sukusuku/money/MoneyMonthView.tsx` と同じ並び・文言。
//
// 上に結論（月の収支＝収入 − 生活費 − 貯金）。特別費は月の収支に入れず、その下に別枠で
// 「この月に特別費の年度の予算がどれだけ減ったか・残り」を出す。その下に生活費の大分類のタイル（使った割合の輪）を
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
        <View style={styles.summary}>
          <View style={styles.summaryHead}>
            <Text style={styles.summaryLabel}>月の収支（収入 − 生活費 − 貯金）</Text>
            <Text style={[styles.balance, summary.balance < 0 && styles.over]}>{formatSignedYen(summary.balance)}</Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.lineLabel}>収入</Text>
            <Text style={styles.lineValue}>{formatYen(summary.income)}</Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.lineLabel}>
              生活費<Text style={[styles.lineNote, livingDiff < 0 && styles.over]}>
                {'　'}予算 {formatYen(summary.livingBudget)}・差 {formatSignedYen(livingDiff)}
              </Text>
            </Text>
            <Text style={styles.lineValue}>−{formatYen(summary.living)}</Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.lineLabel}>
              貯金
              {summary.savingTarget > 0 && (
                <Text style={styles.lineNote}>
                  {'　'}目標 {formatYen(summary.savingTarget)}
                </Text>
              )}
            </Text>
            <Text style={styles.lineValue}>−{formatYen(summary.saving)}</Text>
          </View>
          <Text style={styles.lineNote}>予算どおりなら {formatSignedYen(summary.plannedBalance)}</Text>
        </View>

        <View style={styles.special}>
          <View style={styles.line}>
            <Text style={styles.specialTitle}>特別費（月の収支とは別）</Text>
            <Text style={styles.lineValue}>今月 −{formatYen(special.spentThisMonth)}</Text>
          </View>
          <View style={styles.bar}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${special.yearBudget > 0 ? Math.min(100, (special.spentToDate / special.yearBudget) * 100) : 0}%`,
                },
                special.remaining < 0 && styles.barOver,
              ]}
            />
          </View>
          <View style={styles.line}>
            <Text style={styles.lineNote}>
              {formatFiscalYear(fiscalYearOfMonth(monthKey))}の予算 {formatYen(special.yearBudget)}
            </Text>
            <Text style={[styles.lineNote, special.remaining < 0 && styles.over]}>
              {special.remaining < 0 ? `${formatYen(special.remaining)} 超過` : `残り ${formatYen(special.remaining)}`}
            </Text>
          </View>
          {special.pendingThisMonth > 0 && (
            <Text style={[styles.lineNote, styles.over]}>この月の予定でまだ払っていないもの {special.pendingThisMonth}件</Text>
          )}
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
  // 右下の「＋」にタイルが隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
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
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  lineLabel: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textSubtle },
  lineNote: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  lineValue: { fontSize: 13, fontWeight: '600', color: colors.text },
  special: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 6,
  },
  specialTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.neutralSurface, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.livingSpecial },
  barOver: { backgroundColor: colors.moneyOverRing },
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
