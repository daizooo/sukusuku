import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { ArrowLeft, ChevronLeft, ChevronRight, CreditCard, Landmark, PiggyBank, QrCode, RefreshCw, X } from 'lucide-react-native';
import type { MoneyWalletType } from '@/types/app';
import { colors } from '@/lib/theme';
import { formatMonthKey, iconTone, shiftMonth } from '@/lib/moneyUtils';
import { MONEY_ICON_COMPONENTS } from '@/components/money/moneyIcons';
import { formatFiscalYear } from '@/lib/specialUtils';

// 家計タブで共通に使う部品と、見た目の決まり（docs/kakei.md §2.1）。
// PWA版の `src/components/sukusuku/money/moneyVisual.tsx` と同じ見た目。
//
// どの面も「送り（月・年度）→ 結論（数字を1つ大きく）→ 内訳 → 明細」の順に並べる。
// 文字は4段（結論の数字 / 見出し / 行 / 補足）に絞り、色は意味のあるところだけ
// （赤＝マイナス・超過、青＝押せるもの）。

/** 文字の大きさと濃さ（4段）。数字・英字を出す Text には必ず fontWeight を付ける（CLAUDE.md）。 */
export const type = StyleSheet.create({
  /** 結論の数字。 */
  hero: { fontSize: 34, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  /** 見出し・ラベルの強いもの。 */
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  /** 行の主（名前）。 */
  row: { fontSize: 15, fontWeight: '600', color: colors.text },
  /** 行の金額。 */
  amount: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  /** 補足（ラベル・内訳の説明）。 */
  sub: { fontSize: 12, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  /** 薄い補足（予算・件数など）。 */
  faint: { fontSize: 11, fontWeight: '500', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  /** マイナス・超過。 */
  minus: { color: colors.moneyOver },
  /** 押せる文字。 */
  link: { fontSize: 13, fontWeight: '700', color: colors.money },
});

/** 前後に送るボタンつきの見出し（‹ 2026年9月 ›）。 */
function Stepper({
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  right,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityRole="button" accessibilityLabel={prevLabel} onPress={onPrev} hitSlop={8} style={styles.stepButton}>
        <ChevronLeft size={18} color={colors.textSubtle} />
      </Pressable>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={nextLabel} onPress={onNext} hitSlop={8} style={styles.stepButton}>
        <ChevronRight size={18} color={colors.textSubtle} />
      </Pressable>
      <View style={styles.flex} />
      {right}
    </View>
  );
}

/** 月の送り。 */
export function MonthBar({ monthKey, onChange }: { monthKey: string; onChange: (monthKey: string) => void }) {
  return (
    <Stepper
      label={formatMonthKey(monthKey)}
      prevLabel="前の月"
      nextLabel="次の月"
      onPrev={() => onChange(shiftMonth(monthKey, -1))}
      onNext={() => onChange(shiftMonth(monthKey, 1))}
    />
  );
}

/** 年度の送り（右に期間）。 */
export function YearBar({ fiscalYear, onChange }: { fiscalYear: number; onChange: (fiscalYear: number) => void }) {
  return (
    <Stepper
      label={formatFiscalYear(fiscalYear)}
      prevLabel="前の年度"
      nextLabel="次の年度"
      onPrev={() => onChange(fiscalYear - 1)}
      onNext={() => onChange(fiscalYear + 1)}
      right={
        <Text style={type.faint}>
          {fiscalYear}年4月〜{fiscalYear + 1}年3月
        </Text>
      }
    />
  );
}

/** 振り返りの期間。月か年度。 */
export type ReviewPeriod = 'month' | 'year';

const PERIODS: { id: ReviewPeriod; label: string }[] = [
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
];

/** 振り返りの送り（‹ 2026年10月 ›）。右の「月 / 年」で期間を切り替える（同じ面で月も年も見る）。 */
export function PeriodBar({
  period,
  onPeriod,
  monthKey,
  onMonth,
  fiscalYear,
  onFiscalYear,
}: {
  period: ReviewPeriod;
  onPeriod: (period: ReviewPeriod) => void;
  monthKey: string;
  onMonth: (monthKey: string) => void;
  fiscalYear: number;
  onFiscalYear: (fiscalYear: number) => void;
}) {
  const toggle = (
    <View accessibilityRole="tablist" style={styles.segment}>
      {PERIODS.map((entry) => {
        const selected = entry.id === period;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onPeriod(entry.id)}
            style={[styles.segmentItem, selected && styles.segmentItemSelected]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{entry.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  return period === 'month' ? (
    <Stepper
      label={formatMonthKey(monthKey)}
      prevLabel="前の月"
      nextLabel="次の月"
      onPrev={() => onMonth(shiftMonth(monthKey, -1))}
      onNext={() => onMonth(shiftMonth(monthKey, 1))}
      right={toggle}
    />
  ) : (
    <Stepper
      label={formatFiscalYear(fiscalYear)}
      prevLabel="前の年度"
      nextLabel="次の年度"
      onPrev={() => onFiscalYear(fiscalYear - 1)}
      onNext={() => onFiscalYear(fiscalYear + 1)}
      right={toggle}
    />
  );
}

/** 結論のカード。ラベル・大きな数字・一言、その下に内訳（children）。 */
export function Hero({
  label,
  value,
  minus,
  note,
  children,
}: {
  label: string;
  value: string;
  minus?: boolean;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.heroLabel}>{label}</Text>
      <Text style={[type.hero, minus && type.minus]}>{value}</Text>
      {note !== undefined && <Text style={type.sub}>{note}</Text>}
      {children !== undefined && <View style={styles.heroBody}>{children}</View>}
    </View>
  );
}

/** 内訳の1行（ラベル・小さな補足・金額）。 */
export function StatRow({
  label,
  note,
  noteMinus,
  value,
  minus,
}: {
  label: string;
  note?: string;
  noteMinus?: boolean;
  value: string;
  minus?: boolean;
}) {
  return (
    <View style={styles.statRow}>
      <View style={styles.flex}>
        <Text style={styles.statLabel}>{label}</Text>
        {note !== undefined && <Text style={[type.faint, noteMinus && type.minus]}>{note}</Text>}
      </View>
      <Text style={[type.amount, minus && type.minus]}>{value}</Text>
    </View>
  );
}

/** 区切りの見出し（左に見出しと一言、右に操作）。 */
export function SectionHeader({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={type.title}>{title}</Text>
      {hint !== undefined && <Text style={type.faint}>{hint}</Text>}
      <View style={styles.flex} />
      {right}
    </View>
  );
}

/** 細い進み具合の帯（0〜1）。超えたら淡い赤。 */
export function ProgressBar({ ratio, over }: { ratio: number; over?: boolean }) {
  return (
    <View style={styles.bar}>
      <View
        style={[
          styles.barFill,
          { width: `${Math.max(0, Math.min(1, ratio)) * 100}%` },
          over && { backgroundColor: colors.moneyOverRing },
        ]}
      />
    </View>
  );
}

/** 使った割合の輪。100%を超えたら淡い赤で一周。 */
export function UsageRing({ percent, size = 52 }: { percent: number | null; size?: number }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const over = percent !== null && percent > 100;
  const filled = percent === null ? 0 : Math.min(percent, 100) / 100;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.neutralSurface} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={over ? colors.moneyOverRing : colors.moneyRing}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference * filled} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={[styles.ringText, size < 48 && styles.ringTextSmall, over && type.minus]}>{percent === null ? '−' : `${percent}%`}</Text>
    </View>
  );
}

/** 種類のアイコン（色つきの丸）。key は moneyUtils の MONEY_ICONS。 */
export function CategoryIcon({ iconKey, size = 32 }: { iconKey: string; size?: number }) {
  const tone = iconTone(iconKey);
  const Icon = MONEY_ICON_COMPONENTS[tone.key] ?? MONEY_ICON_COMPONENTS.other;
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: tone.color }]}>
      <Icon size={Math.round(size * 0.55)} color="#ffffff" />
    </View>
  );
}

