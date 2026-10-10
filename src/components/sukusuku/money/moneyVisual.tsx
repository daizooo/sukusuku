'use client';

import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, ChartCandlestick, ChevronLeft, ChevronRight, CreditCard, Landmark, PiggyBank, QrCode, RefreshCw, X } from 'lucide-react';
import type { MoneyWalletType } from '@/types/app';
import { useBackLayer } from '@/lib/browserHistory';
import { useBackdropClose } from '../ui/useBackdropClose';
import { swipeBoundary } from '../ui/useSwipeNavigation';
import { formatGainRate, formatMonthKey, formatSignedYen, iconTone, shiftMonth } from '@/lib/moneyUtils';
import { MONEY_ICON_COMPONENTS } from './moneyIcons';
import { formatYear } from '@/lib/specialUtils';

// 家計タブで共通に使う部品と、見た目の決まり（docs/kakei.md §2.1）。
// mobile版の `mobile/src/components/money/moneyVisual.tsx` と同じ見た目。
//
// どの面も「送り（月・年）→ 結論（数字を1つ大きく）→ 内訳 → 明細」の順に並べる。
// 文字は4段（結論の数字 / 見出し / 行 / 補足）に絞り、色は意味のあるところだけ
// （赤＝マイナス・超過、青＝押せるもの）。

/** 文字の大きさと濃さ（4段）。mobile の `type` と同じ値。 */
export const type = {
  /** 結論の数字。 */
  hero: 'text-[34px] leading-tight font-bold text-gray-900 tabular-nums',
  /** 見出し・ラベルの強いもの。 */
  title: 'text-base font-bold text-gray-900',
  /** 行の主（名前）。 */
  row: 'text-[15px] font-semibold text-gray-900',
  /** 行の金額。 */
  amount: 'text-[15px] font-bold text-gray-900 tabular-nums',
  /** 補足（ラベル・内訳の説明）。 */
  sub: 'text-xs font-medium text-gray-500 tabular-nums',
  /** 薄い補足（予算・件数など）。 */
  faint: 'text-[11px] font-medium text-gray-400 tabular-nums',
  /** 押せる文字。 */
  link: 'text-[13px] font-bold text-blue-600',
} as const;

/** マイナス・超過は赤（tailwind の打ち消しを避けるため、色だけ差し替える）。 */
export const minus = (base: string, isMinus: boolean | undefined) =>
  isMinus ? base.replace(/text-gray-\d+/, 'text-red-600') : base;

export const cardClass = 'rounded-2xl border border-gray-200 bg-white';

/** 収入の額の色（明るい緑。green-500 と lime-600 の間）。mobile の colors.moneyIncome と同じ。 */
export const incomeAmountClass = 'text-[#43b02a]';

function Stepper({
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  right,
  centered,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  right?: ReactNode;
  /** 年月を中央に寄せ、right は右端に置く（記録・振り返りの送り）。無いときは左に寄せ、right をその右に並べる。 */
  centered?: boolean;
}) {
  const buttonClass =
    'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';
  return (
    <div className="shrink-0 flex items-center gap-2 py-2.5">
      {/* 中央に寄せるとき、左右を同じ幅（flex-1）にして年月を真ん中に置く。右は端に寄せる。 */}
      {centered ? <span className="flex-1" /> : null}
      <button type="button" aria-label={prevLabel} onClick={onPrev} className={buttonClass}>
        <ChevronLeft size={18} />
      </button>
      {/* 中央に寄せるときは、月の桁数（9月/10月）が変わっても ‹ › の位置が動かないよう幅をそろえる。 */}
      <span className={`text-[17px] font-bold text-gray-900 tabular-nums ${centered ? 'min-w-[104px] text-center' : ''}`}>
        {label}
      </span>
      <button type="button" aria-label={nextLabel} onClick={onNext} className={buttonClass}>
        <ChevronRight size={18} />
      </button>
      {centered ? (
        <div className="flex flex-1 justify-end">{right}</div>
      ) : right ? (
        <>
          <span className="flex-1" />
          {right}
        </>
      ) : null}
    </div>
  );
}

/** 振替のアイコン（Zaim と同じく灰色の丸に白い回る矢印。灰色は Zaim より淡く）。 */
export function TransferIcon({ size = 32 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, backgroundColor: '#a8a8a8' }}
    >
      <RefreshCw size={Math.round(size * 0.5)} />
    </span>
  );
}

/** 出金元の種類のアイコンと色（Zaim と同じく、財布は緑の豚の貯金箱・口座は青い銀行・カードは緑のカード）。 */
const WALLET_TYPE_ICONS = {
  cash: { Icon: PiggyBank, color: '#4caf50' },
  bank: { Icon: Landmark, color: '#1e78c2' },
  card: { Icon: CreditCard, color: '#1b6b4a' },
  prepaid: { Icon: CreditCard, color: '#5b7a99' },
  qr: { Icon: QrCode, color: '#e53935' },
  securities: { Icon: ChartCandlestick, color: '#4aa8d8' },
} as const;

