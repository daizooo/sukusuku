import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ArrowRight, CalendarDays, Camera, Plus, Square, SquareCheck, Store, Trash2, X } from 'lucide-react-native';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyRecordKind,
  MoneyStore,
  MoneyWallet,
  MoneyWalletDraft,
  ReceiptScan,
  ReceiptScanItem,
} from '@/types/app';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { formatDateWithYear, toDateString } from '@/lib/dateUtils';
import {
  canCardNextPeriod,
  categoryPath,
  editorGroupTotal,
  evaluateCalc,
  formatBalance,
  formatCalc,
  formatMonthKey,
  formatYen,
  groupsFromItems,
  groupsFromScan,
  iconKeyOf,
  itemsFromGroups,
  lastWalletId,
  monthKeyOf,
  pressCalcKey,
  recordTotal,
  storeChoices,
  RECORD_KIND_LABEL,
  topCategoryIdOf,
  type EditorGroup,
} from '@/lib/moneyUtils';
import Calculator from '@/components/money/Calculator';
import CategoryPicker, { type CategoryChoice } from '@/components/money/CategoryPicker';
import ItemsScreen, { addWorkGroup, blankLine, changeWorkGroup, groupsFromWork, type ItemsWork } from '@/components/money/ItemsScreen';
import StorePicker from '@/components/money/StorePicker';
import WalletPicker from '@/components/money/WalletPicker';
import RecordDetailView from '@/components/money/RecordDetailView';
import RecordItemGroups from '@/components/money/RecordItemGroups';
import { EstimateBadge, PrimaryButton, ScreenHeader, WalletTypeIcon } from '@/components/money/moneyVisual';

// 記録の入力（docs/kakei.md §3.2。Zaim を踏襲）。PWA版の `src/components/sukusuku/money/RecordEditor.tsx` と同じ流れ・文言。
//
// 既にある記録は、まず記録の詳細（読むだけ。RecordDetailView）を見せ、「編集する」でこの入力画面へ（2026-10-15）。
// 「＋」→ 記録の編集（支出／収入／振替・日付・出金元・お店・翌月に回す・品目）→ 品目を押す／「＋」→ カテゴリの選択 → 品目
// （電卓は品目の金額を押すと出る）。出金元・お店はそれぞれ選ぶ画面へ。品目はカテゴリごとにまとめて1行で見せ、合計は品目から自動。
// 品目の画面は記録の品目を全部カテゴリごとに並べ、別のカテゴリもそこで足して一度に保存する（2026-10-20）。
// 振替は 出金元 → 入金先 と金額だけ。置かないもの: 電話番号・時刻・タグ・写真。
//
// 画面は全部この1つの全画面の中で重ねる（戻る操作で1つ前の画面へ）。品目の書きかけは、
// カテゴリの選択へ行って戻っても残る。
//
// 見込みの額の記録（毎月の記録・カード代金で自動で作ったもの。§3.3）は、額を直すと確定になる。
// 額が合っていたときは「この額で確定する」。額を変えずに保存したときは見込みのまま。

type Screen =
  | { type: 'edit' }
  | { type: 'items' }
  | { type: 'category'; purpose: 'add' }
  | { type: 'category'; purpose: 'change'; groupKey: string }
  | { type: 'wallet'; field: 'walletId' | 'toWalletId' }
  | { type: 'store' }
  | { type: 'amount' };

const KINDS: MoneyRecordKind[] = ['expense', 'income', 'transfer'];

let groupSeq = 0;
const newGroupKey = () => `group-${(groupSeq += 1)}`;

