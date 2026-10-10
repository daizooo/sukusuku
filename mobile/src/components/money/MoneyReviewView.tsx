import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet, SpecialActual, SpecialItem } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildCategoryAnalysis,
  buildSpecialAnalysis,
  buildYearSummary,
  estimatesInMonth,
  formatBalance,
  formatSignedYen,
  formatYen,
  iconKeyOf,
  monthKeyOfDate,
  recordTotal,
  shiftMonth,
  yearMonthKeys,
  yearOfMonth,
  type BudgetTile,
  type SpecialAnalysis,
} from '@/lib/moneyUtils';
import { buildYearRows, formatYear } from '@/lib/specialUtils';
import ReviewDetailScreen, { type ReviewDetail } from '@/components/money/ReviewDetailScreen';
import {
  CategoryIcon,
  EstimateBadge,
  Hero,
  PeriodBar,
  ProgressBar,
  SectionHeader,
  StatRow,
  type,
  type ReviewPeriod,
} from '@/components/money/moneyVisual';

// 家計タブの「振り返り」（docs/kakei.md §4）。PWA版の `src/components/sukusuku/money/MoneyReviewView.tsx` と同じ並び・文言。
//
// 月と年は同じ面。上の送りの右「月 / 年」で期間を切り替える（2026-10-08に、別々の面から1つにした）。
// 年は暦年（1月〜12月。2026-10-09に年度から変えた。予算の月額も年ごと）。
// 結論は生活費の収支（特別費は入れない）＝収入 − 生活費（特別費以外の支出。種類の名前が「その他」でも生活費）。
// 貯金は記録なので式にも表示にも入れない。
// その下の「内訳」は、月なら生活費の大分類の一覧（種類の並び順）の最後に特別費の1行、年なら特別費の1行。
// 特別費の行はその期間に払った額と年の予算の残り（月ならその月までの累計）だけ（2026-10-08に、生活費と同じ大きさの
// 結論から内訳の1行にした）。特別費の予定は「家計の設定」で編集する（2026-10-09）。
// 内訳の行（生活費の大分類・特別費）を押すと、簡単な分析と、その行に絞った記録の一覧が開く（ReviewDetailScreen。§4.4）。
// 年は内訳の下に月ごとの収支（押すとその月へ）。
// 見込みの額（毎月の記録で自動で作り、まだ確かめていない額）は実績に入れて数え、件数と額を添えて出す（§3.3・§4.1）。