/** 出金元の種類のアイコン（記録の一覧で金額の右に出す。Zaim と同じ）。color は出金元ごとに選んだ色（null は種類ごとの色）。 */
export function WalletTypeIcon({
  type: walletType,
  size = 15,
  color,
}: {
  type: MoneyWalletType;
  size?: number;
  color?: string | null;
}) {
  const { Icon, color: defaultColor } = WALLET_TYPE_ICONS[walletType];
  return <Icon size={size} color={color ?? defaultColor} />;
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
      centered
    />
  );
}

/** 年の送り（右に期間。1月〜12月）。 */
export function YearBar({ year, onChange }: { year: number; onChange: (year: number) => void }) {
  return (
    <Stepper
      label={formatYear(year)}
      prevLabel="前の年"
      nextLabel="次の年"
      onPrev={() => onChange(year - 1)}
      onNext={() => onChange(year + 1)}
      right={<span className={type.faint}>1月〜12月</span>}
    />
  );
}

/** 振り返りの期間。月か年。 */
export type ReviewPeriod = 'month' | 'year';

const PERIODS: { id: ReviewPeriod; label: string }[] = [
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
];

/**
 * 振り返りの送り（‹ 2026年10月 ›）。年月は中央、右端に切り替えのボタンを1つだけ置く（同じ面で月も年も見る）。
 * 最初は月の表示なので「年で見る」だけ、年の表示では「月で見る」だけ（2026-10-10。「月 / 年」の2つ並びをやめ、
 * 文字は今の表示ではなく行き先を示す）。
 */
export function PeriodBar({
  period,
  onPeriod,
  monthKey,
  onMonth,
  year,
  onYear,
}: {
  period: ReviewPeriod;
  onPeriod: (period: ReviewPeriod) => void;
  monthKey: string;
  onMonth: (monthKey: string) => void;
  year: number;
  onYear: (year: number) => void;
}) {
  const other = period === 'month' ? PERIODS[1] : PERIODS[0];
  const switchButton = (
    <button
      type="button"
      aria-label={other.id === 'year' ? '年の表示に切り替える' : '月の表示に切り替える'}
      onClick={() => onPeriod(other.id)}
      className="rounded-full bg-gray-100 px-[9px] py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-200"
    >
      {other.id === 'year' ? '年で見る' : '月で見る'}
    </button>
  );
  return period === 'month' ? (
    <Stepper
      label={formatMonthKey(monthKey)}
      prevLabel="前の月"
      nextLabel="次の月"
      onPrev={() => onMonth(shiftMonth(monthKey, -1))}
      onNext={() => onMonth(shiftMonth(monthKey, 1))}
      right={switchButton}
      centered
    />
  ) : (
    <Stepper
      label={formatYear(year)}
      prevLabel="前の年"
      nextLabel="次の年"
      onPrev={() => onYear(year - 1)}
      onNext={() => onYear(year + 1)}
      right={switchButton}
      centered
    />
  );
}

/** 結論のカード。ラベル・大きな数字・一言、その下に内訳（children）。 */
export function Hero({
  label,
  value,
  isMinus,
  note,
  center,
  compact,
  plus,
  children,
}: {
  label: string;
  value: string;
  isMinus?: boolean;
  /** プラスの額（明るい緑）。 */
  plus?: boolean;
  note?: ReactNode;
  /** ラベルと数字を中央に寄せる（総残高など）。 */
  center?: boolean;
  /** 余白と数字を少し詰める（口座の面。1画面に収めるため）。 */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`${cardClass} ${compact ? 'px-4 pb-2.5 pt-2' : 'p-4'} ${center ? 'text-center' : ''}`}>
      <p className="text-[13px] font-semibold text-gray-500">{label}</p>
      <p className={minus(plus ? (compact ? type.hero.replace('text-[34px]', 'text-[32px]') : type.hero).replace('text-gray-900', incomeAmountClass) : compact ? type.hero.replace('text-[34px]', 'text-[32px]') : type.hero, isMinus)}>{value}</p>
      {note !== undefined && <p className={type.sub}>{note}</p>}
      {children !== undefined && <div className={`${compact ? 'mt-1.5' : 'mt-3 pt-1'} border-t border-gray-200`}>{children}</div>}
    </div>
  );
}

