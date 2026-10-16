import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type {
  MoneyBudget,
  MoneyCardFeed,
  MoneyCategory,
  MoneyFeedItem,
  MoneyMonth,
  MoneyRecord,
  MoneyRecurring,
  MoneyWallet,
  MoneyWalletBalance,
} from '@/types/app';
import { cardMonthChecks } from '@/lib/moneyFeedUtils';
import { colors } from '@/lib/theme';
import {
  buildBudgetTiles,
  buildMonthSummary,
  buildCategoryAnalysis,
  categoryYearLanding,
  buildYearLanding,
  buildYearSummary,
  compareWithPreviousYear,
  dateKeyOfDate,
  estimatesInMonth,
  formatBalance,
  formatSignedYen,
  formatYear,
  formatYen,
  iconKeyOf,
  isMonthClosed,
  monthKeyOfDate,
  recordTotal,
  unclosedMonths,
  yearActiveMonthKeys,
  yearMonthKeys,
  yearToDateBalance,
  type BudgetTile,
} from '@/lib/moneyUtils';
import ReviewDetailScreen, { type ReviewDetail } from '@/components/money/ReviewDetailScreen';
import YearFlowChart, { type YearFlowMonth } from '@/components/money/YearFlowChart';
import MonthCloseScreen from '@/components/money/MonthCloseScreen';
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
// 結論は収支＝収入 − 支出（生活費）。
// 貯金は記録なので式にも表示にも入れない。
// 月には年初からの累計、年には月平均・前年の同じ月ぶんとの比べ・月ごとの収支と累計のグラフを添える（§0.4）。
// 年と累計は、記録のある月だけを数える（記録は2026年10月から）。
// その下の「内訳」は、大分類の一覧（カテゴリの並び順）。
// 内訳の行を押すと、簡単な分析と、その行に絞った記録の一覧が開く（ReviewDetailScreen。§4.4）。
// 年は内訳の下に月ごとの収支（押すとその月へ）。
// 見込みの額（毎月の記録で自動で作り、まだ確かめていない額）は実績に入れて数え、件数と額を添えて出す（§3.3・§4.1）。
// 月の締め（§4.5）: 過ぎた月と今月の結論の下に「この月を締める」（月の最終週に締めることもあるため、今月も出す）（締めた月は「締めた月」）。押すと締めの画面（MonthCloseScreen）。
// 締めていない過ぎた月があれば、いちばん上に「◯月が締まっていません」と出す（押すとその月の締めの画面）。
// 年末の着地見込み（§4.6）: 年の結論に「年末の着地見込み」（締めた月の実額 ＋ 締めていない月の見込み）。グラフは締めた月を実線、ほかを年末まで点線。
// 今年・先の年と、締めていない月が残る過ぎた年に出す。

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
  /** 確定した残高（月の締めで、月末の残高を出す）。 */
  balances: MoneyWalletBalance[];
  /** 年の「月ごと」の行を押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
  onEditCategories: () => void;
  /** 予算（年ごと。カテゴリとは別の設定）を開く。 */
  onEditBudgets: () => void;
  /** 内訳の詳細の中で記録を押したとき。詳細を閉じて、記録の詳細を開く。 */
  onOpenRecord: (record: MoneyRecord) => void;
  /** 月の締め（docs/kakei.md §4.5）。 */
  months: MoneyMonth[];
  /** 固定収入・固定費のルール（締めの画面に、これから自動で作られる記録を出す）。 */
  recurring: MoneyRecurring[];
  /** 未確認の明細（締めの画面に、その月の件数を出す）。 */
  feedItems: MoneyFeedItem[];
  /** カードの利用通知の取り込み（締めの画面で、カードの記録を明細と見比べる）。読み込み前は null。 */
  cardFeed: MoneyCardFeed | null;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onSetMonthClosed: (monthKey: string, closed: boolean) => void;
  onOpenFeed: () => void;
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
  balances,
  onSelectMonth,
  onEditCategories,
  onEditBudgets,
  onOpenRecord,
  months: closings,
  recurring,
  feedItems,
  cardFeed,
  onConfirmEstimate,
  onSetMonthClosed,
  onOpenFeed,
}: MoneyReviewViewProps) {
  const isMonth = period === 'month';
  const today = monthKeyOfDate(new Date());
  const year = yearProp;
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [monthDetail, setMonthDetail] = useState<{ category: MoneyCategory; monthKey: string } | null>(null);
  // 締めの画面を開いている月。
  const [closing, setClosing] = useState<string | null>(null);
  const unclosed = useMemo(() => unclosedMonths(records, closings, today), [records, closings, today]);
  const monthClosed = isMonthClosed(closings, monthKey);
  const openClosing = (target: string) => {
    if (isMonth) onMonth(target);
    else onSelectMonth(target);
    setClosing(target);
  };

  const month = useMemo(
    () => buildMonthSummary(records, categories, budgets, monthKey),
    [records, categories, budgets, monthKey],
  );
  const yearSummary = useMemo(
    () => buildYearSummary(records, categories, budgets, year, today),
    [records, categories, budgets, year, today],
  );
  const landing = useMemo(() => {
    if (isMonth) return null;
    const result = buildYearLanding(records, categories, budgets, recurring, closings, year);
    if (result === null) return null;
    const open = result.months.some((row) => row.counted && !row.closed);
    return year >= Number(today.slice(0, 4)) || open ? result : null;
  }, [isMonth, records, categories, budgets, recurring, closings, year, today]);
  const chartMonths = useMemo<YearFlowMonth[]>(
    () =>
      landing === null
        ? yearSummary.months
        : landing.months.map((row) => ({
            monthKey: row.monthKey,
            recorded: row.counted,
            balance: row.balance,
            cumulative: row.cumulative,
            forecast: !row.closed,
          })),
    [landing, yearSummary],
  );
  // 月: 年初からの累計。年: 前の年の同じ月ぶんとの比べ。
  const ytd = useMemo(
    () => (isMonth ? yearToDateBalance(records, categories, budgets, monthKey) : null),
    [isMonth, records, categories, budgets, monthKey],
  );
  const comparison = useMemo(
    () => (isMonth ? null : compareWithPreviousYear(records, categories, budgets, year, today)),
    [isMonth, records, categories, budgets, year, today],
  );
  // 見ている期間の月。月なら1つ、年なら使い始めた月から12月まで（年の予算がかかる月。使い始める前の月の予算は数えない。2026-10-15）。
  const periodKeys = useMemo(
    () => (isMonth ? [monthKey] : yearActiveMonthKeys(records, year)),
    [isMonth, monthKey, records, year],
  );
  const tiles = useMemo(
    () => (periodKeys.length === 0 ? [] : buildBudgetTiles(records, categories, budgets, periodKeys)),
    [periodKeys, records, categories, budgets],
  );

  const income = isMonth ? month.income : yearSummary.total.income;
  const living = isMonth ? month.living : yearSummary.total.living;
  const balance = isMonth ? month.balance : yearSummary.total.balance;
  const estimates = useMemo(() => {
    const keys = isMonth ? [monthKey] : yearMonthKeys(year).filter((key) => key <= today);
    const list = keys.flatMap((key) => estimatesInMonth(records, key));
    return { count: list.length, amount: list.reduce((sum, record) => sum + recordTotal(record), 0) };
  }, [isMonth, monthKey, year, today, records]);

  // 内訳の行を押したときの分析。見ている期間の予算（年は年の予算）・実績・小分類ごと・記録。年は締めた月ごとの実績も出す（2026-10-16）。
  const analysis = useMemo(
    () => (detail === null ? null : buildCategoryAnalysis(records, categories, budgets, detail.category.id, periodKeys, null)),
    [detail, periodKeys, records, categories, budgets],
  );
  const closedMonths = useMemo(
    () => (isMonth || analysis === null ? null : analysis.months.filter((entry) => isMonthClosed(closings, entry.monthKey)).reverse()),
    [isMonth, analysis, closings],
  );
  // 年の詳細の年末の着地見込み（締めた月は実績、ほかの月は月の予算）。
  const categoryLanding = useMemo(
    () =>
      isMonth || analysis === null
        ? null
        : categoryYearLanding(analysis.months, new Set(analysis.months.filter((entry) => isMonthClosed(closings, entry.monthKey)).map((entry) => entry.monthKey))),
    [isMonth, analysis, closings],
  );
  // 年の詳細の「締めた月ごと」の行を押したときの、その月のカテゴリの詳細。
  const monthAnalysis = useMemo(
    () =>
      monthDetail === null
        ? null
        : buildCategoryAnalysis(records, categories, budgets, monthDetail.category.id, [monthDetail.monthKey], null),
    [monthDetail, records, categories, budgets],
  );
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
        {unclosed.length > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => openClosing(unclosed[0])}
            style={({ pressed }) => [styles.unclosed, pressed && styles.pressed]}
          >
            <Text style={[styles.unclosedText, styles.flex]}>
              {`${Number(unclosed[0].slice(5, 7))}月が締まっていません${unclosed.length > 1 ? `（ほか${unclosed.length - 1}か月）` : ''}。収支を確かめて締めましょう`}
            </Text>
            <ChevronRight size={16} color={colors.textMuted} />
          </Pressable>
        )}
        <Hero
          compact
          label="収支"
          value={formatBalance(balance)}
          plus={balance > 0}
        >
          <StatRow compact label="収入" value={formatYen(income)} plus={income > 0} />
          <StatRow compact label="支出" value={`−${formatYen(living)}`} />
          {ytd !== null && (
            <StatRow
              compact
              label="年初からの累計"
              value={formatBalance(ytd)}
              plus={ytd > 0}
            />
          )}
          {!isMonth && yearSummary.average !== null && (
            <StatRow
              compact
              label="月平均"
              value={formatBalance(yearSummary.average.balance)}
              plus={yearSummary.average.balance > 0}
            />
          )}
          {comparison !== null && (
            <StatRow
              compact
              label="前年の同じ期間より"
              value={formatSignedYen(comparison.diff)}
              minus={comparison.diff < 0}
            />
          )}
          {estimates.count > 0 && (
            <View style={styles.estimate}>
              <EstimateBadge />
              <Text style={[type.faint, styles.flex]}>
                見込みの額 {estimates.count}件（{formatYen(estimates.amount)}）を含みます。額を確かめて直すと確定します
              </Text>
            </View>
          )}
          {landing !== null && (
            <StatRow
              compact
              label="年末の着地見込み"
              value={formatSignedYen(landing.total)}
              plus={landing.total > 0}
              minus={landing.total < 0}
            />
          )}
          {isMonth && (monthClosed || monthKey <= today) && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setClosing(monthKey)}
              style={({ pressed }) => [styles.closeRow, pressed && styles.pressed]}
            >
              <Text style={[monthClosed ? styles.closedText : styles.closeText, styles.flex]}>
                {monthClosed ? '締めた月' : 'この月を締める'}
              </Text>
              <ChevronRight size={16} color={colors.textFaint} />
            </Pressable>
          )}
        </Hero>


        {isMonth ? (
          <>
            <SectionHeader
              compact
              title="内訳"
              right={<SettingLinks onEditCategories={onEditCategories} onEditBudgets={onEditBudgets} />}
            />
            {tiles.length === 0 && (
              <Text style={styles.message}>「カテゴリ」と「予算」を決めると、ここに予算との差が出ます</Text>
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
            </View>
          </>
        ) : (
          <>
            <SectionHeader
              compact
              title="カテゴリ"
              right={<SettingLinks onEditCategories={onEditCategories} onEditBudgets={onEditBudgets} />}
            />
            {tiles.length === 0 && (
              <Text style={styles.message}>「カテゴリ」と「予算」を決めると、ここに年の予算との差が出ます</Text>
            )}
            <View style={styles.card}>
              {tiles.map((tile, index) => (
                <CategoryRow
                  key={tile.category.id}
                  tile={tile}
                  divided={index > 0}
                  yearly
                  onPress={() => setDetail({ type: 'category', category: tile.category })}
                />
              ))}
            </View>
            {chartMonths.some((row) => row.recorded) ? (
              <>
                <SectionHeader compact title="推移" />
                <View style={styles.card}>
                  <YearFlowChart months={chartMonths} onSelectMonth={onSelectMonth} />
                </View>
              </>
            ) : (
              <Text style={styles.message}>この年はまだ記録がありません</Text>
            )}
          </>
        )}
      </ScrollView>

      {closing !== null && (
        <MonthCloseScreen
          monthKey={closing}
          records={records}
          categories={categories}
          budgets={budgets}
          recurring={recurring}
          today={dateKeyOfDate(new Date())}
          feedCount={feedItems.filter((item) => item.occurredOn !== null && item.occurredOn.startsWith(`${closing}-`)).length}
          cardChecks={cardFeed && cardFeed.walletIds.length > 0 ? cardMonthChecks(records, cardFeed, closing) : null}
          wallets={wallets}
          balances={balances}
          closed={isMonthClosed(closings, closing)}
          closedAt={closings.find((entry) => entry.month === closing)?.closedAt ?? null}
          onConfirmEstimate={onConfirmEstimate}
          onOpenRecord={(record) => {
            setClosing(null);
            onOpenRecord(record);
          }}
          onOpenFeed={() => {
            setClosing(null);
            onOpenFeed();
          }}
          onCloseMonth={() => {
            onSetMonthClosed(closing, true);
            setClosing(null);
          }}
          onReopenMonth={() => onSetMonthClosed(closing, false)}
          onClose={() => setClosing(null)}
        />
      )}

      {detail !== null && (
        <ReviewDetailScreen
          detail={detail}
          periodLabel={periodLabel}
          analysis={analysis}
          closedMonths={closedMonths}
          landing={categoryLanding}
          onOpenMonth={(key) => setMonthDetail({ category: detail.category, monthKey: key })}
          categories={categories}
          wallets={wallets}
          onClose={() => setDetail(null)}
          onOpenRecord={(record) => {
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}

      {monthDetail !== null && (
        <ReviewDetailScreen
          detail={{ type: 'category', category: monthDetail.category }}
          periodLabel={`${Number(monthDetail.monthKey.slice(5, 7))}月`}
          analysis={monthAnalysis}
          closedMonths={null}
          landing={null}
          onOpenMonth={() => undefined}
          categories={categories}
          wallets={wallets}
          onClose={() => setMonthDetail(null)}
          onOpenRecord={(record) => {
            setMonthDetail(null);
            setDetail(null);
            onOpenRecord(records.find((entry) => entry.id === record.id) ?? record);
          }}
        />
      )}
    </View>
  );
}

/** 内訳の見出しの右の、設定への入口（カテゴリと予算は別の設定。2026-10-15）。 */
function SettingLinks({ onEditCategories, onEditBudgets }: { onEditCategories: () => void; onEditBudgets: () => void }) {
  return (
    <View style={styles.links}>
      <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={8}>
        <Text style={type.link}>カテゴリ</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onEditBudgets} hitSlop={8}>
        <Text style={type.link}>予算</Text>
      </Pressable>
    </View>
  );
}

/** 大分類の1行（Zaim と同じく小さく）。アイコン・名前・超えた額／残り額、使った割合の帯、実績 / 予算。 */
function CategoryRow({
  tile,
  divided,
  yearly,
  onPress,
}: {
  tile: BudgetTile;
  divided: boolean;
  /** 年の振り返り（予算は年の予算）。 */
  yearly?: boolean;
  onPress: () => void;
}) {
  const over = tile.budget !== null && tile.diff < 0;
  const quiet = tile.budget === null || tile.diff === 0;
  // 残りの額が大きく、予算を超えたら「残り −¥1,234」（符号をつけた黒。超えたことは帯の赤で見せる）。
  const headline =
    tile.budget === null
      ? '予算なし'
      : tile.diff === 0
        ? '予算どおり'
        : `${yearly ? '年の残り' : '残り'} ${formatBalance(tile.diff)}`;
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
  links: { flexDirection: 'row', gap: 14 },
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
  // 締めていない月の注意（docs/kakei.md §4.5）。
  unclosed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.moneyEstimateSurface,
  },
  unclosedText: { fontSize: 13, fontWeight: '600', color: colors.moneyEstimate },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  closeText: { fontSize: 14, fontWeight: '700', color: colors.money },
  closedText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  closedMark: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
});
