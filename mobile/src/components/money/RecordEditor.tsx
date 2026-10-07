import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ArrowRight, CalendarDays, ChevronRight, CreditCard, Plus, Store, Trash2 } from 'lucide-react-native';
import type {
  HouseholdProduct,
  MoneyBudget,
  MoneyCategory,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyRecordKind,
  MoneyWallet,
  MoneyWalletDraft,
  SpecialActual,
  SpecialItem,
} from '@/types/app';
import { colors } from '@/lib/theme';
import { formatDateWithWeekday, toDateString } from '@/lib/dateUtils';
import {
  budgetFor,
  categoryPath,
  editorGroupTotal,
  evaluateCalc,
  fiscalYearOfMonth,
  formatCalc,
  formatYen,
  groupsFromItems,
  isBlankLine,
  itemNamesLabel,
  itemsFromGroups,
  lastWalletId,
  livingSpendByTop,
  monthKeyOf,
  pressCalcKey,
  recentStores,
  RECORD_KIND_LABEL,
  sameGroupTarget,
  topCategoryIdOf,
  type EditorGroup,
} from '@/lib/moneyUtils';
import Calculator from '@/components/money/Calculator';
import CategoryPicker, { type CategoryChoice } from '@/components/money/CategoryPicker';
import ItemsScreen, { blankLine, newLineKey, type ItemsWork } from '@/components/money/ItemsScreen';
import ProductPicker, { type PickedProduct } from '@/components/money/ProductPicker';
import StorePicker from '@/components/money/StorePicker';
import WalletPicker from '@/components/money/WalletPicker';
import { CategoryBadge, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 記録の入力（docs/kakei.md §3.2。Zaim を踏襲）。PWA版の `src/components/sukusuku/money/RecordEditor.tsx` と同じ流れ・文言。
//
// 「＋」→ 記録の詳細（支出／収入／振替・日付・出金元・お店・品目）→ 品目を押す／「品目を追加する」→ 種類の選択 → 品目
// （電卓はここで初めて出る）。出金元・お店はそれぞれ選ぶ画面へ。品目は種類ごとにまとめて1行で見せ、合計は品目から自動。
// 振替は 出金元 → 入金先 と金額だけ。置かないもの: 電話番号・時刻・タグ・写真。
//
// 画面は全部この1つの全画面の中で重ねる（戻る操作で1つ前の画面へ）。品目の書きかけは、
// 種類の選択・日用品から選ぶへ行って戻っても残る。

type Screen =
  | { type: 'detail' }
  | { type: 'items' }
  | { type: 'category'; purpose: 'add' | 'change' }
  | { type: 'wallet'; field: 'walletId' | 'toWalletId' }
  | { type: 'store' }
  | { type: 'products' }
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
  records: MoneyRecord[];
  products: HouseholdProduct[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onClose: () => void;
  onSubmit: (draft: MoneyRecordDraft) => void;
  onDelete: (record: MoneyRecord) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onArchiveWallet: (wallet: MoneyWallet) => void;
  onEditCategories: () => void;
}

export default function RecordEditor({
  record,
  categories,
  budgets,
  wallets,
  records,
  products,
  specialItems,
  specialActuals,
  onClose,
  onSubmit,
  onDelete,
  onSaveWallet,
  onArchiveWallet,
  onEditCategories,
}: RecordEditorProps) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<MoneyRecordKind>(record?.kind ?? 'expense');
  const [occurredOn, setOccurredOn] = useState(record?.occurredOn ?? toDateString(new Date()));
  const [walletId, setWalletId] = useState<string | null>(
    record ? record.walletId : lastWalletId(records, wallets, 'expense'),
  );
  const [toWalletId, setToWalletId] = useState<string | null>(record?.toWalletId ?? null);
  const [store, setStore] = useState(record?.store ?? '');
  const [groups, setGroups] = useState<EditorGroup[]>(() =>
    record && record.kind !== 'transfer' ? groupsFromItems(record.items, newGroupKey) : [],
  );
  const [transferAmount, setTransferAmount] = useState(() =>
    record?.kind === 'transfer' ? record.items.reduce((sum, item) => sum + item.amount, 0) : 0,
  );
  const [amountExpr, setAmountExpr] = useState('');
  const [stack, setStack] = useState<Screen[]>([{ type: 'detail' }]);
  const [work, setWork] = useState<ItemsWork | null>(null);

  const screen = stack[stack.length - 1];
  const push = (next: Screen) => setStack((prev) => [...prev, next]);
  const pop = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const replaceTop = (next: Screen) => setStack((prev) => [...prev.slice(0, -1), next]);

  const monthKey = monthKeyOf(occurredOn);
  const spend = useMemo(() => livingSpendByTop(records, categories, monthKey), [records, categories, monthKey]);
  const stores = useMemo(() => recentStores(records), [records]);
  const total = kind === 'transfer' ? transferAmount : groups.reduce((sum, group) => sum + editorGroupTotal(group), 0);
  const specialKind = kind === 'income' ? 'income' : 'expense';

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const specialName = (id: string | null) => specialItems.find((item) => item.id === id)?.name ?? '';

  /** まとまりの見出し（「食費 › 食料品」「特別費 › 車検」）。 */
  const groupTitle = (target: Pick<EditorGroup, 'categoryId' | 'specialItemId'>) =>
    target.categoryId !== null
      ? categoryPath(categories, target.categoryId)
      : target.specialItemId !== null
        ? `${kind === 'income' ? '特別収入' : '特別費'} › ${specialName(target.specialItemId)}`
        : '';

  /** まとまりの一言（今月の残り・特別費の予算）。 */
  const groupSubtitle = (target: Pick<EditorGroup, 'categoryId' | 'specialItemId' | 'specialPlanId'>) => {
    if (target.categoryId !== null) {
      const topId = topCategoryIdOf(categories, target.categoryId);
      if (topId === null || kind !== 'expense') return '';
      const budget = budgetFor(budgets, topId, fiscalYearOfMonth(monthKey));
      if (budget === null) return '';
      const remaining = budget - (spend.get(topId) ?? 0);
      return remaining < 0 ? `今月 ${formatYen(remaining)} 超過` : `今月 残り ${formatYen(remaining)}`;
    }
    if (target.specialItemId !== null) {
      const plan = specialItems.find((item) => item.id === target.specialItemId)?.plans.find((entry) => entry.id === target.specialPlanId);
      return plan ? `予算 ${formatYen(plan.amount)}${plan.month !== null ? `（${plan.month}月）` : ''}` : '予定外';
    }
    return '';
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
      specialItemId: group.specialItemId,
      specialPlanId: group.specialPlanId,
      lines,
      selected: null,
      expr: '',
      focusKey: null,
    });
    push({ type: 'items' });
  };

  /** 種類を選んだ（品目の追加、または品目の画面で種類を変えた）。 */
  const pickCategory = (choice: CategoryChoice, purpose: 'add' | 'change') => {
    const target = { categoryId: choice.categoryId, specialItemId: choice.specialItemId, specialPlanId: choice.specialPlanId };
    if (purpose === 'change' && work) {
      // 特別費の予定に変えたら、まだ金額の無い行に予算の額を入れる。
      const lines =
        choice.amount !== null && work.lines.length === 1 && work.lines[0].unitPrice === 0
          ? [{ ...work.lines[0], unitPrice: choice.amount }]
          : work.lines;
      setWork({ ...work, ...target, lines });
      pop();
      return;
    }
    const existing = groups.find((group) => sameGroupTarget(group, target));
    const line = { ...blankLine(), unitPrice: choice.amount ?? 0 };
    setWork({
      groupKey: existing?.key ?? null,
      ...target,
      lines: [...(existing?.lines ?? []), line],
      selected: line.key,
      expr: choice.amount ? String(choice.amount) : '',
      focusKey: null,
    });
    replaceTop({ type: 'items' });
  };

  const saveWork = () => {
    if (!work) return;
    const lines = work.lines.filter((line) => !isBlankLine(line));
    setGroups((prev) => {
      let next = prev.filter((group) => group.key !== work.groupKey);
      const target = { categoryId: work.categoryId, specialItemId: work.specialItemId, specialPlanId: work.specialPlanId };
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

  const pickProducts = (picked: PickedProduct[]) => {
    if (work) {
      const lines = picked.map(({ product, quantity }) => ({
        key: newLineKey(),
        name: product.name,
        quantity,
        unitPrice: product.price ?? 0,
        productId: product.id,
        memo: '',
      }));
      setWork({
        ...work,
        lines: [...work.lines.filter((line) => !isBlankLine(line)), ...lines],
        selected: null,
        expr: '',
        focusKey: null,
      });
    }
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
              specialItemId: null,
              specialPlanId: null,
              productId: null,
              quantity: 1,
              unitPrice: transferAmount,
              name: '',
              memo: '',
            },
          ]
        : itemsFromGroups(groups);
    if (items.length === 0) return Alert.alert('品目を入れてください', '「品目を追加する」から種類を選びます。');
    onSubmit({
      id: record?.id ?? null,
      kind,
      occurredOn,
      walletId,
      toWalletId: kind === 'transfer' ? toWalletId : null,
      store: kind === 'transfer' ? '' : store,
      items,
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
            subtitle={groupSubtitle(work)}
            canPickProducts={work.categoryId !== null && kind === 'expense'}
            onChangeCategory={() => push({ type: 'category', purpose: 'change' })}
            onPickProducts={() => push({ type: 'products' })}
            onSave={saveWork}
            onDelete={work.groupKey !== null ? deleteWork : undefined}
            onClose={back}
          />
        );
      case 'category':
        return (
          <CategoryPicker
            kind={specialKind}
            monthKey={monthKey}
            categories={categories}
            budgets={budgets}
            records={records}
            specialItems={specialItems}
            specialActuals={specialActuals}
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
            recent={stores}
            onPick={(value) => {
              setStore(value);
              pop();
            }}
            onClose={back}
          />
        );
      case 'products':
        return (
          <ProductPicker
            products={products}
            categoryId={work?.categoryId ?? null}
            categoryName={categories.find((category) => category.id === work?.categoryId)?.name ?? ''}
            onPick={pickProducts}
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
          <Text style={styles.total}>{formatYen(total)}</Text>
        </View>

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
            <Text style={styles.note}>貯金用の口座への振替は「貯金」として数えます。ほかの振替は集計に入れません</Text>
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
              const top = group.categoryId !== null ? topCategoryIdOf(categories, group.categoryId) : null;
              const badge = top ? categories.find((category) => category.id === top)?.name ?? '' : '特';
              const names = itemNamesLabel(group.lines);
              return (
                <Pressable key={group.key} accessibilityRole="button" onPress={() => openGroup(group)} style={styles.group}>
                  <CategoryBadge label={badge} />
                  <View style={styles.flex}>
                    <Text style={styles.groupTitle}>{groupTitle(group)}</Text>
                    {names !== '' && <Text style={styles.groupNames}>{names}</Text>}
                  </View>
                  <Text style={styles.groupTotal}>{formatYen(editorGroupTotal(group))}</Text>
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
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{renderScreen()}</View>
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
  itemsHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 18, marginBottom: 4 },
  itemsTitle: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  itemsHint: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  group: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  groupNames: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 3 },
  groupTotal: { fontSize: 15, fontWeight: '700', color: colors.text },
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
