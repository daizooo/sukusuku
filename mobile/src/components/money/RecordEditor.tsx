import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ArrowRight, CalendarDays, ChevronRight, CreditCard, Plus, Store, Trash2 } from 'lucide-react-native';
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
} from '@/types/app';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { formatDateWithWeekday, toDateString } from '@/lib/dateUtils';
import {
  budgetFor,
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
  isBlankLine,
  itemNamesLabel,
  itemsFromGroups,
  lastWalletId,
  livingSpendByTop,
  monthKeyOf,
  pressCalcKey,
  recordTotal,
  storeChoices,
  RECORD_KIND_LABEL,
  sameGroupTarget,
  topCategoryIdOf,
  type EditorGroup,
} from '@/lib/moneyUtils';
import Calculator from '@/components/money/Calculator';
import CategoryPicker, { type CategoryChoice } from '@/components/money/CategoryPicker';
import ItemsScreen, { blankLine, type ItemsWork } from '@/components/money/ItemsScreen';
import StorePicker from '@/components/money/StorePicker';
import WalletPicker from '@/components/money/WalletPicker';
import { CategoryIcon, EstimateBadge, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 記録の入力（docs/kakei.md §3.2。Zaim を踏襲）。PWA版の `src/components/sukusuku/money/RecordEditor.tsx` と同じ流れ・文言。
//
// 「＋」→ 記録の詳細（支出／収入／振替・日付・出金元・お店・品目）→ 品目を押す／「品目を追加する」→ 種類の選択 → 品目
// （電卓はここで初めて出る）。出金元・お店はそれぞれ選ぶ画面へ。品目は種類ごとにまとめて1行で見せ、合計は品目から自動。
// 振替は 出金元 → 入金先 と金額だけ。置かないもの: 電話番号・時刻・タグ・写真。
//
// 画面は全部この1つの全画面の中で重ねる（戻る操作で1つ前の画面へ）。品目の書きかけは、
// 種類の選択へ行って戻っても残る。
//
// 見込みの額の記録（毎月の記録・カード代金で自動で作ったもの。§3.3）は、額を直すと確定になる。
// 額が合っていたときは「この額で確定する」。額を変えずに保存したときは見込みのまま。

type Screen =
  | { type: 'detail' }
  | { type: 'items' }
  | { type: 'category'; purpose: 'add' | 'change' }
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
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onEditCategories: () => void;
  /** レシートの読み取りの結果。あれば、その内容を入れた新しい記録として開く（docs/kakei.md §10.4）。 */
  receipt?: ReceiptScan | null;
  /** 新しく記録するときに最初に選んでおく種類（ホーム画面のウィジェットの「収入」「振替」から。docs/widgets.md §2.3）。 */
  initialKind?: MoneyRecordKind;
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
  onArchiveWallet,
  onEditCategories,
  receipt = null,
  initialKind = 'expense',
}: RecordEditorProps) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<MoneyRecordKind>(record?.kind ?? (receipt ? 'expense' : initialKind));
  const [occurredOn, setOccurredOn] = useState(record?.occurredOn ?? receipt?.occurredOn ?? toDateString(new Date()));
  // レシートから出金元が当たらなかったときは、前回の出金元を入れて「確かめてください」を出す（§10.4）。
  const [initialWalletId] = useState<string | null>(() =>
    record ? record.walletId : (receipt?.walletId ?? lastWalletId(records, wallets, receipt ? 'expense' : initialKind)),
  );
  const [walletId, setWalletId] = useState<string | null>(initialWalletId);
  const [toWalletId, setToWalletId] = useState<string | null>(record?.toWalletId ?? null);
  const [store, setStore] = useState(record?.store ?? receipt?.store ?? '');
  // お店の選択で「お店に登録して使う」を選んだか（保存のときにお店の設定に登録する。docs/kakei.md §3.5）。
  const [registerStore, setRegisterStore] = useState(false);
  const [groups, setGroups] = useState<EditorGroup[]>(() =>
    record && record.kind !== 'transfer'
      ? groupsFromItems(record.items, newGroupKey)
      : receipt
        ? groupsFromScan(receipt.items, newGroupKey)
        : [],
  );
  const [transferAmount, setTransferAmount] = useState(() =>
    record?.kind === 'transfer' ? record.items.reduce((sum, item) => sum + item.amount, 0) : 0,
  );
  const [amountExpr, setAmountExpr] = useState('');
  const [stack, setStack] = useState<Screen[]>([{ type: 'detail' }]);
  const [work, setWork] = useState<ItemsWork | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const screen = stack[stack.length - 1];
  const push = (next: Screen) => setStack((prev) => [...prev, next]);
  const pop = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const replaceTop = (next: Screen) => setStack((prev) => [...prev.slice(0, -1), next]);

  const monthKey = monthKeyOf(occurredOn);
  const spend = useMemo(() => livingSpendByTop(records, categories, monthKey), [records, categories, monthKey]);
  const storeOptions = useMemo(() => storeChoices(stores, records), [stores, records]);
  const total = kind === 'transfer' ? transferAmount : groups.reduce((sum, group) => sum + editorGroupTotal(group), 0);
  const categoryKind = kind === 'income' ? 'income' : 'expense';
  // 見込みのままか。額を直すか「この額で確定する」で確定になる。
  const stillEstimate = record?.isEstimate === true && !confirmed && total === recordTotal(record);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';

  /** まとまりの見出し（「食費 › 食料品」「医療費 › 病院」）。 */
  const groupTitle = (target: Pick<EditorGroup, 'categoryId' | 'categoryName'>) =>
    target.categoryId !== null
      ? categoryPath(categories, target.categoryId)
      : target.categoryName || (receipt ? '種類を選んでください' : '');

  // レシートの読み取りで、保存の前に確かめてほしいこと（§10.4・§10.5）。
  const receiptNotices = receipt
    ? [
        total !== receipt.receiptTotal &&
          `レシートの合計 ${formatYen(receipt.receiptTotal)} と ${formatYen(total - receipt.receiptTotal)} 違います`,
        receipt.walletId === null && walletId === initialWalletId && '出金元を確かめてください（レシートから分かりませんでした）',
        groups.some((group) => group.categoryId === null && group.categoryName === '') && '種類の決まっていない品目があります',
      ].filter((notice): notice is string => typeof notice === 'string')
    : [];

  /** まとまりのアイコン（大分類のアイコン）。 */
  const groupIconKey = (target: Pick<EditorGroup, 'categoryId'>) => {
    if (target.categoryId === null) return 'receipt';
    const topId = topCategoryIdOf(categories, target.categoryId);
    return iconKeyOf(categories.find((category) => category.id === topId));
  };

  /** まとまりの一言（今月の残り。予算を置いた大分類だけ）。 */
  const groupSubtitle = (target: Pick<EditorGroup, 'categoryId'>) => {
    if (target.categoryId === null) return '';
    const topId = topCategoryIdOf(categories, target.categoryId);
    if (topId === null || kind !== 'expense') return '';
    const budget = budgetFor(budgets, topId, monthKey);
    if (budget === null) return '';
    const remaining = budget - (spend.get(topId) ?? 0);
    return remaining < 0 ? `今月 ${formatYen(remaining)} 超過` : `今月 残り ${formatYen(remaining)}`;
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

  /** まとまりを品目の画面で開く。 */
  const openGroup = (group: EditorGroup) => {
    const lines = group.lines.length > 0 ? group.lines : [blankLine()];
    setWork({
      groupKey: group.key,
      categoryId: group.categoryId,
      categoryName: group.categoryName,
      lines,
      selected: null,
      expr: '',
      focusKey: null,
    });
    push({ type: 'items' });
  };

  /** 種類を選んだ（品目の追加、または品目の画面で種類を変えた）。 */
  const pickCategory = (choice: CategoryChoice, purpose: 'add' | 'change') => {
    const target = { categoryId: choice.categoryId, categoryName: '' };
    if (purpose === 'change' && work) {
      setWork({ ...work, ...target });
      pop();
      return;
    }
    const existing = groups.find((group) => sameGroupTarget(group, target));
    const line = blankLine();
    setWork({
      groupKey: existing?.key ?? null,
      ...target,
      lines: [...(existing?.lines ?? []), line],
      selected: line.key,
      expr: '',
      focusKey: null,
    });
    replaceTop({ type: 'items' });
  };

  const saveWork = () => {
    if (!work) return;
    const lines = work.lines.filter((line) => !isBlankLine(line));
    setGroups((prev) => {
      let next = prev.filter((group) => group.key !== work.groupKey);
      const target = { categoryId: work.categoryId, categoryName: work.categoryName };
      const same = next.find((group) => sameGroupTarget(group, target));
      if (same) {
        // 同じ種類のまとまりがほかにあれば、そこへ足す（種類を変えた結果、同じになったとき）。
        next = next.map((group) => (group.key === same.key ? { ...group, lines: [...group.lines, ...lines] } : group));
        return next;
      }
      const index = prev.findIndex((group) => group.key === work.groupKey);
      const group: EditorGroup = { key: work.groupKey ?? newGroupKey(), ...target, lines };
      if (index < 0) return [...next, group];
      next.splice(index, 0, group);
      return next;
    });
    setWork(null);
    pop();
  };

  const deleteWork = () => {
    if (!work) return;
    const key = work.groupKey;
    Alert.alert('この種類の品目を消しますか？', undefined, [
      { text: 'やめる', style: 'cancel' },
      {
        text: '消す',
        style: 'destructive',
        onPress: () => {
          setGroups((prev) => prev.filter((group) => group.key !== key));
          setWork(null);
          pop();
        },
      },
    ]);
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
    if (items.length === 0) return Alert.alert('品目を入れてください', '「品目を追加する」から種類を選びます。');
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
            title={groupTitle(work)}
            iconKey={groupIconKey(work)}
            subtitle={groupSubtitle(work)}
            onChangeCategory={() => push({ type: 'category', purpose: 'change' })}
            onSave={saveWork}
            onDelete={work.groupKey !== null ? deleteWork : undefined}
            onClose={back}
          />
        );
      case 'category':
        return (
          <CategoryPicker
            kind={categoryKind}
            monthKey={monthKey}
            categories={categories}
            budgets={budgets}
            records={records}
            onPick={(choice) => pickCategory(choice, screen.purpose)}
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
            onArchive={onArchiveWallet}
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
        return renderDetail();
    }
  };

  const renderDetail = () => (
    <View style={styles.screen}>
      <ScreenHeader
        title="記録の詳細"
        onClose={onClose}
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

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{kind === 'transfer' ? '金額' : '合計（品目の合計）'}</Text>
          <Text style={styles.total}>{formatBalance(total)}</Text>
        </View>
        {receiptNotices.length > 0 && (
          <View style={styles.receiptNotice}>
            {receiptNotices.map((notice) => (
              <Text key={notice} style={styles.receiptNoticeText}>
                {notice}
              </Text>
            ))}
          </View>
        )}
        {record?.isEstimate && (
          <View style={styles.estimate}>
            <View style={styles.estimateHead}>
              {stillEstimate && <EstimateBadge />}
              <Text style={[styles.estimateText, styles.flex]}>
                {stillEstimate
                  ? '見込みの額です。検針票・明細などを見て額を直すと確定します'
                  : '保存すると確定します'}
              </Text>
            </View>
            {stillEstimate && (
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

        <Pressable accessibilityRole="button" onPress={openDate} style={styles.field}>
          <CalendarDays size={20} color={colors.textMuted} />
          <Text style={styles.fieldText}>{formatDateWithWeekday(new Date(`${occurredOn}T00:00:00`))}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => push({ type: 'wallet', field: 'walletId' })} style={styles.field}>
          <CreditCard size={20} color={colors.textMuted} />
          <Text style={[styles.fieldText, walletId === null && styles.placeholder]}>
            {walletName(walletId) || (kind === 'income' ? '入金先' : '出金元')}
          </Text>
          <ChevronRight size={18} color={colors.textFaint} />
        </Pressable>
        {kind === 'transfer' ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => push({ type: 'wallet', field: 'toWalletId' })}
              style={styles.field}
            >
              <ArrowRight size={20} color={colors.textMuted} />
              <Text style={[styles.fieldText, toWalletId === null && styles.placeholder]}>
                {walletName(toWalletId) || '入金先'}
              </Text>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setAmountExpr(transferAmount > 0 ? String(transferAmount) : '');
                push({ type: 'amount' });
              }}
              style={styles.field}
            >
              <Text style={styles.fieldText}>金額を入れる</Text>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>
            <Text style={styles.note}>振替は集計に入れません</Text>
          </>
        ) : (
          <>
            <Pressable accessibilityRole="button" onPress={() => push({ type: 'store' })} style={styles.field}>
              <Store size={20} color={colors.textMuted} />
              <Text style={[styles.fieldText, store === '' && styles.placeholder]}>{store || 'お店'}</Text>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>

            <View style={styles.itemsHead}>
              <Text style={styles.itemsTitle}>品目</Text>
              <Text style={styles.itemsHint}>種類ごとにまとめて表示</Text>
            </View>
            {groups.map((group) => {
              const names = itemNamesLabel(group.lines);
              return (
                <Pressable key={group.key} accessibilityRole="button" onPress={() => openGroup(group)} style={styles.group}>
                  <CategoryIcon iconKey={groupIconKey(group)} size={24} />
                  <View style={styles.flex}>
                    <Text style={styles.groupTitle}>{groupTitle(group)}</Text>
                    {names !== '' && <Text style={styles.groupNames}>{names}</Text>}
                  </View>
                  <Text style={styles.groupTotal}>{formatBalance(editorGroupTotal(group))}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={() => push({ type: 'category', purpose: 'add' })}
              style={styles.addGroup}
            >
              <Plus size={18} color={colors.money} />
              <Text style={styles.addGroupText}>
                {groups.length === 0 ? '品目を追加する' : '品目を追加する（別の種類）'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={record ? '保存する' : '記録する'} onPress={submit} />
      </View>
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
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  kinds: { flexDirection: 'row', gap: 8 },
  kind: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.neutralSurface },
  kindSelected: { backgroundColor: colors.moneySoft },
  kindText: { fontSize: 14, fontWeight: '600', color: colors.textSubtle },
  kindTextSelected: { color: colors.moneyText, fontWeight: '700' },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  totalLabel: { fontSize: 12, fontWeight: '500', color: colors.textFaint, paddingBottom: 6 },
  total: { fontSize: 34, fontWeight: '700', color: colors.text },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldText: { flex: 1, fontSize: 16, fontWeight: '500', color: colors.text },
  placeholder: { color: colors.textFaint },
  note: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 10 },
  receiptNotice: { marginTop: 12, padding: 12, gap: 4, borderRadius: 12, backgroundColor: colors.dangerSurface },
  receiptNoticeText: { fontSize: 13, fontWeight: '600', color: colors.danger },
  estimate: { marginTop: 12, padding: 12, gap: 8, borderRadius: 12, backgroundColor: colors.moneyEstimateSurface },
  estimateHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  estimateText: { fontSize: 13, fontWeight: '500', color: colors.moneyEstimate },
  estimateLink: { fontSize: 14, fontWeight: '700', color: colors.moneyEstimate },
  itemsHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 18, marginBottom: 4 },
  itemsTitle: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  itemsHint: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  // 種類のまとまりの行は小さく（品目が主。docs/kakei.md §3.2）。
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupTitle: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  groupNames: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 1 },
  groupTotal: { fontSize: 14, fontWeight: '700', color: colors.text },
  addGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addGroupText: { fontSize: 15, fontWeight: '600', color: colors.money },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border },
  amountBox: { alignItems: 'flex-end', paddingHorizontal: 20, paddingVertical: 24, flex: 1, justifyContent: 'flex-end' },
  amountExpr: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
  amountValue: { fontSize: 40, fontWeight: '700', color: colors.text },
});
