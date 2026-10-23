import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { MoneyCategory, MoneyFeedItem, MoneyRecord, MoneyWallet } from '@/types/app';
import type { MoneyFeedFill, MoneyFeedResolve } from '@/lib/api/moneyFeed';
import { formatDateWithWeekday, toDateString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { formatYen, recordTotal, type PendingEstimate } from '@/lib/moneyUtils';
import { feedAmountLabel, feedDayLabel, feedStatusLabel, feedStoreName, sortFeedInbox } from '@/lib/moneyFeedUtils';
import SheetModal from '@/components/ui/SheetModal';
import LogModalShell from '@/components/log/LogModalShell';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';
import { Chip, ChipRow, Field, ToggleRow, WalletChoices } from '@/components/money/feedParts';

// 取り込んだ明細の「未確認」（docs/kakei.md §9.5.5・§9.5.6.1）。PWA版の `src/components/sukusuku/money/MoneyFeedInbox.tsx` と同じ並び・文言。
//
// 記録の面の上の帯「未確定明細 n件」と、月の締めから開く（2026-10-21。docs/kakei.md §0.7）。見出しは「Gmail から取り込んだ明細」と、
// 締めから開いたときだけ「今月記録予定の固定費」（2026-10-23。§0.8）。
// 一覧にボタンは置かない。行を押すと中（下から開く画面）で片づける。
// Gmail の明細は、手入力との確認 → 口座が決まっていない → 未確認 → 読めない の順。
// 1件を押すと片づけ方を選ぶ枠: 口座を選ぶ／手入力と同じか（同じ取引・振替に置き換える・別の取引）／
// 記録を作成する・記録しない。記録を作成するは、額・日付・出金元・お店を入れた記録の入力を開く（カテゴリは人が選ぶ。2026-10-19）。
// 今月記録予定の固定費（自動記録オフの固定費で、その月に記録が無い回。scheduledFixedInMonth）は、中で額を直して
// 「この額で記録する」「翌月へ送る」「今月はなし」。

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
  /** 今月記録予定の固定費（締めから開いたときだけ）。 */
  estimates: PendingEstimate[];
  /** この額で記録する（出金元があればその場で記録、無ければ記録の入力を開く）。 */
  onRecordEstimate: (entry: PendingEstimate, amount: number) => void;
  /** 翌月へ送る（翌月の締めに出す）。 */
  onDeferEstimate: (entry: PendingEstimate) => Promise<boolean>;
  /** 今月はなし（その回を出さない）。 */
  onSkipEstimate: (entry: PendingEstimate) => Promise<boolean>;
  onClose: () => void;
}

const estimateKey = (entry: PendingEstimate) => `${entry.rule.id}|${entry.plannedMonth}`;

/** 見込みの名前（品名、無ければカテゴリの名前）。 */
const estimateName = (entry: PendingEstimate, categories: MoneyCategory[]) =>
  entry.rule.name.trim() || categories.find((category) => category.id === entry.rule.categoryId)?.name || '見込み';

