import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { MoneyCategory, MoneyFeedItem, MoneyRecord, MoneyWallet } from '@/types/app';
import type { MoneyFeedFill, MoneyFeedResolve } from '@/lib/api/moneyFeed';
import { formatDateWithWeekday, toDateString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { formatYen, recordTotal } from '@/lib/moneyUtils';
import { feedAmountLabel, feedDayLabel, feedStatusLabel, feedStoreName, sortFeedInbox } from '@/lib/moneyFeedUtils';
import SheetModal from '@/components/ui/SheetModal';
import LogModalShell from '@/components/log/LogModalShell';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';
import { Chip, ChipRow, Field, ToggleRow, WalletChoices } from '@/components/money/feedParts';

// 取り込んだ明細の「未確認」（docs/kakei.md §9.5.5・§9.5.6.1）。PWA版の `src/components/sukusuku/money/MoneyFeedInbox.tsx` と同じ並び・文言。
//
// 「口座」の面の上の「未確認 n件」から開く。手入力との確認 → 口座が決まっていない → 未確認 → 読めない の順。
// 1件を押すと片づけ方を選ぶ枠: 口座を選ぶ／手入力と同じか（同じ取引・振替に置き換える・別の取引）／
// 記録を作成する・記録しない。記録を作成するは、額・日付・出金元・お店を入れた記録の入力を開く（カテゴリは人が選ぶ。2026-10-19）。

interface MoneyFeedInboxProps {
  items: MoneyFeedItem[];
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  categories: MoneyCategory[];
  /** 記録を作成する: 額・日付・出金元・お店を入れた記録の入力を開く。保存したら、その記録とこの明細を結ぶ。 */
  onRecord: (item: MoneyFeedItem) => void;
  onResolve: (item: MoneyFeedItem, resolve: MoneyFeedResolve) => Promise<boolean>;
  /** 読めないメールに、口座・向き・日付・額を手で入れる。入れたあとは未確認として続けて片づける。 */
  onFill: (item: MoneyFeedItem, fill: MoneyFeedFill) => Promise<boolean>;
  onClose: () => void;
}

export default function MoneyFeedInbox({
  items,
  wallets,
  records,
  categories,
  onRecord,
  onResolve,
  onFill,
  onClose,
}: MoneyFeedInboxProps) {
  const insets = useSafeAreaInsets();
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(() => sortFeedInbox(items), [items]);
  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? null;
  const opened = items.find((item) => item.id === openId) ?? null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title={`未確認 ${items.length}件`} icon="back" onClose={onClose} />
        <ScrollView contentContainerStyle={styles.content}>
          {sorted.length === 0 && <Text style={styles.empty}>未確認の明細はありません</Text>}
          {sorted.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => setOpenId(item.id)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <View style={styles.rowTop}>
                  <Text style={[styles.status, item.status === 'confirm' && styles.statusConfirm]}>{feedStatusLabel(item)}</Text>
                  <Text style={styles.date}>{feedDayLabel(item.occurredOn)}</Text>
                </View>
                <Text style={styles.account} numberOfLines={1}>
                  {walletName(item.walletId) ?? item.accountName ?? item.subject}
                </Text>
                {item.description !== '' && (
                  <Text style={styles.description} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}
              </View>
              <Text style={[styles.amount, item.direction === 'in' && styles.amountIn]}>{feedAmountLabel(item)}</Text>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {opened && (
        <FeedItemSheet
          key={opened.id}
          item={opened}
          wallets={wallets}
          records={records}
          categories={categories}
          onClose={() => setOpenId(null)}
          onRecord={() => {
            setOpenId(null);
            onRecord(opened);
          }}
          onResolve={async (resolve) => {
            if (await onResolve(opened, resolve)) setOpenId(null);
          }}
          onFill={async (fill) => {
            // 入れたあとも片づいていなければ、同じ明細の枠を開いたまま次の片づけ方を選ぶ
            await onFill(opened, fill);
          }}
        />
      )}
    </Modal>
  );
}

function FeedItemSheet({
  item,
  wallets,
  records,
  categories,
  onClose,
  onRecord,
  onResolve,
  onFill,
}: {
  item: MoneyFeedItem;
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  categories: MoneyCategory[];
  onClose: () => void;
  onRecord: () => void;
  onResolve: (resolve: MoneyFeedResolve) => Promise<void>;
  onFill: (fill: MoneyFeedFill) => Promise<void>;
}) {
  // 読めないメールの手入力（口座・向き・日付・額）
  const [fillDirection, setFillDirection] = useState<'in' | 'out'>('out');
  const [fillOn, setFillOn] = useState(() => toDateString(new Date(item.receivedAt)));
  const [fillAmount, setFillAmount] = useState('');
  const [walletId, setWalletId] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '—';
  const candidates = useMemo(() => records.filter((record) => item.candidateRecordIds.includes(record.id)), [records, item]);

  const run = async (resolve: MoneyFeedResolve) => {
    if (busy) return;
    setBusy(true);
    try {
      await onResolve(resolve);
    } finally {
      setBusy(false);
    }
  };

  const summary = (
    <View style={styles.summary}>
      <Text style={styles.summaryAmount}>{feedAmountLabel(item)}</Text>
      <Text style={styles.summaryLine}>
        {feedDayLabel(item.occurredOn)}　{item.accountName ?? ''}
      </Text>
      {item.description !== '' && <Text style={styles.summaryDescription}>{item.description}</Text>}
    </View>
  );

  // 読めないメール: 件名を見ながら、口座・向き・日付・額を手で入れる（入れると未確認として突き合わせる）。記録しないこともできる
  if (item.status === 'unreadable' || item.direction === null) {
    const amount = Number(fillAmount.replace(/[^0-9]/g, ''));
    const canFill = !busy && walletId !== null && amount > 0;
    const fill = async () => {
      if (!canFill || walletId === null) return;
      setBusy(true);
      try {
        await onFill({ walletId, direction: fillDirection, occurredOn: fillOn, amount });
      } finally {
        setBusy(false);
      }
    };
    const openDate = () =>
      DateTimePickerAndroid.open({
        value: new Date(`${fillOn}T00:00:00`),
        mode: 'date',
        onChange: (_event, picked) => {
          if (picked) setFillOn(toDateString(picked));
        },
      });
    return (
      <SheetModal visible onClose={onClose}>
        <LogModalShell
          title="読めないメール"
          onClose={onClose}
          footer={
            <>
              <PrimaryButton label="この内容で取り込む" disabled={!canFill} onPress={() => void fill()} />
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void run({ action: 'ignore', learn: false })}
                style={styles.secondary}
              >
                <Text style={styles.secondaryText}>記録しない</Text>
              </Pressable>
            </>
          }
        >
          <Text style={styles.summaryDescription}>{item.subject}</Text>
          <Text style={styles.hint}>
            メールの形が違い、日付・額・口座を読めませんでした。件名を見て入れると、ほかの明細と同じく振替・自動の記録・手入力と突き合わせます。
          </Text>
          <Field label="向き">
            <ChipRow>
              <Chip label="出金" selected={fillDirection === 'out'} onPress={() => setFillDirection('out')} />
              <Chip label="入金" selected={fillDirection === 'in'} onPress={() => setFillDirection('in')} />
            </ChipRow>
          </Field>
          <Field label="日付">
            <Pressable accessibilityRole="button" onPress={openDate} style={styles.select}>
              <Text style={styles.selectText}>{formatDateWithWeekday(new Date(`${fillOn}T00:00:00`))}</Text>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>
          </Field>
          <Field label="金額（円）">
            <TextInput
              style={styles.input}
              value={fillAmount}
              onChangeText={setFillAmount}
              placeholder="例: 20000"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
            />
          </Field>
          <Field label="口座">
            <WalletChoices wallets={wallets} selectedId={walletId} onPick={setWalletId} />
          </Field>
        </LogModalShell>
      </SheetModal>
    );
  }

  // 口座が決まっていない: 口座を選ぶ
  if (item.walletId === null) {
    return (
      <SheetModal visible onClose={onClose}>
        <LogModalShell
          title="口座を選ぶ"
          onClose={onClose}
          footer={
            <PrimaryButton
              label="この口座にする"
              disabled={walletId === null || busy}
              onPress={() => walletId && void run({ action: 'wallet', walletId, remember })}
            />
          }
        >
          {summary}
          <WalletChoices wallets={wallets} selectedId={walletId} onPick={setWalletId} />
          <ToggleRow label={`次から「${item.accountName ?? ''}」はこの口座`} value={remember} onChange={setRemember} />
        </LogModalShell>
      </SheetModal>
    );
  }

  // 手入力と同じか確認（§9.5.5）
  if (item.status === 'confirm') {
    const paired = item.pairId !== null;
    return (
      <SheetModal visible onClose={onClose}>
        <LogModalShell
          title="手入力と同じ取引ですか"
          onClose={onClose}
          footer={
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void run({ action: 'separate' })}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>{paired ? '別の取引（新しく振替を作る）' : '別の取引'}</Text>
            </Pressable>
          }
        >
          {summary}
          {paired && <Text style={styles.hint}>この明細は、ほかの口座の明細と組になった振替です。</Text>}
          {candidates.length === 0 && <Text style={styles.hint}>当たった手入力の記録が見つかりません（消されたかもしれません）。</Text>}
          {candidates.map((record) => (
            <View key={record.id} style={styles.candidate}>
              <RecordLine record={record} walletName={walletName} categories={categories} />
              <View style={styles.candidateActions}>
                {(!paired || record.kind === 'transfer') && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void run({ action: 'link', recordId: record.id, learn: false })}
                    style={styles.candidateButton}
                  >
                    <Text style={styles.candidateButtonText}>同じ取引</Text>
                  </Pressable>
                )}
                {paired && record.kind !== 'transfer' && (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || record.items.length !== 1}
                      onPress={() => void run({ action: 'replace', recordId: record.id })}
                      style={styles.candidateButton}
                    >
                      <Text style={styles.candidateButtonText}>振替に置き換える</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void run({ action: 'link', recordId: record.id, learn: false })}
                      style={styles.candidateButton}
                    >
                      <Text style={styles.candidateButtonText}>手入力を残す</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          ))}
        </LogModalShell>
      </SheetModal>
    );
  }

  // 未確認: 記録を作成する（額・日付・出金元・お店を入れた記録の入力を開く）・記録しない。
  // 同じお店でも買うものでカテゴリが変わるので、カテゴリはここで決めず、記録の入力で選ぶ（品目を分けてもよい。2026-10-19）
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={walletName(item.walletId)}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="記録を作成する" disabled={busy} onPress={onRecord} />
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void run({ action: 'ignore', learn: false })}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>記録しない</Text>
            </Pressable>
          </>
        }
      >
        {summary}
        {feedStoreName(item) !== '' && <Text style={styles.store}>お店: {feedStoreName(item)}</Text>}
        <Text style={styles.hint}>
          記録を作成するを押すと、額・日付・出金元・お店を入れた記録の入力を開きます。カテゴリを選んで保存してください。記録しないときは、残高がずれたら口座の詳細から補正してください。
        </Text>
      </LogModalShell>
    </SheetModal>
  );
}