export interface RecordEditorProps {
  /** 直す記録。新しく記録するなら null。 */
  record: MoneyRecord | null;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  /** 登録したお店（設定データ）。お店の選択画面で先に出す。 */
  stores: MoneyStore[];
  records: MoneyRecord[];
  onClose: () => void;
  onSubmit: (draft: MoneyRecordDraft) => void;
  onDelete: (record: MoneyRecord) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onDeleteWallet: (wallet: MoneyWallet) => void;
  onEditCategories: () => void;
  /**
   * レシートの読み取りの結果。あれば、その内容を入れた新しい記録として開く（docs/kakei.md §10.4）。
   * 既にある記録（record）と一緒に渡すと、出金元・日付はそのままで、品目をレシートの品目に入れ替えて開く（§10.8）。
   */
  receipt?: ReceiptScan | null;
  /** 既にある記録にレシートを撮って品目を入れる（支出・収入の記録だけ。§10.8）。 */
  onScanReceipt?: (record: MoneyRecord) => void;
  /** 新しく記録するときに最初に選んでおく種類（ホーム画面のウィジェットの「収入」「振替」から。docs/widgets.md §2.3）。 */
  initialKind?: MoneyRecordKind;
  /** 新しく記録するときに最初に選んでおく日（YYYY-MM-DD。記録の一覧の、日の見出しの「＋」から）。無ければ今日。 */
  initialDate?: string | null;
  /** 新しく記録するときに最初に選んでおく出金元（口座のID）と、お店（Gmail 取り込みの未確認の「記録を作成する」から。docs/kakei.md §9.5.6.1）。 */
  initialWallet?: string | null;
  initialStore?: string;
  /** 新しく記録するときに最初に入れておく額（カテゴリの決まっていない1行にする。Gmail 取り込みの未確認の「記録を作成する」から）。 */
  initialAmount?: number | null;
  /** 新しく記録するときに最初に入れておく品目（Amazon の注文メールの明細の「記録を作成する」から。docs/kakei.md §9.10）。 */
  initialItems?: ReceiptScanItem[] | null;
}

/**
 * 自動で作った記録の作り元の言い方（「◯◯から」。分からないときは空）。削除した固定項目の記録は作り元が外れるので、言わない。
 */
function autoRecordSource(record: MoneyRecord, wallets: MoneyWallet[]): string {
  if (record.recurringId !== null) return record.kind === 'income' ? '固定収入から' : '固定支出から';
  const toCard = record.kind === 'transfer' && wallets.some((wallet) => wallet.id === record.toWalletId && wallet.type === 'card');
  return toCard ? 'カード代金から' : '';
}

