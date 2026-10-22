import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { formatYen } from '@/lib/moneyUtils';

// 年間予算と振り返りの部品（docs/kakei.md §0.7。2026-10-22）。PWA版の `src/components/sukusuku/money/reviewParts.tsx` と同じ並び・文言。
//
// - BalanceCard: いちばん上の収支。収支を大きく、その下に「収入 − 支出」。収入と支出を切り替えて、内訳の割合を帯で出す
//   （収入は緑系、支出は青系。開いたときは支出）
// - SectionCard: 変動費・予備費・固定費などの、押すと折りたためる枠。見出しの右に要点を1つ（丸い札）
// - AmountRow: 枠の中の1行（名前・額・右に残り〔超過は赤〕・細い棒）。棒は青1色、超過は赤

const INCOME_COLORS = ['#0f766e', '#34a37f', '#7cc9a6', '#c4e8d5'];
const EXPENSE_COLORS = ['#1e4fae', '#4f7fd6', '#9bb8ea', '#d3e0f7'];
export const INCOME_TEXT = '#0f766e';
export const EXPENSE_TEXT = '#1e4fae';
export const OVER_TEXT = '#b91c1c';
const BAR = '#4f7fd6';
const OVER_BAR = '#dc2626';
const TRACK = '#eef2f7';

/** 見出しの点の色。 */
export const SECTION_DOTS = { income: INCOME_TEXT, variable: '#1e4fae', reserve: '#4f7fd6', fixed: '#9bb8ea' } as const;

export interface BalancePart {
  name: string;
  amount: number;
  /** 名前の下の注釈（「変動費＋予備費」など）。 */
  note?: string;
}

/** 符号つきの額（収支）。 */
export const signedYen = (value: number) => `${value > 0 ? '＋' : value < 0 ? '−' : ''}${formatYen(value)}`;

function Breakdown({ parts, palette }: { parts: BalancePart[]; palette: string[] }) {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  return (
    <View style={styles.breakdown}>
      <View style={styles.stack}>
        {total > 0 ? (
          parts
            .filter((part) => part.amount > 0)
            .map((part, index) => (
              <View key={part.name} style={{ flex: part.amount, backgroundColor: palette[Math.min(index, palette.length - 1)] }} />
            ))
        ) : (
          <View style={[styles.flex, { backgroundColor: TRACK }]} />
        )}
      </View>
      {parts.map((part, index) => (
        <View key={part.name}>
          <View style={styles.legendRow}>
            <View style={[styles.legendSwatch, { backgroundColor: palette[Math.min(index, palette.length - 1)] }]} />
            <Text style={styles.legendName}>{part.name}</Text>
            <Text style={styles.legendAmount}>{formatYen(part.amount)}</Text>
            <Text style={styles.legendPercent}>{total > 0 ? `${Math.round((part.amount / total) * 100)}%` : ''}</Text>
          </View>
          {part.note && <Text style={styles.legendNote}>{part.note}</Text>}
        </View>
      ))}
    </View>
  );
}

export function BalanceCard({
  label,
  incomeParts,
  expenseParts,
  children,
}: {
  label: string;
  incomeParts: BalancePart[];
  expenseParts: BalancePart[];
  /** 枠の下に足すもの（年末の着地見込み・月の締めなど）。 */
  children?: ReactNode;
}) {
  const [tab, setTab] = useState<'income' | 'expense'>('expense');
  const income = incomeParts.reduce((sum, part) => sum + part.amount, 0);
  const expense = expenseParts.reduce((sum, part) => sum + part.amount, 0);
  const balance = income - expense;
  return (
    <View style={styles.card}>
      <View style={styles.balanceHead}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.balance, balance < 0 && { color: OVER_TEXT }]}>{signedYen(balance)}</Text>
        <Text style={styles.formula}>
          収入 <Text style={{ color: INCOME_TEXT }}>{formatYen(income)}</Text> − 支出{' '}
          <Text style={{ color: EXPENSE_TEXT }}>{formatYen(expense)}</Text>
        </Text>
      </View>
      <View style={styles.tabs}>
        {(['income', 'expense'] as const).map((key) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={[styles.tab, tab === key && styles.tabOn]}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{key === 'income' ? '収入' : '支出'}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'income' ? (
        incomeParts.length === 0 ? (
          <Text style={styles.empty}>収入はまだありません</Text>
        ) : (
          <Breakdown parts={incomeParts} palette={INCOME_COLORS} />
        )
      ) : (
        <Breakdown parts={expenseParts} palette={EXPENSE_COLORS} />
      )}
      {children}
    </View>
  );
}

export type ChipTone = 'good' | 'over' | 'neutral';

