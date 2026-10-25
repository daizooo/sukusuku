import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronRight, Plus } from 'lucide-react-native';
import type { FamilyMember, MoneyCategory, MoneyMonthWalletCheck, MoneyRecord, MoneyWallet, MoneyWalletBalance } from '@/types/app';
import type { CardMonthChecks } from '@/lib/moneyFeedUtils';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { formatBalance, formatYen } from '@/lib/moneyUtils';
import { allOk, closeFigure, closeFigureLabel, closeRecords, closeWallets, okUsers } from '@/lib/moneyClose';
import RecordDayList, { type RecordClosing } from '@/components/money/RecordDayList';
import BalanceSheet from '@/components/money/BalanceSheet';
import { PrimaryButton, ScreenHeader, WalletTypeIcon, fitText } from '@/components/money/moneyVisual';

// 月の締め（docs/kakei.md §4.5。2026-10-24に作り直した）。PWA版の `src/components/sukusuku/money/MonthCloseScreen.tsx` と同じ並び・文言。
//
// 締めは、銀行口座・カード・家族の財布のそれぞれについて、その月の入出金を振り返りながら、残高（カードはその月の利用残高）が
// 合っているかを夫婦で確かめる作業。収支は出さない（締めたあとの月の振り返りで見る）。
// - 開くのは、振り返りの「この月を締める」を夫婦が5分以内に押したとき（MoneyReviewView）
// - いちばん上に「片づけるもの n件」（未確認の明細と、今月記録予定の固定費。押すと未確定明細の一覧）
// - 口座の一覧: 口座ごとに名前・額・右端のチェック（夫婦がふたりとも OK するとチェックが入る）。注釈は付けない
// - 口座を押すと詳細: 上に額と、夫婦それぞれの「OK」ボタン（自分の分だけ押せる）。下にその月の記録（月の初めから）。
//   抜けている入出金は右下の「＋ 記録を追加」で足す（出金元はこの口座）。記録を直しても合わないときは、額を押して残高を補正する
//   （カードはその月の利用の合計なので補正は無い。記録で合わせる）。見込みの記録には「確定」、利用通知と額が違う記録には注意を添える
// - OK は押したときの額を持つ。記録を足す・直す・補正して額が変わると、その口座の OK は外れる
// - 「この月を締める」は、すべての口座で夫婦がふたりとも OK したときだけ押せる

interface MonthCloseScreenProps {
  monthKey: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  balances: MoneyWalletBalance[];
  /** 今日（YYYY-MM-DD）。銀行・財布は今日の残高で照合する。 */
  today: string;
  /** 口座ごとの OK。 */
  checks: MoneyMonthWalletCheck[];
  /** 締めに加わる人（夫婦）。 */
  guardians: FamilyMember[];
  /** 自分（アカウントの id）。 */
  userId: string;
  /** 片づけるもの（その月の未確認の明細と、今月記録予定の固定費）の件数。 */
  todoCount: number;
  /** カードの記録を利用通知と見比べるための一覧（利用通知を取り込んでいるときだけ。docs/kakei.md §4.7）。 */
  cardChecks: CardMonthChecks | null;
  closed: boolean;
  /** 締めた日時（締めた月だけ）。 */
  closedAt: string | null;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  /** 記録を足す（出金元はこの口座、日はその日）。 */
  onAddRecord: (walletId: string, date: string) => void;
  /** 残高を補正する（口座の面の「残高を補正」と同じ）。 */
  onSaveBalance: (walletId: string, adjustment: number, amount: number, showInHistory: boolean) => void;
  /** 自分の OK を押す（amount はそのときの額）／外す（null）。 */
  onSetCheck: (walletId: string, amount: number | null) => void;
  onOpenFeed: () => void;
  onCloseMonth: () => void;
  onReopenMonth: () => void;
  /** 締めの途中をやめる（口座の OK は残す）。 */
  onAbortMonth: () => void;
  onClose: () => void;
}