export default function RecordEditor({
  record,
  categories,
  budgets,
  wallets,
  stores,
  records,
  onClose,
  onSubmit,
  onDelete,
  onSaveWallet,
  onDeleteWallet,
  onEditCategories,
  receipt = null,
  onScanReceipt,
  initialKind = 'expense',
  initialDate = null,
  initialWallet = null,
  initialStore = '',
  initialAmount = null,
  initialItems = null,
}: RecordEditorProps) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<MoneyRecordKind>(record?.kind ?? (receipt ? 'expense' : initialKind));
  const [occurredOn, setOccurredOn] = useState(record?.occurredOn ?? receipt?.occurredOn ?? initialDate ?? toDateString(new Date()));
  // レシートから出金元が当たらなかったときは、前回の出金元を入れて「確かめてください」を出す（§10.4）。
  const [initialWalletId] = useState<string | null>(() =>
    record ? record.walletId : (receipt?.walletId ?? initialWallet ?? lastWalletId(records, wallets, receipt ? 'expense' : initialKind)),
  );
  const [walletId, setWalletId] = useState<string | null>(initialWalletId);
  const [toWalletId, setToWalletId] = useState<string | null>(record?.toWalletId ?? null);
  const [store, setStore] = useState(record?.store || receipt?.store || initialStore);
  // お店の選択で「お店に登録して使う」を選んだか（保存のときにお店の設定に登録する。docs/kakei.md §3.5）。
  const [registerStore, setRegisterStore] = useState(false);
  const [groups, setGroups] = useState<EditorGroup[]>(() =>
    receipt && record?.kind !== 'transfer'
      ? groupsFromScan(receipt.items, newGroupKey)
      : record && record.kind !== 'transfer'
        ? groupsFromItems(record.items, newGroupKey)
        : !record && initialItems !== null && initialItems.length > 0
          ? groupsFromScan(initialItems, newGroupKey)
          : !record && initialAmount !== null && initialAmount > 0
          ? [
              {
                key: newGroupKey(),
                categoryId: null,
                categoryName: '',
                lines: [{ key: newGroupKey(), name: '', quantity: 1, unitPrice: initialAmount, memo: '' }],
              },
            ]
          : [],
  );
  const [transferAmount, setTransferAmount] = useState(() =>
    record?.kind === 'transfer' ? record.items.reduce((sum, item) => sum + item.amount, 0) : 0,
  );
  const [amountExpr, setAmountExpr] = useState('');
  const [stack, setStack] = useState<Screen[]>([{ type: 'edit' }]);
  // 既にある記録を開いたときは、読むだけの詳細から（レシートを当てるときは入力画面から）。
  const [viewing, setViewing] = useState(record !== null && receipt === null);
  const [work, setWork] = useState<ItemsWork | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // カードの引き落としを翌月分に回す（カードで25日以降の記録だけ。docs/kakei.md §3.4）。
  const [cardNextPeriod, setCardNextPeriod] = useState(record?.cardNextPeriod ?? false);

  const screen = stack[stack.length - 1];
  const push = (next: Screen) => setStack((prev) => [...prev, next]);
  const pop = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const replaceTop = (next: Screen) => setStack((prev) => [...prev.slice(0, -1), next]);

  const monthKey = monthKeyOf(occurredOn);
  const storeOptions = useMemo(() => storeChoices(stores, records), [stores, records]);
  const total = kind === 'transfer' ? transferAmount : groups.reduce((sum, group) => sum + editorGroupTotal(group), 0);
  const categoryKind = kind === 'income' ? 'income' : 'expense';
  // 見込みのままか。額を直すか「この額で確定する」で確定になる。
  const stillEstimate = record?.isEstimate === true && !confirmed && total === recordTotal(record);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const nextPeriodShown = canCardNextPeriod(kind, wallets.find((wallet) => wallet.id === walletId), occurredOn);

  /** まとまりの見出し（「食費 › 食料品」「医療費 › 病院」）。 */
  const groupTitle = (target: Pick<EditorGroup, 'categoryId' | 'categoryName'>) =>
    target.categoryId !== null
      ? categoryPath(categories, target.categoryId)
      : target.categoryName || (receipt || initialAmount !== null ? 'カテゴリを選んでください' : '');

  // レシートの読み取りで、保存の前に確かめてほしいこと（§10.4・§10.5）。
  const receiptNotices = receipt
    ? [
        total !== receipt.receiptTotal &&
          `レシートの合計 ${formatYen(receipt.receiptTotal)} と ${formatYen(total - receipt.receiptTotal)} 違います`,
        !record && receipt.walletId === null && walletId === initialWalletId && '出金元を確かめてください（レシートから分かりませんでした）',
        groups.some((group) => group.categoryId === null && group.categoryName === '') && 'カテゴリの決まっていない品目があります',
      ].filter((notice): notice is string => typeof notice === 'string')
    : [];

  /** まとまりのアイコン（大分類のアイコン）。 */
  const groupIconKey = (target: Pick<EditorGroup, 'categoryId'>) => {
    if (target.categoryId === null) return 'receipt';
    const topId = topCategoryIdOf(categories, target.categoryId);
    return iconKeyOf(categories.find((category) => category.id === topId));
  };

  const changeKind = (next: MoneyRecordKind) => {
    if (next === kind) return;
    const apply = () => {
      setKind(next);
      setGroups([]);
      setTransferAmount(0);
      if (walletId === null) setWalletId(lastWalletId(records, wallets, next));
    };
    if (groups.length > 0 || transferAmount > 0) {
      Alert.alert(`${RECORD_KIND_LABEL[next]}に切り替えますか？`, '入れた品目は消えます。', [
        { text: 'やめる', style: 'cancel' },
        { text: '切り替える', onPress: apply },
      ]);
    } else {
      apply();
    }
  };

  const openDate = () =>
    DateTimePickerAndroid.open({
      value: new Date(`${occurredOn}T00:00:00`),
      mode: 'date',
      onChange: (_event, picked) => {
        if (picked) setOccurredOn(toDateString(picked));
      },
    });

  /** 品目の画面を開く（記録のまとまりを全部持って行き、押したまとまりを見せる）。 */
  const openGroup = (group: EditorGroup) => {
    setWork({
      groups: groups.map((entry) => (entry.key === group.key && entry.lines.length === 0 ? { ...entry, lines: [blankLine()] } : entry)),
      selected: null,
      expr: '',
      focus: group.key,
      calc: false,
    });
    push({ type: 'items' });
  };

  /** カテゴリを選んだ（カテゴリの追加、または品目の画面でまとまりのカテゴリを変えた）。 */
  const pickCategory = (choice: CategoryChoice, target: Screen) => {
    const picked = { categoryId: choice.categoryId, categoryName: '' };
    if (target.type === 'category' && target.purpose === 'change') {
      if (work) setWork(changeWorkGroup(work, target.groupKey, picked));
      pop();
      return;
    }
    if (work) {
      // 品目の画面の「カテゴリを追加」から。品目の画面へ戻る。
      setWork(addWorkGroup(work, picked, newGroupKey()));
      pop();
      return;
    }
    // 記録の編集の「＋」から。品目の画面を開く。
    setWork(addWorkGroup({ groups, selected: null, expr: '', focus: null, calc: false }, picked, newGroupKey()));
    replaceTop({ type: 'items' });
  };

  const saveWork = () => {
    if (!work) return;
    setGroups(groupsFromWork(work));
    setWork(null);
    pop();
  };

  const submit = () => {
    if (kind === 'transfer') {
      if (walletId === null || toWalletId === null) return Alert.alert('出金元と入金先を選んでください');
      if (walletId === toWalletId) return Alert.alert('出金元と入金先が同じです');
      if (transferAmount <= 0) return Alert.alert('金額を入れてください');
    }
    const items =
      kind === 'transfer'
        ? [
            {
              amount: transferAmount,
              categoryId: null,
              categoryName: '',
              quantity: 1,
              unitPrice: transferAmount,
              name: '',
              memo: '',
            },
          ]
        : itemsFromGroups(groups);
    if (items.length === 0) return Alert.alert('品目を入れてください', '「品目を追加する」からカテゴリを選びます。');
    // 取り込んだ明細から入れた額は、カテゴリを選ぶまで保存しない（docs/kakei.md §9.5.6.1）
    if (initialAmount !== null && groups.some((group) => group.categoryId === null && group.categoryName === '')) return Alert.alert('カテゴリを選んでください');
    // 品目はマイナスも入れられるが、記録の合計はマイナスにしない（docs/kakei.md §10.5。DB でも確かめる）。
    if (total < 0) return Alert.alert('合計がマイナスです', '値引きの行の金額を確かめてください。');
    onSubmit({
      id: record?.id ?? null,
      kind,
      occurredOn,
      walletId,
      toWalletId: kind === 'transfer' ? toWalletId : null,
      store: kind === 'transfer' ? '' : store,
      registerStore: kind !== 'transfer' && store !== '' && registerStore,
      isEstimate: stillEstimate,
      cardNextPeriod: nextPeriodShown && cardNextPeriod,
      items,
      ...(receipt && kind !== 'transfer' && { receiptStore: receipt.receiptStore }),
    });
  };

  const confirmDelete = () => {
    if (!record) return;
    Alert.alert('この記録を消しますか？', undefined, [
      { text: 'やめる', style: 'cancel' },
      { text: '消す', style: 'destructive', onPress: () => onDelete(record) },
    ]);
  };

  const back = () => {
    // 品目の画面で電卓の枠を出していれば、まずそれを閉じる。
    if (screen.type === 'items' && work?.calc) {
      setWork({ ...work, calc: false });
      return;
    }
    if (stack.length > 1) {
      if (screen.type === 'items') setWork(null);
      pop();
    } else {
      onClose();
    }
  };

  const renderScreen = () => {
    switch (screen.type) {
      case 'items':
        if (!work) return null;
        return (
          <ItemsScreen
            work={work}
            onChange={setWork}
            title={groupTitle}
            iconKey={groupIconKey}
            onChangeCategory={(groupKey) => push({ type: 'category', purpose: 'change', groupKey })}
            onAddCategory={() => push({ type: 'category', purpose: 'add' })}
            onSave={saveWork}
            onClose={back}
          />
        );
      case 'category':
        return (
          <CategoryPicker
            kind={categoryKind}
            categories={categories}
            onPick={(choice) => pickCategory(choice, screen)}
            onClose={back}
            onEditCategories={onEditCategories}
          />
        );
      case 'wallet':
        return (
          <WalletPicker
            title={screen.field === 'toWalletId' ? '入金先を選ぶ' : kind === 'income' ? '入金先を選ぶ' : '出金元を選ぶ'}
            wallets={wallets}
            selectedId={screen.field === 'toWalletId' ? toWalletId : walletId}
            onPick={(id) => {
              if (screen.field === 'toWalletId') setToWalletId(id);
              else setWalletId(id);
              pop();
            }}
            onClose={back}
            onSave={onSaveWallet}
            onDelete={onDeleteWallet}
          />
        );
      case 'store':
        return (
          <StorePicker
            value={store}
            registered={storeOptions.registered}
            recent={storeOptions.recent}
            others={storeOptions.others}
            canRegister
            onPick={(value, register) => {
              setStore(value);
              setRegisterStore(register);
              pop();
            }}
            onClose={back}
          />
        );
      case 'amount':
        return (
          <View style={styles.screen}>
            <ScreenHeader title="金額" icon="back" onClose={back} />
            <View style={styles.amountBox}>
              {/[+\-*/]/.test(amountExpr) && <Text style={styles.amountExpr}>{formatCalc(amountExpr)} =</Text>}
              <Text style={styles.amountValue}>{formatYen(evaluateCalc(amountExpr) ?? 0)}</Text>
            </View>
            <Calculator onKey={(key) => setAmountExpr((prev) => pressCalcKey(prev, key))} />
            <View style={styles.footer}>
              <PrimaryButton
                label="決める"
                onPress={() => {
                  setTransferAmount(evaluateCalc(amountExpr) ?? 0);
                  pop();
                }}
              />
            </View>
          </View>
        );
      default:
        return viewing && record ? renderView(record) : renderEdit();
    }
  };

  // 日付の上の案内（見込みの額・自動で作った記録）。詳細・編集の両方に出す。
  const notices = (editable: boolean) => (
    <>
      {record?.isEstimate && (
        <View style={styles.estimate}>
          <View style={styles.estimateHead}>
            {stillEstimate && <EstimateBadge />}
            <Text style={[styles.estimateText, styles.flex]}>
              {stillEstimate
                ? editable
                  ? '見込みの額です。検針票・明細などを見て額を直すと確定します'
                  : '見込みの額です。編集で額を直すと確定します'
                : '保存すると確定します'}
            </Text>
          </View>
          {editable && stillEstimate && (
            <Pressable accessibilityRole="button" onPress={() => setConfirmed(true)} hitSlop={8}>
              <Text style={styles.estimateLink}>この額で確定する</Text>
            </Pressable>
          )}
        </View>
      )}
      {record?.month && (
        <Text style={styles.note}>
          {autoRecordSource(record, wallets)}自動で作った記録（{formatMonthKey(record.month)}の分）
        </Text>
      )}
    </>
  );

  /** 記録の詳細（読むだけ）。 */
  const renderView = (target: MoneyRecord) => (
    <RecordDetailView
      kind={target.kind}
      occurredOn={target.occurredOn}
      total={recordTotal(target)}
      wallet={wallets.find((wallet) => wallet.id === target.walletId) ?? null}
      toWallet={wallets.find((wallet) => wallet.id === target.toWalletId) ?? null}
      store={target.store}
      cardNextPeriod={target.cardNextPeriod}
      groups={groups}
      groupTitle={groupTitle}
      groupIconKey={groupIconKey}
      notice={notices(false)}
      onClose={onClose}
      onDelete={confirmDelete}
      onEdit={() => setViewing(false)}
    />
  );

  const walletOf = (id: string | null) => wallets.find((wallet) => wallet.id === id) ?? null;

  /** 値の行（左にアイコン、右に値。区切り線は値の列だけ）。clear があれば右に小さな「×」。 */
  const field = (
    icon: ReactNode,
    text: string,
    placeholder: string,
    onPress: () => void,
    clear?: { label: string; onClear: () => void },
  ) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.fieldRow}>
      <View style={styles.fieldIcon}>{icon}</View>
      <View style={styles.fieldValue}>
        <Text style={[styles.fieldText, text === '' && styles.placeholder]} numberOfLines={1}>
          {text || placeholder}
        </Text>
        {clear && text !== '' && (
          <Pressable accessibilityRole="button" accessibilityLabel={clear.label} onPress={clear.onClear} hitSlop={10} style={styles.clear}>
            <X size={10} color={colors.primaryText} strokeWidth={3} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );

  /** 記録の編集（入力）。 */
  const renderEdit = () => (
    <View style={styles.screen}>
      <ScreenHeader
        title={record ? '記録の編集' : '記録を追加'}
        onClose={onClose}
        closeAtEnd
        right={
          record && (
            <Pressable accessibilityRole="button" accessibilityLabel="この記録を消す" onPress={confirmDelete} hitSlop={8}>
              <Trash2 size={20} color={colors.textMuted} />
            </Pressable>
          )
        }
      />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <View style={styles.kinds}>
          {KINDS.map((entry) => (
            <Pressable
              key={entry}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === entry }}
              onPress={() => changeKind(entry)}
              style={[styles.kind, kind === entry && styles.kindSelected]}
            >
              <Text style={[styles.kindText, kind === entry && styles.kindTextSelected]}>{RECORD_KIND_LABEL[entry]}</Text>
            </Pressable>
          ))}
        </View>

        {/* 金額（右に大きく）。品目の合計で、振替だけは押して入れる。 */}
        <Pressable
          accessibilityRole={kind === 'transfer' ? 'button' : undefined}
          disabled={kind !== 'transfer'}
          onPress={() => {
            setAmountExpr(transferAmount > 0 ? String(transferAmount) : '');
            push({ type: 'amount' });
          }}
          style={styles.amountRow}
        >
          <View style={styles.currency}>
            <Text style={styles.currencyMark}>¥</Text>
            <Text style={styles.currencyCode}>JPY</Text>
          </View>
          <Text style={styles.total}>{formatBalance(total).replace(/^¥\s*/, '')}</Text>
        </Pressable>
        {receiptNotices.length > 0 && (
          <View style={styles.receiptNotice}>
            {receiptNotices.map((notice) => (
              <Text key={notice} style={styles.receiptNoticeText}>
                {notice}
              </Text>
            ))}
          </View>
        )}
        {notices(true)}

        {field(<CalendarDays size={22} color={colors.textSubtle} />, formatDateWithYear(new Date(`${occurredOn}T00:00:00`)), '', openDate)}
        {field(
          <WalletTypeIcon type={walletOf(walletId)?.type ?? 'cash'} size={22} color={walletOf(walletId)?.iconColor} />,
          walletName(walletId),
          kind === 'income' ? '入金先' : '出金元',
          () => push({ type: 'wallet', field: 'walletId' }),
          { label: '出金元を外す', onClear: () => setWalletId(null) },
        )}
        {kind === 'transfer' ? (
          <>
            {field(
              <ArrowRight size={22} color={colors.textMuted} />,
              walletName(toWalletId),
              '入金先',
              () => push({ type: 'wallet', field: 'toWalletId' }),
              { label: '入金先を外す', onClear: () => setToWalletId(null) },
            )}
            <Text style={styles.note}>振替は集計に入れません</Text>
          </>
        ) : (
          field(
            <Store size={22} color={colors.textMuted} />,
            store,
            'お店',
            () => push({ type: 'store' }),
            { label: 'お店を外す', onClear: () => setStore('') },
          )
        )}
        {nextPeriodShown && (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: cardNextPeriod }}
            onPress={() => setCardNextPeriod((prev) => !prev)}
            style={styles.fieldRow}
          >
            <View style={styles.fieldIcon} />
            <View style={[styles.fieldValue, styles.fieldValueSmall]}>
              {cardNextPeriod ? (
                <SquareCheck size={20} color={colors.money} />
              ) : (
                <Square size={20} color={colors.textMuted} />
              )}
              <Text style={[styles.fieldText, styles.fieldTextSmall]}>引き落としを翌月分に回す</Text>
            </View>
          </Pressable>
        )}

        {kind !== 'transfer' && (
          <>
            <View style={styles.itemsHead}>
              <Text style={styles.itemsTitle}>品目一覧</Text>
              {record && !receipt && onScanReceipt && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="レシートから追加"
                  onPress={() => onScanReceipt(record)}
                  hitSlop={8}
                  style={styles.camera}
                >
                  <Camera size={16} color={colors.textSubtle} />
                  <Text style={styles.cameraText}>レシートから追加</Text>
                </Pressable>
              )}
            </View>
            {/* 画面の端に文字が寄らないよう、PWA版と同じ左右20の余白で包む（2026-10-19） */}
            <View style={styles.itemGroups}>
              <RecordItemGroups groups={groups} title={groupTitle} iconKey={groupIconKey} size="small" onOpen={openGroup} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="カテゴリを追加する"
              onPress={() => push({ type: 'category', purpose: 'add' })}
              style={styles.addGroup}
            >
              <View style={styles.addMark}>
                <Plus size={14} color={colors.money} />
              </View>
            </Pressable>
          </>
        )}
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={submit} style={styles.saveBar}>
        <Text style={styles.saveText}>{record ? '保存する' : '記録する'}</Text>
      </Pressable>
    </View>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={back}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>{renderScreen()}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.surface },
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { paddingTop: 4, paddingBottom: 16 },
  kinds: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  kind: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.neutralSurface },
  kindSelected: { backgroundColor: colors.moneySoft },
  kindText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  kindTextSelected: { color: colors.moneyText, fontWeight: '700' },
  // 金額: 左に「¥ JPY」、右に大きな数字（Zaim と同じ。数字を出す Text には fontWeight を必ず付ける）。
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 2 },
  currency: { alignItems: 'center' },
  currencyMark: { fontSize: 26, fontWeight: '800', color: colors.text },
  currencyCode: { fontSize: 11, fontWeight: '700', color: colors.textSubtle },
  total: { fontSize: 40, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  // 値の行: 左にアイコンの列、右に値。区切り線は値の列だけに引く。
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 20 },
  fieldIcon: { width: 24, alignItems: 'center' },
  fieldValue: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingRight: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldValueSmall: { paddingVertical: 6 },
  fieldText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  fieldTextSmall: { fontSize: 14, fontWeight: '600', color: colors.textSubtle },
  placeholder: { color: colors.textFaint, fontWeight: '500' },
  // 右の小さな灰色の円に白い「×」（値を外す）。
  clear: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.borderStrong },
  note: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 10, marginHorizontal: 20 },
  receiptNotice: { marginTop: 8, marginHorizontal: 16, padding: 12, gap: 4, borderRadius: 12, backgroundColor: colors.dangerSurface },
  receiptNoticeText: { fontSize: 13, fontWeight: '600', color: colors.danger },
  estimate: { marginTop: 8, marginHorizontal: 16, padding: 12, gap: 8, borderRadius: 12, backgroundColor: colors.moneyEstimateSurface },
  estimateHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  estimateText: { fontSize: 13, fontWeight: '500', color: colors.moneyEstimate },
  estimateLink: { fontSize: 14, fontWeight: '700', color: colors.moneyEstimate },
  itemsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemsTitle: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  // 「レシートから追加」は右寄せ（「カテゴリを追加」の文字リンクは、下の＋と重なるので外した。2026-10-16）。
  camera: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: colors.neutralSurface },
  cameraText: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  itemGroups: { paddingHorizontal: 20 },
  addGroup: { paddingHorizontal: 20, paddingVertical: 10 },
  addMark: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.moneySoft },
  // 下いっぱいの保存の帯（青）。
  saveBar: { alignItems: 'center', paddingVertical: 16, backgroundColor: colors.money },
  saveText: { fontSize: 16, fontWeight: '800', color: colors.primaryText },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border },
  amountBox: { alignItems: 'flex-end', paddingHorizontal: 20, paddingVertical: 24, flex: 1, justifyContent: 'flex-end' },
  amountExpr: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
  amountValue: { fontSize: 40, fontWeight: '700', color: colors.text },
});