/** 記録を1行で（日付・カテゴリ・出金元・額）。 */
function RecordLine({
  record,
  walletName,
  categories,
}: {
  record: MoneyRecord;
  walletName: (id: string | null) => string;
  categories: MoneyCategory[];
}) {
  const kindLabel = record.kind === 'transfer' ? '振替' : record.kind === 'income' ? '収入' : '支出';
  const category = record.items[0]?.categoryId ? categories.find((entry) => entry.id === record.items[0].categoryId)?.name : null;
  const where =
    record.kind === 'transfer' ? `${walletName(record.walletId)} → ${walletName(record.toWalletId)}` : walletName(record.walletId);
  return (
    <View style={styles.recordLine}>
      <View style={styles.flex}>
        <Text style={styles.recordTitle} numberOfLines={1}>
          {feedDayLabel(record.occurredOn)}　{kindLabel}
          {category ? `・${category}` : ''}
          {record.isEstimate ? '（見込み）' : ''}
        </Text>
        <Text style={styles.recordSub} numberOfLines={1}>
          {where}
          {record.store !== '' ? `・${record.store}` : ''}
        </Text>
      </View>
      <Text style={styles.recordAmount}>{formatYen(recordTotal(record))}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: 16, gap: 8, paddingBottom: 32 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.neutralSurface },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { fontSize: 11, fontWeight: '700', color: colors.moneyText },
  statusConfirm: { color: colors.moneyOver },
  date: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  account: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 2 },
  description: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  amountIn: { color: colors.moneyIncome },
  summary: { gap: 2 },
  summaryAmount: { fontSize: 22, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  summaryLine: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  store: { fontSize: 14, fontWeight: '700', color: colors.text },
  summaryDescription: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: colors.textMuted },
  hint: { fontSize: 12, fontWeight: '500', lineHeight: 18, color: colors.textMuted },
  candidate: { gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  candidateActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  candidateButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.moneySoft },
  candidateButtonText: { fontSize: 13, fontWeight: '700', color: colors.moneyText },
  recordLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  recordSub: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  recordAmount: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectText: { fontSize: 15, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  secondary: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
});