export default function MoneyFeedInbox({
  items,
  wallets,
  records,
  categories,
  onRecord,
  onResolve,
  onFill,
  estimates,
  onRecordEstimate,
  onDeferEstimate,
  onSkipEstimate,
  onClose,
}: MoneyFeedInboxProps) {
  const insets = useSafeAreaInsets();
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(() => sortFeedInbox(items), [items]);
  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? null;
  const opened = items.find((item) => item.id === openId) ?? null;
  const [estimateOpen, setEstimateOpen] = useState<string | null>(null);
  const openedEstimate = estimates.find((entry) => estimateKey(entry) === estimateOpen) ?? null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title={`未確定明細 ${items.length + estimates.length}件`} icon="back" onClose={onClose} />
        <ScrollView contentContainerStyle={styles.content}>
          {sorted.length === 0 && estimates.length === 0 && <Text style={styles.empty}>未確定の明細はありません</Text>}
          {sorted.length > 0 && <Text style={styles.section}>Gmail から取り込んだ明細</Text>}
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
          {estimates.length > 0 && <Text style={[styles.section, sorted.length > 0 && styles.sectionGap]}>今月記録予定の固定費</Text>}
          {estimates.map((entry) => (
            <Pressable
              key={estimateKey(entry)}
              accessibilityRole="button"
              onPress={() => setEstimateOpen(estimateKey(entry))}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text style={styles.account} numberOfLines={1}>
                  {estimateName(entry, categories)}
                </Text>
                <Text style={styles.description} numberOfLines={1}>
                  {feedDayLabel(entry.date)}
                  {walletName(entry.rule.walletId) ? `・${walletName(entry.rule.walletId)}` : ''}
                </Text>
              </View>
              <Text style={styles.badge}>{entry.rule.amountMode === 'estimate' ? '見込み' : '確定'}</Text>
              <Text style={styles.amount}>{formatYen(entry.amount)}</Text>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {openedEstimate && (
        <EstimateSheet
          key={estimateKey(openedEstimate)}
          entry={openedEstimate}
          name={estimateName(openedEstimate, categories)}
          wallets={wallets}
          categories={categories}
          onClose={() => setEstimateOpen(null)}
          onRecord={(amount) => {
            setEstimateOpen(null);
            onRecordEstimate(openedEstimate, amount);
          }}
          onDefer={async () => {
            if (await onDeferEstimate(openedEstimate)) setEstimateOpen(null);
          }}
          onSkip={async () => {
            if (await onSkipEstimate(openedEstimate)) setEstimateOpen(null);
          }}
        />
      )}
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
          {item.amazonOrderId
            ? '記録を作成するを押すと、額・日付（注文日）・出金元・お店と、注文の品目を入れた記録の入力を開きます。値引きは品目に配ってあります。カテゴリの決まっていない品目を選んで保存してください。'
            : '記録を作成するを押すと、額・日付・出金元・お店を入れた記録の入力を開きます。カテゴリを選んで保存してください。'}
          記録しないときは、残高がずれたら口座の詳細から補正してください。
        </Text>
      </LogModalShell>
    </SheetModal>
  );
}

/** 見込みの中: カテゴリ・日・出金元と額（直せる）。この額で記録する／翌月へ送る／今月はなし。 */
function EstimateSheet({
  entry,
  name,
  wallets,
  categories,
  onClose,
  onRecord,
  onDefer,
  onSkip,
}: {
  entry: PendingEstimate;
  name: string;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  onClose: () => void;
  onRecord: (amount: number) => void;
  onDefer: () => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [amountText, setAmountText] = useState(String(entry.amount));
  const [busy, setBusy] = useState(false);
  const amount = Number(amountText.replace(/[^0-9]/g, ''));
  const category = categories.find((item) => item.id === entry.rule.categoryId);
  const parent = category?.parentId ? categories.find((item) => item.id === category.parentId) : undefined;
  const wallet = wallets.find((item) => item.id === entry.rule.walletId);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={name}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="この額で記録する" disabled={busy || amount <= 0} onPress={() => onRecord(amount)} />
            <View style={styles.estimateActions}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(onDefer)} style={styles.estimateButton}>
                <Text style={styles.secondaryText}>翌月へ送る</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(onSkip)} style={styles.estimateButton}>
                <Text style={styles.secondaryText}>今月はなし</Text>
              </Pressable>
            </View>
          </>
        }
      >
        <View style={styles.detail}>
          <DetailRow label="カテゴリ" value={category ? (parent ? `${parent.name} › ${category.name}` : category.name) : '—'} />
          <DetailRow label="日" value={feedDayLabel(entry.date)} />
          <DetailRow label="出金元" value={wallet?.name ?? '記録の入力で選ぶ'} />
        </View>
        <Field label="金額（円）">
          <TextInput
            style={styles.input}
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </Field>
        {entry.plannedMonth !== entry.date.slice(0, 7) && (
          <Text style={styles.hint}>{Number(entry.plannedMonth.slice(5, 7))}月の分で、まだ記録がありません。</Text>
        )}
      </LogModalShell>
    </SheetModal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
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
  section: { fontSize: 13, fontWeight: '800', color: colors.textSubtle },
  sectionGap: { marginTop: 8 },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.milkBadgeText,
    backgroundColor: colors.milkBadge,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  detail: { borderRadius: 12, backgroundColor: colors.neutralSurface, paddingHorizontal: 12 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  detailLabel: { fontSize: 14, fontWeight: '600', color: colors.textSubtle },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '700', color: colors.text },
  estimateActions: { flexDirection: 'row', gap: 8 },
  estimateButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  secondaryText: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
});