const TRANSFER_COLOR = '#a8a8a8';

/** 振替のアイコン（Zaim と同じく灰色の丸に白い回る矢印。灰色は Zaim より淡く）。 */
export function TransferIcon({ size = 32 }: { size?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: TRANSFER_COLOR }]}>
      <RefreshCw size={Math.round(size * 0.5)} color="#ffffff" />
    </View>
  );
}

/** 出金元の種類のアイコンと色（Zaim と同じく、財布は緑の豚の貯金箱・口座は青い銀行・カードは緑のカード）。 */
const WALLET_TYPE_ICONS = {
  cash: { Icon: PiggyBank, color: '#4caf50' },
  bank: { Icon: Landmark, color: '#1e78c2' },
  card: { Icon: CreditCard, color: '#1b6b4a' },
  prepaid: { Icon: CreditCard, color: '#5b7a99' },
  qr: { Icon: QrCode, color: '#e53935' },
} as const;

/** 出金元の種類のアイコン（記録の一覧で金額の右に出す。Zaim と同じ）。 */
export function WalletTypeIcon({ type: walletType, size = 15 }: { type: MoneyWalletType; size?: number }) {
  const { Icon, color } = WALLET_TYPE_ICONS[walletType];
  return <Icon size={size} color={color} />;
}

/** 全画面の入力の見出し。close は × 、back は ← 。 */
export function ScreenHeader({
  title,
  onClose,
  icon = 'close',
  right,
}: {
  title: string;
  onClose: () => void;
  icon?: 'close' | 'back';
  right?: ReactNode;
}) {
  const Icon = icon === 'back' ? ArrowLeft : X;
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={icon === 'back' ? '戻る' : '閉じる'}
        onPress={onClose}
        hitSlop={10}
      >
        <Icon size={22} color={colors.textSubtle} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.flex} />
      {right}
    </View>
  );
}

/** 下に固定の大きなボタン（淡い青）。 */
export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.primary, disabled && styles.primaryDisabled]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

/** 見込みの額の印（毎月の記録・カード代金で自動で作り、まだ確かめていない額。docs/kakei.md §3.3）。 */
export function EstimateBadge() {
  return (
    <View style={styles.estimate}>
      <Text style={styles.estimateText}>見込み</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 月 / 年 の切り替え（小さな2択）。
  segment: { flexDirection: 'row', borderRadius: 999, backgroundColor: colors.neutralSurface, padding: 2 },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999 },
  segmentItemSelected: { backgroundColor: colors.surface },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  segmentTextSelected: { fontWeight: '700', color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  stepButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  stepLabel: { fontSize: 17, fontWeight: '700', color: colors.text },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 2,
  },
  heroLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  heroBody: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  statLabel: { fontSize: 14, fontWeight: '600', color: colors.textSubtle },
  section: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 24, marginBottom: 10 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.neutralSurface, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.moneyRing },
  ringText: { fontSize: 11, fontWeight: '700', color: colors.money },
  ringTextSmall: { fontSize: 9 },
  badge: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  primary: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.moneySoft },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { fontSize: 15, fontWeight: '700', color: colors.moneyText },
  estimate: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.moneyEstimateSurface },
  estimateText: { fontSize: 10, fontWeight: '700', color: colors.moneyEstimate },
});