export function SectionCard({
  title,
  dot,
  chip,
  progress,
  open,
  onToggle,
  children,
}: {
  title: string;
  dot: string;
  /** 見出しの右の丸い札（無ければ出さない）。 */
  chip?: { text: string; tone: ChipTone } | null;
  /** 見出しの下の棒（0〜1。1 を超えたら超過で赤）。null は出さない。 */
  progress?: number | null;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={styles.sectionHead}>
        <View style={styles.sectionLine}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <Text style={styles.sectionTitle}>{title}</Text>
          {chip && (
            <Text style={[styles.chip, chip.tone === 'good' && styles.chipGood, chip.tone === 'over' && styles.chipOver]}>{chip.text}</Text>
          )}
          {open ? <ChevronDown size={18} color={colors.textFaint} /> : <ChevronRight size={18} color={colors.textFaint} />}
        </View>
        {progress != null && <Bar value={progress} thick />}
      </Pressable>
      {open && children}
    </View>
  );
}

function Bar({ value, thick }: { value: number; thick?: boolean }) {
  const over = value > 1;
  return (
    <View style={[styles.track, thick && styles.trackThick]}>
      <View style={[styles.fill, thick && styles.trackThick, { width: `${Math.min(1, Math.max(0, value)) * 100}%`, backgroundColor: over ? OVER_BAR : BAR }]} />
    </View>
  );
}

/** 残り（＋）は「¥1,000」、超過（−）は赤の「−¥1,000」。 */
export const remainingText = (value: number) => ({ text: value < 0 ? `−${formatYen(value)}` : formatYen(value), over: value < 0 });

export function AmountRow({
  name,
  amount,
  right,
  progress,
  sub,
  faint,
  onPress,
}: {
  name: string;
  amount: string;
  /** 右の数字（残り・超過・「/月」など）。over は赤。 */
  right?: { text: string; over?: boolean; muted?: boolean } | null;
  /** 細い棒（0〜1。1 を超えたら赤）。 */
  progress?: number | null;
  /** 名前の下の小さな文字（日付など）。 */
  sub?: string;
  faint?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowLine}>
        <View style={styles.flex}>
          <Text style={[styles.rowName, faint && styles.faint]} numberOfLines={1}>
            {name}
          </Text>
          {sub && <Text style={styles.rowSub}>{sub}</Text>}
        </View>
        <Text style={[styles.rowAmount, faint && styles.faint]}>{amount}</Text>
        {right && (
          <Text style={[styles.rowRight, right.over && { color: OVER_TEXT }, right.muted && styles.rowRightMuted, !right.over && !right.muted && { color: INCOME_TEXT }]}>
            {right.text}
          </Text>
        )}
      </View>
      {progress != null && <Bar value={progress} />}
    </Pressable>
  );
}

/** 枠の中の小見出し（固定費の「確定」「見込み」）。 */
export function SubHeading({ title, amount }: { title: string; amount: string }) {
  return (
    <View style={styles.subHeading}>
      <Text style={styles.subHeadingText}>{title}</Text>
      <View style={styles.subHeadingLine} />
      <Text style={styles.subHeadingText}>{amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  balanceHead: { paddingHorizontal: 18, paddingTop: 18, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  balance: { fontSize: 32, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  formula: { fontSize: 13, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  tabs: { flexDirection: 'row', gap: 4, marginHorizontal: 18, marginTop: 14, padding: 3, borderRadius: 10, backgroundColor: '#f3f4f6' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  tabOn: { backgroundColor: colors.surface, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  tabTextOn: { color: colors.text },
  breakdown: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, gap: 8 },
  stack: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, marginBottom: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  legendName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#374151' },
  legendAmount: { fontSize: 14, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  legendPercent: { width: 40, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  legendNote: { paddingLeft: 18, fontSize: 11, fontWeight: '600', color: colors.textFaint },
  empty: { paddingHorizontal: 18, paddingVertical: 18, fontSize: 13, fontWeight: '500', color: colors.textFaint },
  sectionHead: { paddingHorizontal: 18, paddingVertical: 16, gap: 10 },
  sectionLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  chip: { fontSize: 13, fontWeight: '800', color: '#374151', backgroundColor: '#f3f4f6', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden', fontVariant: ['tabular-nums'] },
  chipGood: { color: INCOME_TEXT },
  chipOver: { color: OVER_TEXT, backgroundColor: '#fef2f2' },
  track: { height: 6, borderRadius: 3, backgroundColor: TRACK, overflow: 'hidden' },
  trackThick: { height: 8, borderRadius: 4 },
  fill: { height: 6, borderRadius: 3 },
  row: { paddingLeft: 38, paddingRight: 18, paddingVertical: 11, gap: 7, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  pressed: { backgroundColor: colors.background },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  rowAmount: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  rowRight: { minWidth: 76, textAlign: 'right', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rowRightMuted: { minWidth: 40, color: colors.textFaint, fontWeight: '600' },
  faint: { color: colors.textFaint },
  subHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 38, paddingRight: 18, paddingTop: 12, paddingBottom: 4, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  subHeadingText: { fontSize: 12, fontWeight: '800', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  subHeadingLine: { flex: 1, height: 1, backgroundColor: '#f3f4f6' },
});
