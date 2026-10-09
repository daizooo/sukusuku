'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, CreditCard, Plus, Store, Trash2 } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyRecordKind,
  MoneyStore,
  MoneyWallet,
  MoneyWalletDraft,
  SpecialActual,
  SpecialItem,
} from '@/types/app';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import {
  budgetFor,
  categoryPath,
  editorGroupTotal,
  evaluateCalc,
  formatCalc,
  formatMonthKey,
  formatYen,
  groupsFromItems,
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
import Calculator from './Calculator';
import CategoryPicker, { type CategoryChoice } from './CategoryPicker';
import ItemsScreen, { blankLine, type ItemsWork } from './ItemsScreen';
import StorePicker from './StorePicker';
import WalletPicker from './WalletPicker';
import { CategoryIcon, EstimateBadge, FullScreen, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 記録の入力（docs/kakei.md §3.2。Zaim を踏襲）。mobile版の `mobile/src/components/money/RecordEditor.tsx` と同じ流れ・文言。
//
// 「＋」→ 記録の詳細（支出／収入／振替・日付・出金元・お店・品目）→ 品目を押す／「品目を追加する」→ 種類の選択 → 品目
// （電卓はここで初めて出る）。出金元・お店はそれぞれ選ぶ画面へ。品目は種類ごとにまとめて1行で見せ、合計は品目から自動。
// 振替は 出金元 → 入金先 と金額だけ。置かないもの: 電話番号・時刻・タグ・写真。
//
// 画面は全部この1つの全画面の中で重ねる。重ねた画面はそれぞれ戻る操作の層を積み（StackedScreen）、
// 戻る操作で1つ前の画面へ戻る。品目の書きかけは、種類の選択へ行って戻っても残る。
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
  stores,
  records,
  specialItems,
  specialActuals,
  onClose,
  onSubmit,
  onDelete,
  onSaveWallet,
  onArchiveWallet,
  onEditCategories,
}: RecordEditorProps) {
  const [kind, setKind] = useState<MoneyRecordKind>(record?.kind ?? 'expense');
  const [occurredOn, setOccurredOn] = useState(record?.occurredOn ?? toDateStringInTimeZone(new Date()));
  const [walletId, setWalletId] = useState<string | null>(
    record ? record.walletId : lastWalletId(records, wallets, 'expense'),
  );
  const [toWalletId, setToWalletId] = useState<string | null>(record?.toWalletId ?? null);
  const [store, setStore] = useState(record?.store ?? '');
  // お店の選択で「お店に登録して使う」を選んだか（保存のときにお店の設定に登録する。docs/kakei.md §3.5）。
  const [registerStore, setRegisterStore] = useState(false);
  const [groups, setGroups] = useState<EditorGroup[]>(() =>
    record && record.kind !== 'transfer' ? groupsFromItems(record.items, newGroupKey) : [],
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
  const specialKind = kind === 'income' ? 'income' : 'expense';
  // 見込みのままか。額を直すか「この額で確定する」で確定になる。
  const stillEstimate = record?.isEstimate === true && !confirmed && total === recordTotal(record);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const specialName = (id: string | null) => specialItems.find((item) => item.id === id)?.name ?? '';

  /** まとまりの見出し（「食費 › 食料品」「特別費 › 車検」）。 */
  const groupTitle = (target: Pick<EditorGroup, 'categoryId' | 'specialItemId'>) =>
    target.categoryId !== null
      ? categoryPath(categories, target.categoryId)
      : target.specialItemId !== null
        ? `${kind === 'income' ? '特別収入' : '特別費'} › ${specialName(target.specialItemId)}`
        : '';

  /** まとまりのアイコン（大分類のアイコン。特別費は支払いの絵）。 */
  const groupIconKey = (target: Pick<EditorGroup, 'categoryId'>) => {
    if (target.categoryId === null) return 'receipt';
    const topId = topCategoryIdOf(categories, target.categoryId);
    return iconKeyOf(categories.find((category) => category.id === topId));
  };

  /** まとまりの一言（今月の残り・特別費の予算）。 */
  const groupSubtitle = (target: Pick<EditorGroup, 'categoryId' | 'specialItemId' | 'specialPlanId'>) => {
    if (target.categoryId !== null) {
      const topId = topCategoryIdOf(categories, target.categoryId);
      if (topId === null || kind !== 'expense') return '';
      const budget = budgetFor(budgets, topId, monthKey);
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
      if (window.confirm(`${RECORD_KIND_LABEL[next]}に切り替えますか？入れた品目は消えます。`)) apply();
    } else {
      apply();
    }
  };

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
    if (!window.confirm('この種類の品目を消しますか？')) return;
    setGroups((prev) => prev.filter((group) => group.key !== key));
    setWork(null);
    pop();
  };

  const submit = () => {
    if (kind === 'transfer') {
      if (walletId === null || toWalletId === null) return window.alert('出金元と入金先を選んでください');
      if (walletId === toWalletId) return window.alert('出金元と入金先が同じです');
      if (transferAmount <= 0) return window.alert('金額を入れてください');
    }
    const items =
      kind === 'transfer'
        ? [
            {
              amount: transferAmount,
              categoryId: null,
              specialItemId: null,
              specialPlanId: null,
              quantity: 1,
              unitPrice: transferAmount,
              name: '',
              memo: '',
            },
          ]
        : itemsFromGroups(groups);
    if (items.length === 0) return window.alert('品目を入れてください。「品目を追加する」から種類を選びます。');
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
    });
  };

  const confirmDelete = () => {
    if (!record) return;
    if (window.confirm('この記録を消しますか？')) onDelete(record);
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
          <StackedScreen onBack={back}>
            <ScreenHeader title="金額" icon="back" onClose={back} />
            <div className="flex flex-1 flex-col items-end justify-end px-5 py-6">
              {/[+\-*/]/.test(amountExpr) && (
                <span className="text-sm text-gray-500 tabular-nums">{formatCalc(amountExpr)} =</span>
              )}
              <span className="text-[40px] font-bold text-gray-900 tabular-nums">{formatYen(evaluateCalc(amountExpr) ?? 0)}</span>
            </div>
            <Calculator onKey={(key) => setAmountExpr((prev) => pressCalcKey(prev, key))} />
            <div className="shrink-0 border-t border-gray-200 px-4 pt-2.5 pb-4">
              <PrimaryButton
                label="決める"
                onClick={() => {
                  setTransferAmount(evaluateCalc(amountExpr) ?? 0);
                  pop();
                }}
              />
            </div>
          </StackedScreen>
        );
      default:
        return renderDetail();
    }
  };

  const fieldClass = 'flex w-full items-center gap-3.5 border-b border-gray-200 py-3.5 text-left hover:bg-gray-50';

  const renderDetail = () => (
    <>
      <ScreenHeader
        title="記録の詳細"
        onClose={onClose}
        right={
          record && (
            <button type="button" aria-label="この記録を消す" onClick={confirmDelete} className="text-gray-500">
              <Trash2 size={20} />
            </button>
          )
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-6">
        <div className="flex gap-2">
          {KINDS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={kind === entry}
              onClick={() => changeKind(entry)}
              className={`rounded-full px-4 py-2 text-sm ${
                kind === entry ? 'bg-blue-100 font-bold text-blue-800' : 'bg-gray-100 font-semibold text-gray-700'
              }`}
            >
              {RECORD_KIND_LABEL[entry]}
            </button>
          ))}
        </div>

        <div className="flex items-end justify-between border-b border-gray-200 py-3.5">
          <span className="pb-1.5 text-xs text-gray-400">{kind === 'transfer' ? '金額' : '合計（品目の合計）'}</span>
          <span className="text-[34px] font-bold text-gray-900 tabular-nums">{formatYen(total)}</span>
        </div>
        {record?.isEstimate && (
          <div className="mt-3 space-y-2 rounded-xl bg-amber-100 p-3">
            <div className="flex items-center gap-2">
              {stillEstimate && <EstimateBadge />}
              <span className="flex-1 text-[13px] text-amber-800">
                {stillEstimate ? '見込みの額です。検針票・明細などを見て額を直すと確定します' : '保存すると確定します'}
              </span>
            </div>
            {stillEstimate && (
              <button type="button" onClick={() => setConfirmed(true)} className="text-sm font-bold text-amber-800">
                この額で確定する
              </button>
            )}
          </div>
        )}
        {record?.month && (
          <p className="mt-2.5 text-xs text-gray-400">
            {record.recurringId === null ? 'カード代金' : '毎月の記録'}から自動で作った記録（{formatMonthKey(record.month)}の分）
          </p>
        )}

        <label className={fieldClass}>
          <span className="sr-only">日付</span>
          <input
            type="date"
            value={occurredOn}
            onChange={(event) => event.target.value && setOccurredOn(event.target.value)}
            className="flex-1 bg-transparent text-base text-gray-900 focus:outline-none"
          />
        </label>
        <button type="button" onClick={() => push({ type: 'wallet', field: 'walletId' })} className={fieldClass}>
          <CreditCard size={20} className="text-gray-500" />
          <span className={`flex-1 text-base ${walletId === null ? 'text-gray-400' : 'text-gray-900'}`}>
            {walletName(walletId) || (kind === 'income' ? '入金先' : '出金元')}
          </span>
          <ChevronRight size={18} className="text-gray-400" />
        </button>
        {kind === 'transfer' ? (
          <>
            <button type="button" onClick={() => push({ type: 'wallet', field: 'toWalletId' })} className={fieldClass}>
              <ArrowRight size={20} className="text-gray-500" />
              <span className={`flex-1 text-base ${toWalletId === null ? 'text-gray-400' : 'text-gray-900'}`}>
                {walletName(toWalletId) || '入金先'}
              </span>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAmountExpr(transferAmount > 0 ? String(transferAmount) : '');
                push({ type: 'amount' });
              }}
              className={fieldClass}
            >
              <span className="flex-1 text-base text-gray-900">金額を入れる</span>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
            <p className="mt-2.5 text-xs text-gray-400">貯金用の口座への振替は「貯金」として数えます。ほかの振替は集計に入れません</p>
          </>
        ) : (
          <>
            <button type="button" onClick={() => push({ type: 'store' })} className={fieldClass}>
              <Store size={20} className="text-gray-500" />
              <span className={`flex-1 text-base ${store === '' ? 'text-gray-400' : 'text-gray-900'}`}>{store || 'お店'}</span>
              <ChevronRight size={18} className="text-gray-400" />
            </button>

            <div className="mt-4 mb-1 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-gray-500">品目</span>
              <span className="text-[11px] text-gray-400">種類ごとにまとめて表示</span>
            </div>
            {groups.map((group) => {
              const names = itemNamesLabel(group.lines);
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => openGroup(group)}
                  className="flex w-full items-center gap-2.5 border-b border-gray-200 py-2 text-left hover:bg-gray-50"
                >
                  <CategoryIcon iconKey={groupIconKey(group)} size={24} />
                  <span className="flex-1">
                    <span className="block text-[13px] font-semibold text-gray-700">{groupTitle(group)}</span>
                    {names !== '' && <span className="block text-[11px] text-gray-400">{names}</span>}
                  </span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">{formatYen(editorGroupTotal(group))}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => push({ type: 'category', purpose: 'add' })}
              className="flex w-full items-center gap-2.5 border-b border-gray-200 py-3.5 text-[15px] font-semibold text-blue-600 hover:bg-gray-50"
            >
              <Plus size={18} />
              {groups.length === 0 ? '品目を追加する' : '品目を追加する（別の種類）'}
            </button>
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-gray-200 px-4 pt-2.5 pb-4">
        <PrimaryButton label={record ? '保存する' : '記録する'} onClick={submit} />
      </div>
    </>
  );

  return <FullScreen onBack={onClose}>{renderScreen()}</FullScreen>;
}