const closedDateLabel = (closedAt: string) => {
  const date = new Date(closedAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

/** 記録を足すときの日。過ぎた月はその月の末日、今月は今日。 */
const addDateOf = (monthKey: string, today: string) => {
  if (today.startsWith(monthKey)) return today;
  const [year, month] = monthKey.split('-').map(Number);
  return `${monthKey}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
};

export default function MonthCloseScreen({
  monthKey,
  records,
  categories,
  wallets,
  balances,
  today,
  checks,
  guardians,
  userId,
  todoCount,
  cardChecks,
  closed,
  closedAt,
  onConfirmEstimate,
  onOpenRecord,
  onAddRecord,
  onSaveBalance,
  onSetCheck,
  onOpenFeed,
  onCloseMonth,
  onReopenMonth,
  onAbortMonth,
  onClose,
}: MonthCloseScreenProps) {
  const insets = useSafeAreaInsets();
  const label = `${Number(monthKey.slice(5, 7))}月`;
  const [openId, setOpenId] = useState<string | null>(null);
  const confirmAbort = () =>
    Alert.alert('締めを中断しますか？', '口座の OK は残ります。もう一度、夫婦で「この月を締める」を押すと続きから締められます。', [
      { text: '戻る', style: 'cancel' },
      { text: '中断する', onPress: onAbortMonth },
    ]);

  // 口座ごとの額と、今の額のまま OK している人。
  const rows = useMemo(
    () =>
      closeWallets(wallets).map((wallet) => {
        const figure = closeFigure(wallet, records, balances, monthKey, today);
        const ok = okUsers(checks, monthKey, wallet.id, figure);
        return { wallet, figure, ok, done: allOk(ok, guardians) };
      }),
    [wallets, records, balances, monthKey, today, checks, guardians],
  );
  const allDone = rows.length > 0 && rows.every((row) => row.done);
  const opened = rows.find((row) => row.wallet.id === openId) ?? null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title={`${label}の締め`} icon="back" onClose={onClose} />
        <ScrollView contentContainerStyle={styles.content}>
          {todoCount > 0 && (
            <Pressable accessibilityRole="button" onPress={onOpenFeed} style={({ pressed }) => [styles.todo, pressed && styles.pressed]}>
              <Text style={[styles.todoText, styles.flex]}>片づけるもの {todoCount}件</Text>
              <ChevronRight size={16} color={colors.textMuted} />
            </Pressable>
          )}
          <View style={styles.list}>
            {rows.map((row, index) => (
              <Pressable
                key={row.wallet.id}
                accessibilityRole="button"
                onPress={() => setOpenId(row.wallet.id)}
                style={({ pressed }) => [styles.walletRow, index > 0 && styles.divided, pressed && styles.pressed]}
              >
                <WalletTypeIcon type={row.wallet.type} size={20} color={row.wallet.iconColor} />
                <Text style={[styles.walletName, styles.flex]} numberOfLines={1}>
                  {row.wallet.name}
                </Text>
                <Text {...fitText} style={[styles.walletAmount, row.figure < 0 && styles.minus]}>{formatBalance(row.figure)}</Text>
                <View
                  accessibilityLabel={row.done ? '確認済み' : '未確認'}
                  style={[styles.tick, row.done && styles.tickOn]}
                >
                  {row.done && <Check size={14} color={colors.surface} strokeWidth={3} />}
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          {closed ? (
            <>
              <Text style={styles.closedNote}>{closedAt ? `${closedDateLabel(closedAt)}に締めました` : '締めた月です'}</Text>
              <Pressable accessibilityRole="button" onPress={onReopenMonth} style={styles.secondary}>
                <Text style={styles.reopenText}>締めを外す</Text>
              </Pressable>
            </>
          ) : (
            <>
              <PrimaryButton label="この月を締める" onPress={onCloseMonth} disabled={!allDone} />
              <Pressable accessibilityRole="button" onPress={confirmAbort} style={styles.secondary}>
                <Text style={styles.abortText}>締めを中断する</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
      {opened && (
        <WalletCloseScreen
          wallet={opened.wallet}
          figure={opened.figure}
          ok={opened.ok}
          monthKey={monthKey}
          today={today}
          records={records}
          categories={categories}
          wallets={wallets}
          balances={balances}
          guardians={guardians}
          userId={userId}
          cardChecks={cardChecks}
          locked={closed}
          onConfirmEstimate={onConfirmEstimate}
          onOpenRecord={onOpenRecord}
          onAddRecord={() => onAddRecord(opened.wallet.id, addDateOf(monthKey, today))}
          onSaveBalance={(adjustment, amount, showInHistory) => onSaveBalance(opened.wallet.id, adjustment, amount, showInHistory)}
          onSetCheck={(amount) => onSetCheck(opened.wallet.id, amount)}
          onClose={() => setOpenId(null)}
        />
      )}
    </Modal>
  );
}

interface WalletCloseScreenProps {
  wallet: MoneyWallet;
  figure: number;
  ok: ReadonlySet<string>;
  monthKey: string;
  today: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  balances: MoneyWalletBalance[];
  guardians: FamilyMember[];
  userId: string;
  cardChecks: CardMonthChecks | null;
  /** 締めた月（OK・確定・記録の追加はできない）。 */
  locked: boolean;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  onAddRecord: () => void;
  onSaveBalance: (adjustment: number, amount: number, showInHistory: boolean) => void;
  onSetCheck: (amount: number | null) => void;
  onClose: () => void;
}

/** 締めの、口座の詳細。上に額と夫婦それぞれの OK、下にその月の記録。 */
function WalletCloseScreen({
  wallet,
  figure,
  ok,
  monthKey,
  today,
  records,
  categories,
  wallets,
  balances,
  guardians,
  userId,
  cardChecks,
  locked,
  onConfirmEstimate,
  onOpenRecord,
  onAddRecord,
  onSaveBalance,
  onSetCheck,
  onClose,
}: WalletCloseScreenProps) {
  const insets = useSafeAreaInsets();
  const [adjusting, setAdjusting] = useState(false);
  // 確定を押した記録（読み直しが届くまで、二度押せないように）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const shown = useMemo(() => closeRecords(wallet, records, monthKey), [wallet, records, monthKey]);
  // 補正できるのは残高を照合する口座だけ（カードはその月の利用の合計なので、記録で合わせる）。
  const canAdjust = wallet.type !== 'card' && !locked;

  // 利用通知と額が違う記録（記録の id → 注意の文言）。
  const notes = useMemo(() => {
    const map = new Map<string, string>();
    for (const { record, feedAmount } of cardChecks?.mismatched ?? []) {
      map.set(record.id, `利用通知は ${formatYen(feedAmount)}。額が違います`);
    }
    return map;
  }, [cardChecks]);

  const closing: RecordClosing = {
    locked,
    onConfirm: (record) => {
      setConfirming(record.id);
      void onConfirmEstimate(record).finally(() => setConfirming(null));
    },
    busyId: confirming,
    notes,
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title={wallet.name} icon="back" onClose={onClose} />
        <ScrollView contentContainerStyle={[styles.content, styles.detailContent]}>
          <View style={styles.figureCard}>
            <Text style={styles.figureLabel}>{closeFigureLabel(wallet, monthKey, today)}</Text>
            <Pressable
              accessibilityRole={canAdjust ? 'button' : undefined}
              accessibilityLabel={canAdjust ? '残高を補正' : undefined}
              disabled={!canAdjust}
              onPress={() => setAdjusting(true)}
            >
              <Text {...fitText} style={[styles.figure, figure < 0 && styles.minus]}>{formatBalance(figure)}</Text>
            </Pressable>
            <View style={styles.people}>
              {guardians.map((member) => {
                const on = ok.has(member.id);
                const mine = member.id === userId;
                return (
                  <Pressable
                    key={member.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${member.name} OK`}
                    accessibilityState={{ selected: on, disabled: !mine || locked }}
                    disabled={!mine || locked}
                    onPress={() => onSetCheck(on ? null : figure)}
                    style={[styles.person, on && styles.personOn, !mine && !on && styles.personOther]}
                  >
                    <Text style={[styles.personName, on && styles.personNameOn]} numberOfLines={1}>
                      {member.name}
                    </Text>
                    <Text style={[styles.personState, on && styles.personStateOn]}>{on ? 'OK ✓' : 'OK'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.listTitle}>{`${Number(monthKey.slice(5, 7))}月の記録`}</Text>
          {shown.length === 0 ? (
            <Text style={styles.message}>この月の記録はありません</Text>
          ) : (
            <RecordDayList records={shown} categories={categories} wallets={wallets} onOpen={onOpenRecord} closing={closing} oldestFirst />
          )}
        </ScrollView>
        {!locked && (
          <Pressable
            accessibilityRole="button"
            onPress={onAddRecord}
            style={({ pressed }) => [styles.fab, { bottom: 20 + insets.bottom }, pressed && styles.fabPressed]}
          >
            <Plus size={18} color={colors.surface} strokeWidth={2.6} />
            <Text style={styles.fabText}>記録を追加</Text>
          </Pressable>
        )}
      </View>
      {adjusting && (
        <BalanceSheet
          wallet={wallet}
          records={records}
          balances={balances}
          onClose={() => setAdjusting(false)}
          onSubmit={(adjustment, amount, showInHistory) => {
            onSaveBalance(adjustment, amount, showInHistory);
            setAdjusting(false);
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 8 },
  // 右下の「記録を追加」に一覧の最後が隠れないように。
  detailContent: { paddingBottom: 96 },
  pressed: { backgroundColor: colors.background },
  todo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.moneyEstimateSurface,
  },
  todoText: { fontSize: 13, fontWeight: '600', color: colors.moneyEstimate },
  list: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: colors.surface },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  walletName: { fontSize: 15, fontWeight: '700', color: colors.text },
  walletAmount: { fontSize: 15, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  minus: { color: colors.text },
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.moneyIncome, borderColor: colors.moneyIncome },
  figureCard: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, gap: 4 },
  figureLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  figure: { fontSize: 32, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  people: { flexDirection: 'row', gap: 10, marginTop: 8 },
  person: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  personOn: { borderColor: colors.moneyIncome, backgroundColor: colors.moneyIncome },
  personOther: { backgroundColor: colors.neutralSurface, borderColor: colors.neutralSurface },
  personName: { fontSize: 14, fontWeight: '700', color: colors.text },
  personNameOn: { color: colors.surface },
  personState: { fontSize: 13, fontWeight: '700', color: colors.moneyText },
  personStateOn: { color: colors.surface },
  listTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 8 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  fab: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: colors.money,
    elevation: 4,
  },
  fabPressed: { opacity: 0.85 },
  fabText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  closedNote: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  abortText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  reopenText: { fontSize: 13, fontWeight: '700', color: colors.danger },
});
