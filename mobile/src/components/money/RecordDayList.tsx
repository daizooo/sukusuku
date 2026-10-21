import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ClipboardList, Plus, Scale } from 'lucide-react-native';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { colors } from '@/lib/theme';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  formatBalance,
  formatYen,
  groupItems,
  groupRecordsByDay,
  iconKeyOf,
  isFixedEstimate,
  itemSummary,
  recordTotal,
  topCategoryIdOf,
  type BalanceCheck,
} from '@/lib/moneyUtils';
import { CategoryIcon, EstimateBadge, NextPeriodBadge, TransferIcon, WalletTypeIcon } from '@/components/money/moneyVisual';

// 記録を日ごと（新しい日から）に並べる一覧（docs/kakei.md §2.1）。家計タブの「記録」と、口座の詳細の「履歴」で同じものを使う。
// PWA版の `src/components/sukusuku/money/RecordDayList.tsx` と同じ並び・文言。
// Zaim の履歴と同じ作り（2026-10-15）。左に日付（土曜は青・日曜は赤）と縦の時間軸、右に1件1枚のカード。
// 日の見出しは「支出 その日の合計」と、その日に記録を足す「＋」（onAddOnDate があるときだけ）。
// カードは、金額を一番大きく左上に、出金元の種類のアイコンを右上に。次に「小分類 @ お店」（大分類は時間軸の丸のアイコンで分かる）、
// 最後にメモのアイコンをつけた品名の要約（「牛乳、卵ほか」）。振替は回る矢印の丸で、「振替 出金元 → 入金先」。
// 毎月の記録・カード代金で自動で作り、まだ額を確かめていないものは金額の右に「見込み」（§3.3）。
// 口座の履歴では、残高の補正（corrections）も同じ日の先頭に1件のカードで混ぜる（その日の終わりの残高なので）。押すと取り消しの確認。
// 補正のカードは、総額が画面の上にあるので「差」だけを出す（はじめの残高だけは差が無いので、その額）。
// スクロールは持たない（親のスクロールの中に置く）。

interface RecordDayListProps {
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  onOpen: (record: MoneyRecord) => void;
  /** 口座の履歴に混ぜる、残高の補正。 */
  corrections?: BalanceCheck[];
  onOpenCorrection?: (check: BalanceCheck) => void;
  /** 日の見出しの「＋」を押したとき、その日（YYYY-MM-DD）で記録を足す。無ければ「＋」は出さない。 */
  onAddOnDate?: (date: string) => void;
  /** 月の締めの画面で、各カードにチェックボックスを出す（docs/kakei.md §4.5）。 */
  closing?: RecordClosing;
  /** 古い日から（月の初めから）並べる。月の締めで使う。無ければ新しい日から。 */
  oldestFirst?: boolean;
}

const dayLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日（${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]}）`;
};

/** 左の日付の列の2行（10/15 と (木)）と、曜日の色（土＝青・日＝赤）。 */
const dateParts = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return {
    main: `${month}/${day}`,
    week: `(${WEEKDAY_LABELS[weekday]})`,
    color: weekday === 0 ? colors.sunday : weekday === 6 ? colors.navActive : undefined,
  };
};

/** 1日ぶん（日の見出しと、その日の記録・補正のカード）。長い一覧を仮想化して並べるときに、1行として使う。 */
export interface RecordDay {
  date: string;
  records: MoneyRecord[];
  corrections: BalanceCheck[];
}

/**
 * 月の締めの画面で、見込みの記録に「確定」を出すための指定（docs/kakei.md §4.5。2026-10-16）。
 * 「確定」は今の額のまま確定する。額が違うものは、カードを押して記録の詳細で直す。
 */
export interface RecordClosing {
  /** 締めた月は、確定できない。 */
  locked: boolean;
  onConfirm: (record: MoneyRecord) => void;
  /** 確定の処理中の記録（二度押せないように）。 */
  busyId: string | null;
  /** カードの下に添える注意（記録の id → 文言。カードの利用通知と額が違うものなど）。 */
  notes: ReadonlyMap<string, string>;
}

interface RecordDayBlockProps {
  day: RecordDay;
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  onOpen: (record: MoneyRecord) => void;
  onOpenCorrection?: (check: BalanceCheck) => void;
  onAddOnDate?: (date: string) => void;
  closing?: RecordClosing;
}

/** 月の締めのカードの右上。見込みの記録だけ「確定」を出す。 */
function ClosingControl({ record, closing }: { record: MoneyRecord; closing: RecordClosing }) {
  if (!isFixedEstimate(record)) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="この額で確定する"
      disabled={closing.locked || closing.busyId !== null}
      onPress={() => closing.onConfirm(record)}
      hitSlop={6}
      style={[styles.confirm, closing.busyId === record.id && styles.confirmBusy]}
    >
      <Text style={styles.confirmText}>確定</Text>
    </Pressable>
  );
}

export const RecordDayBlock = memo(function RecordDayBlock({
  day,
  categories,
  wallets,
  onOpen,
  onOpenCorrection,
  onAddOnDate,
  closing,
}: RecordDayBlockProps) {
  const walletOf = (id: string | null) => wallets.find((wallet) => wallet.id === id) ?? null;
  const walletName = (id: string | null) => walletOf(id)?.name ?? '';

  const describe = (record: MoneyRecord) => {
    if (record.kind === 'transfer') {
      return {
        icon: null,
        title: `振替　${walletName(record.walletId) || '?'} → ${walletName(record.toWalletId) || '?'}`,
        sub: '',
      };
    }
    const groups = groupItems(record.items);
    const first = groups[0];
    const top = first?.categoryId ? topCategoryIdOf(categories, first.categoryId) : null;
    // 小分類だけ（大分類はアイコンで分かる）。
    const firstTitle = first?.categoryId
      ? (categories.find((category) => category.id === first.categoryId)?.name ?? '')
      : (first?.categoryName ?? '');
    const title = groups.length > 1 ? `${firstTitle} ほか` : firstTitle;
    return {
      icon: top ? iconKeyOf(categories.find((category) => category.id === top)) : 'star',
      title: record.store.trim() !== '' ? `${title} @ ${record.store.trim()}` : title,
      sub: itemSummary(record.items),
    };
  };

  /** カードの右上に出す出金元のアイコン（振替は出金元と入金先）。 */
  const walletIcons = (record: MoneyRecord) =>
    (record.kind === 'transfer' ? [record.walletId, record.toWalletId] : [record.walletId])
      .map(walletOf)
      .filter((wallet): wallet is MoneyWallet => wallet !== null);

  const spent = day.records
    .filter((record) => record.kind === 'expense')
    .flatMap((record) => record.items)
    .reduce((sum, item) => sum + item.amount, 0);
  const date = dateParts(day.date);
  return (
    <View style={styles.day}>
      <View style={styles.row}>
        <View style={styles.dateCol}>
          <Text style={[styles.dateMain, date.color !== undefined && { color: date.color }]}>{date.main}</Text>
          <Text style={[styles.dateWeek, date.color !== undefined && { color: date.color }]}>{date.week}</Text>
        </View>
        <View style={styles.axis}>
          <View style={styles.line} />
          <View style={styles.dot} />
        </View>
        <View style={styles.head}>
          <Text style={styles.headText}>
            支出　<Text style={styles.headSum}>{formatYen(spent)}</Text>
          </Text>
          {onAddOnDate && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${dayLabel(day.date)}に記録を追加`}
              onPress={() => onAddOnDate(day.date)}
              hitSlop={8}
              style={styles.plus}
            >
              <Plus size={20} color={colors.textSubtle} />
            </Pressable>
          )}
        </View>
      </View>
      {day.corrections.map((check) => (
        <View key={check.balance.id} style={styles.row}>
          <View style={styles.dateCol} />
          <View style={styles.axis}>
            <View style={styles.line} />
            <View style={styles.circle}>
              <View style={styles.correctionIcon}>
                <Scale size={18} color="#ffffff" />
              </View>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="残高の補正"
            onPress={() => onOpenCorrection?.(check)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.top}>
              <Text style={[styles.amount, check.diff !== null && check.diff > 0 && styles.income]}>
                {formatBalance(check.diff === null ? check.balance.amount : check.diff)}
              </Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {check.diff === null ? 'はじめの残高' : '残高を補正'}
            </Text>
          </Pressable>
        </View>
      ))}
      {day.records.map((record) => {
        const { icon, title, sub } = describe(record);
        const total = recordTotal(record);
        return (
          <View key={record.id} style={styles.row}>
            <View style={styles.dateCol} />
            <View style={styles.axis}>
              <View style={styles.line} />
              <View style={styles.circle}>
                {icon === null ? <TransferIcon size={36} /> : <CategoryIcon iconKey={icon} size={36} />}
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpen(record)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <View style={styles.top}>
                <Text style={[styles.amount, record.kind === 'transfer' && styles.muted, record.kind === 'income' && styles.income]}>
                  {formatYen(total)}
                </Text>
                {isFixedEstimate(record) && <EstimateBadge />}
                {record.cardNextPeriod && <NextPeriodBadge />}
                <View style={styles.flex} />
                <View style={styles.walletIcons}>
                  {walletIcons(record).map((wallet, iconIndex) => (
                    <WalletTypeIcon key={`${wallet.id}-${iconIndex}`} type={wallet.type} size={16} color={wallet.iconColor} />
                  ))}
                </View>
                {closing && (
                  <ClosingControl record={record} closing={closing} />
                )}
              </View>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {closing?.notes.get(record.id) !== undefined && (
                <Text style={styles.note} numberOfLines={2}>
                  {closing.notes.get(record.id)}
                </Text>
              )}
              {sub !== '' && (
                <View style={styles.memo}>
                  <ClipboardList size={14} color={colors.textSubtle} />
                  <Text style={styles.memoText} numberOfLines={1}>
                    {sub}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
});

export default function RecordDayList({
  records,
  categories,
  wallets,
  onOpen,
  corrections = [],
  onOpenCorrection,
  onAddOnDate,
  closing,
  oldestFirst = false,
}: RecordDayListProps) {
  // 記録のある日と補正のある日を合わせて、新しい日から（oldestFirst なら古い日から。日の中の並びも逆にする）。
  const recordDays = groupRecordsByDay(records);
  const dates = [...new Set([...recordDays.map((day) => day.date), ...corrections.map((check) => check.balance.balanceOn)])].sort(
    (a, b) => (oldestFirst ? a.localeCompare(b) : b.localeCompare(a)),
  );
  const days = dates.map((date) => {
    const dayRecords = recordDays.find((day) => day.date === date)?.records ?? [];
    return {
      date,
      records: oldestFirst ? [...dayRecords].reverse() : dayRecords,
      corrections: corrections.filter((check) => check.balance.balanceOn === date),
    };
  });

  return (
    <>
      {days.map((day) => (
        <RecordDayBlock
          key={day.date}
          day={day}
          categories={categories}
          wallets={wallets}
          onOpen={onOpen}
          onOpenCorrection={onOpenCorrection}
          onAddOnDate={onAddOnDate}
          closing={closing}
        />
      ))}
    </>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  day: { marginTop: 4 },
  // 日の見出しも、カードも、「日付の列 | 時間軸 | 右の中身」の3列の行。時間軸の線は、行ごとに上から下まで引いてつなぐ。
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  dateCol: { width: 42, paddingTop: 6 },
  // 数字を出す Text は fontWeight を必ず付ける（CLAUDE.md）。
  dateMain: { fontSize: 12, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  dateWeek: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  axis: { width: 40, alignItems: 'center', alignSelf: 'stretch' },
  line: { position: 'absolute', top: 0, bottom: 0, left: 19, width: 2, backgroundColor: colors.borderStrong },
  dot: { marginTop: 12, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.borderStrong },
  circle: { marginTop: 10 },
  head: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginLeft: 6 },
  headText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  headSum: { fontSize: 13, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  plus: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  card: {
    flex: 1,
    marginLeft: 6,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  walletIcons: { flexDirection: 'row', gap: 4, minWidth: 16 },
  // 補正の行のアイコン（振替と同じ大きさの、青みの灰の丸に白い天びん）。
  correctionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5b7a99' },
  // 金額は大きく極太（収入は緑・支出は黒。符号はつけない）。「小分類 @ お店」は中くらい、メモは濃いめ。
  amount: { fontSize: 21, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  title: { marginTop: 1, fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  memo: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 6 },
  memoText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  pressed: { backgroundColor: colors.background },
  // 月の締め: 見込みの「確定」・カードの下の注意。
  confirm: { marginLeft: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.moneyEstimateSurface },
  confirmBusy: { opacity: 0.5 },
  confirmText: { fontSize: 13, fontWeight: '700', color: colors.moneyEstimate },
  note: { marginTop: 4, fontSize: 12, fontWeight: '600', color: colors.moneyEstimate },
  muted: { color: colors.textMuted },
  // 収入の額は緑（支出と見分けがつくように）。
  income: { color: colors.moneyIncome },
});