interface MoneyReviewViewProps {
  period: ReviewPeriod;
  onPeriod: (period: ReviewPeriod) => void;
  monthKey: string;
  onMonth: (monthKey: string) => void;
  year: number;
  onYear: (year: number) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  /** 年の「月ごと」の行を押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  onEditCategories: () => void;
  /** 内訳の詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
  onOpenRecord: (record: MoneyRecord) => void;
}

export default function MoneyReviewView({
  period,
  onPeriod,
  monthKey,
  onMonth,
  year: yearProp,
  onYear,
  records,
  categories,
  budgets,
  wallets,
  specialItems,
  specialActuals,
  onSelectMonth,
  onEditCategories,
  onOpenRecord,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const year = yearProp;
  const viewYear = isMonth ? yearOfMonth(monthKey) : year;
  const [detail, setDetail] = useState<ReviewDetail | null>(null);

  const month = useMemo(
    () => buildMonthSummary(records, categories, budgets, monthKey),
    [records, categories, budgets, monthKey],
  );
  const yearSummary = useMemo(
    () => buildYearSummary(records, categories, budgets, year, today),
    [records, categories, budgets, year, today],
  );
  // 見ている期間の月。月なら1つ、年なら記録のある月だけ（記録の無い月の予算は数えない）。
  const periodKeys = useMemo(
    () => (isMonth ? [monthKey] : yearSummary.months.filter((row) => row.recorded).map((row) => row.monthKey)),
    [isMonth, monthKey, yearSummary],
  );
  const tiles = useMemo(
    () => (periodKeys.length === 0 ? [] : buildBudgetTiles(records, categories, budgets, periodKeys)),
    [periodKeys, records, categories, budgets],
  );
  const specialRows = useMemo(
    () => buildYearRows(specialItems, specialActuals, viewYear, 'expense'),
    [specialItems, specialActuals, viewYear],
  );
  const special = useMemo(
    () => buildSpecialAnalysis(records, specialRows, viewYear, isMonth ? monthKey : null),
    [records, specialRows, viewYear, isMonth, monthKey],
  );

  const income = isMonth ? month.income : yearSummary.total.income;
  const living = isMonth ? month.living : yearSummary.total.living;
  const balance = isMonth ? month.balance : yearSummary.total.balance;
  const livingDiff = isMonth ? month.livingBudget - month.living : yearSummary.total.livingDiff;
  const planned = isMonth ? month.plannedBalance : null;
  const estimates = useMemo(() => {
    const keys = isMonth ? [monthKey] : yearMonthKeys(year).filter((key) => key <= today);
    const list = keys.flatMap((key) => estimatesInMonth(records, key));
    return { count: list.length, amount: list.reduce((sum, record) => sum + recordTotal(record), 0) };
  }, [isMonth, monthKey, year, today, records]);
  const months = yearSummary.months.filter((row) => row.monthKey <= today && (row.recorded || row.special > 0)).reverse();

  // 内訳の行を押したときの分析。前の期間（月なら前の月、年なら前の年の同じ月ぶん）と比べる。
  const analysis = useMemo(() => {
    if (detail === null || detail.type !== 'category') return null;
    const previousKeys = isMonth ? [shiftMonth(monthKey, -1)] : periodKeys.map((key) => shiftMonth(key, -12));
    return buildCategoryAnalysis(records, categories, budgets, detail.category.id, periodKeys, previousKeys);
  }, [detail, isMonth, monthKey, periodKeys, records, categories, budgets]);
  const periodLabel = isMonth ? `${Number(monthKey.slice(5, 7))}月` : formatYear(year);

  return (
    <View style={styles.flex}>
      <PeriodBar
        period={period}
        onPeriod={onPeriod}
        monthKey={monthKey}
        onMonth={onMonth}
        year={year}
        onYear={onYear}
      />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Hero
          compact
          label={isMonth ? '生活費の収支' : '生活費の収支（年）'}
          value={formatSignedYen(balance)}
          plus={balance > 0}
          note={
            planned !== null
              ? `収入 − 特別費以外の支出・予算どおりなら ${formatSignedYen(planned)}`
              : `収入 − 特別費以外の支出・記録のある${yearSummary.recordedMonths}か月ぶん`
          }
        >
          <StatRow compact label="収入" value={`+${formatYen(income)}`} plus={income > 0} />
          <StatRow
            compact
            label="生活費"
            note={
              isMonth
                ? `予算 ${formatYen(month.livingBudget)}（${livingDiff < 0 ? `${formatBalance(livingDiff)} 超過` : `残り ${formatYen(livingDiff)}`}）`
                : livingDiff < 0
                  ? `予算より ${formatYen(livingDiff)} 多い`
                  : `予算より ${formatYen(livingDiff)} 少ない`
            }
            value={`−${formatYen(living)}`}
          />
          {estimates.count > 0 && (
            <View style={styles.estimate}>
              <EstimateBadge />
              <Text style={[type.faint, styles.flex]}>
                見込みの額 {estimates.count}件（{formatYen(estimates.amount)}）を含みます。額を確かめて直すと確定します
              </Text>
            </View>
          )}
        </Hero>


        {isMonth ? (
          <>
            <SectionHeader
              compact
              title="内訳"
              hint="押すと分析と記録"
              right={
                <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={8}>
                  <Text style={type.link}>カテゴリと予算</Text>
                </Pressable>
              }
            />
            {tiles.length === 0 && (
              <Text style={styles.message}>「カテゴリと予算」で種類と月の予算を決めると、ここに予算との差が出ます</Text>
            )}
            <View style={styles.card}>
              {tiles.map((tile, index) => (
                <CategoryRow
                  key={tile.category.id}
                  tile={tile}
                  divided={index > 0}
                  onPress={() => setDetail({ type: 'category', category: tile.category })}
                />
              ))}
              <SpecialRow special={special} isMonth divided={tiles.length > 0} onPress={() => setDetail({ type: 'special' })} />
            </View>
          </>
        ) : (
          <>
            <SectionHeader
              compact
              title="内訳"
              hint="押すと分析と記録"
              right={
                <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={8}>
                  <Text style={type.link}>カテゴリと予算</Text>
                </Pressable>
              }
            />
            <View style={styles.card}>
              {tiles.map((tile, index) => (
                <CategoryRow
                  key={tile.category.id}
                  tile={tile}
                  divided={index > 0}
                  onPress={() => setDetail({ type: 'category', category: tile.category })}
                />
              ))}
              <SpecialRow special={special} isMonth={false} divided={tiles.length > 0} onPress={() => setDetail({ type: 'special' })} />
            </View>
            <SectionHeader compact title="月ごと" hint="押すとその月へ" />
            {months.length === 0 ? (
              <Text style={styles.message}>この年はまだ記録がありません</Text>
            ) : (
              <View style={styles.card}>
                {months.map((row, index) => {
                  const number = Number(row.monthKey.slice(5, 7));
                  return (
                    <Pressable
                      key={row.monthKey}
                      accessibilityRole="button"
                      accessibilityLabel={`${number}月の振り返りを見る`}
                      onPress={() => onSelectMonth(row.monthKey)}
                      style={({ pressed }) => [styles.row, index > 0 && styles.rowDivided, pressed && styles.pressed]}
                    >
                      <Text style={styles.month}>{number}月</Text>
                      <View style={styles.flex}>
                        {row.recorded ? (
                          <Text style={type.faint} numberOfLines={1}>
                            収入 {formatYen(row.income)}・生活費 {formatYen(row.living)}
                            {row.livingDiff < 0 ? '（予算超え）' : ''}
                          </Text>
                        ) : (
                          <Text style={type.faint}>生活費の記録なし</Text>
                        )}
                        {row.special > 0 && <Text style={type.faint}>特別費 {formatYen(row.special)}</Text>}
                      </View>
                      {estimatesInMonth(records, row.monthKey).length > 0 && <EstimateBadge />}
                      {row.recorded && (
                        <Text style={[styles.monthBalance, row.balance > 0 && styles.plus]}>{formatSignedYen(row.balance)}</Text>
                      )}
                      <ChevronRight size={16} color={colors.textFaint} />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {detail !== null && (
        <ReviewDetailScreen
          detail={detail}
          periodLabel={periodLabel}
          isMonth={isMonth}
          analysis={analysis}
          special={special}
          year={viewYear}
          categories={categories}
          wallets={wallets}
          specialItems={specialItems}
          onClose={() => setDetail(null)}
          onOpenRecord={(record) => {
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}
    </View>
  );
}

/** 内訳の特別費の1行。その期間に払った額と、年の予算の残り。押すと分析と記録。 */
function SpecialRow({
  special,
  isMonth,
  divided,
  onPress,
}: {
  special: SpecialAnalysis;
  isMonth: boolean;
  divided: boolean;
  onPress: () => void;
}) {
  const over = special.remaining < 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="特別費を見る"
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.categoryRow, divided && styles.rowDivided, pressed && styles.pressed]}
    >
      <CategoryIcon iconKey="star" size={28} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            特別費
          </Text>
          <Text style={[styles.rowHeadline, special.spent === 0 && styles.muted]}>
            {isMonth ? 'この月' : '年'} {formatYen(special.spent)}
          </Text>
        </View>
        {special.yearBudget > 0 ? (
          <View style={styles.rowBar}>
            <View style={styles.flex}>
              <ProgressBar ratio={special.spentToDate / special.yearBudget} over={over} />
            </View>
            <Text style={type.faint}>
              {`年 ${formatYen(special.spentToDate)} / ${formatYen(special.yearBudget)}・${over ? `${formatBalance(special.remaining)} 超過` : `残り ${formatYen(special.remaining)}`}`}
            </Text>
          </View>
        ) : (
          <Text style={type.faint}>「家計の設定」の「特別費の予定」で予定を決めると、予算の残りが出ます</Text>
        )}
      </View>
      <ChevronRight size={16} color={colors.textFaint} />
    </Pressable>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・超えた額／残り額、使った割合の帯、実績 / 予算。 */