/** 内訳の1行（ラベル・小さな補足・金額）。 */
export function StatRow({
  label,
  note,
  noteMinus,
  value,
  isMinus,
  plus,
  compact,
}: {
  label: string;
  note?: string;
  noteMinus?: boolean;
  value: string;
  isMinus?: boolean;
  /** プラスの額（明るい緑）。 */
  plus?: boolean;
  /** 余白を詰め、金額を大きく太くする（振り返りの面）。 */
  compact?: boolean;
}) {
  const amount = compact ? 'text-[18px] font-extrabold text-gray-900 tabular-nums' : type.amount;
  return (
    <div className={`flex items-center gap-2 ${compact ? 'py-1' : 'py-2'}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-700">{label}</p>
        {note !== undefined && <p className={minus(type.faint, noteMinus)}>{note}</p>}
      </div>
      <span className={minus(plus ? amount.replace('text-gray-900', incomeAmountClass) : amount, isMinus)}>{value}</span>
    </div>
  );
}

/** 区切りの見出し（左に見出しと一言、右に操作）。 */
export function SectionHeader({
  title,
  hint,
  right,
  compact,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
  /** 上下の余白を詰める（振り返りの面）。 */
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? 'mt-3.5 mb-1.5' : 'mt-6 mb-2.5'} flex items-baseline gap-1.5`}>
      <h3 className={type.title}>{title}</h3>
      {hint !== undefined && <span className={type.faint}>{hint}</span>}
      <span className="flex-1" />
      {right}
    </div>
  );
}

/** 細い進み具合の帯（0〜1）。超えたら淡い赤。 */
export function ProgressBar({ ratio, over }: { ratio: number; over?: boolean }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
      <div
        className={`h-1.5 rounded-full ${over ? 'bg-red-300' : 'bg-blue-300'}`}
        style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
      />
    </div>
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
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#f3f4f6" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={over ? '#fca5a5' : '#93c5fd'}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference * filled} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`relative font-bold tabular-nums ${size < 48 ? 'text-[9px]' : 'text-[11px]'} ${over ? 'text-red-600' : 'text-blue-600'}`}>
        {percent === null ? '−' : `${percent}%`}
      </span>
    </div>
  );
}

/** 種類のアイコン（色つきの丸）。key は moneyUtils の MONEY_ICONS。 */
export function CategoryIcon({ iconKey, size = 32 }: { iconKey: string; size?: number }) {
  const tone = iconTone(iconKey);
  const Icon = MONEY_ICON_COMPONENTS[tone.key] ?? MONEY_ICON_COMPONENTS.other;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: tone.color, color: '#ffffff' }}
    >
      <Icon size={Math.round(size * 0.55)} />
    </span>
  );
}

/** 見込みの額の印（毎月の記録・カード代金で自動で作り、まだ確かめていない額。docs/kakei.md §3.3）。 */
export function EstimateBadge() {
  return (
    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">見込み</span>
  );
}

/**
 * 全画面の入力の枠。戻る操作（ブラウザ・スマホ）で onBack を呼ぶ。
 * 横幅の広い画面（タブレット・PC）で両脇に出る暗い部分を押しても onBack を呼ぶ。
 */
export function FullScreen({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  useBackLayer(onBack);
  const backdropClose = useBackdropClose(onBack);
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/30" {...backdropClose} {...swipeBoundary}>
      <div className="relative flex h-full w-full max-w-md flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}

/**
 * 全画面の中で重ねる画面（品目・種類の選択など）。開いている間だけ戻る操作で閉じる層を積む。
 * 記録の詳細の上に重ねて出し、戻る操作では一番上の画面だけを閉じる。
 */
export function StackedScreen({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  useBackLayer(onBack);
  return <div className="flex min-h-0 flex-1 flex-col bg-white">{children}</div>;
}

/**
 * 評価損益（証券。docs/kakei.md §9.2.4）。矢印と色で上げ下げを見せる（上げ＝緑、下げ＝赤）。
 * 「+¥12,345（+3.21%）」。rate が無ければ金額だけ。mobile の `Gain` と同じ。
 */
export function Gain({ gain, rate, size = 'row' }: { gain: number; rate: number | null; size?: 'row' | 'sub' }) {
  const up = gain >= 0;
  const color = gain === 0 ? 'text-gray-500' : up ? incomeAmountClass : 'text-red-600';
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const base = (size === 'row' ? type.amount : type.sub).replace(/text-gray-\d+/, '');
  return (
    <span className={`inline-flex items-center gap-0.5 ${color}`}>
      <Icon size={size === 'row' ? 16 : 13} />
      <span className={base}>
        {formatSignedYen(gain)}
        {rate !== null ? `（${formatGainRate(rate)}）` : ''}
      </span>
    </span>
  );
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
    <div className="shrink-0 flex items-center gap-3.5 border-b border-gray-200 px-4 py-3.5">
      <button type="button" aria-label={icon === 'back' ? '戻る' : '閉じる'} onClick={onClose} className="text-gray-700">
        <Icon size={22} />
      </button>
      <h3 className="text-lg font-bold text-gray-900">{title}</h3>
      <span className="flex-1" />
      {right}
    </div>
  );
}

/** 下に固定の大きなボタン（淡い青）。 */
export function PrimaryButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl bg-blue-100 py-3.5 text-[15px] font-bold text-blue-800 hover:bg-blue-200 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