function CategoryRow({ tile, divided, onPress }: { tile: BudgetTile; divided: boolean; onPress: () => void }) {
  const over = tile.budget !== null && tile.diff < 0;
  const quiet = tile.budget === null || tile.diff === 0;
  // 残りの額が大きく、予算を超えたら「残り −¥1,234」（符号をつけた黒。超えたことは帯の赤で見せる）。
  const headline =
    tile.budget === null
      ? '予算なし'
      : tile.diff === 0
        ? '予算どおり'
        : `残り ${formatBalance(tile.diff)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tile.category.name}の分析と記録を見る`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.categoryRow, divided && styles.rowDivided, pressed && styles.pressed]}
    >
      <CategoryIcon iconKey={iconKeyOf(tile.category)} size={28} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            {tile.category.name}
          </Text>
          <Text style={[styles.rowHeadline, quiet && styles.muted]}>{headline}</Text>
        </View>
        <View style={styles.rowBar}>
          <View style={styles.flex}>
            <ProgressBar ratio={tile.budget ? tile.actual / tile.budget : 0} over={over} />
          </View>
          <Text style={type.faint}>
            {formatYen(tile.actual)}
            {tile.budget !== null ? ` / ${formatYen(tile.budget)}` : ''}
            {tile.percent !== null ? `・${tile.percent}%` : ''}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  gap: { height: 12 },
  estimate: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  bar: { paddingVertical: 6 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9 },
  categoryRow: { gap: 10, paddingHorizontal: 12, paddingVertical: 7 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  month: { width: 40, fontSize: 15, fontWeight: '700', color: colors.text },
  monthBalance: { fontSize: 17, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  plus: { color: colors.moneyIncome },
  rowBody: { flex: 1, gap: 3 },
  // 帯と「実績 / 予算・割合」を同じ行に（行の高さを抑える）。帯は残りの幅いっぱい。
  rowBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  rowHeadline: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { color: colors.textFaint },
});
