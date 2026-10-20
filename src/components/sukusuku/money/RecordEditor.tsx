'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Camera, Plus, Store, Trash2, X } from 'lucide-react';
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
import { formatDateWithYear, toDateStringInTimeZone } from '@/lib/dateUtils';
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
import Calculator from './Calculator';
import CategoryPicker, { type CategoryChoice } from './CategoryPicker';
import ItemsScreen, { addWorkGroup, blankLine, changeWorkGroup, groupsFromWork, type ItemsWork } from './ItemsScreen';
import StorePicker from './StorePicker';
import WalletPicker from './WalletPicker';
import RecordDetailView from './RecordDetailView';
import RecordItemGroups from './RecordItemGroups';
import { EstimateBadge, FullScreen, PrimaryButton, ScreenHeader, StackedScreen, WalletTypeIcon } from './moneyVisual';

// 記録の入力（docs/kakei.md §3.2。Zaim を踏襲）。mobile版の `mobile/src/components/money/RecordEditor.tsx` と同じ流れ・文言。
//
// 既にある記録は、まず記録の詳細（読むだけ。RecordDetailView）を見せ、「編集する」でこの入力画面へ（2026-10-15）。
// 「＋」→ 記録の編集（支出／収入／振替・日付・出金元・お店・翌月に回す・品目）→ 品目を押す／「＋」→ カテゴリの選択 → 品目
// （電卓は品目の金額を押すと出る）。出金元・お店はそれぞれ選ぶ画面へ。品目はカテゴリごとにまとめて1行で見せ、合計は品目から自動。
// 品目の画面は記録の品目を全部カテゴリごとに並べ、別のカテゴリもそこで足して一度に保存する（2026-10-20）。
// 振替は 出金元 → 入金先 と金額だけ。置かないもの: 電話番号・時刻・タグ・写真。
//
// 画面は全部この1つの全画面の中で重ねる。重ねた画面はそれぞれ戻る操作の層を積み（StackedScreen）、
// 戻る操作で1つ前の画面へ戻る。品目の書きかけは、カテゴリの選択へ行って戻っても残る。
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
  /** 記録して、続けて次の記録を入れる（新しく足すときだけ。日付・出金元・種類は引き継ぐ。docs/kakei.md §3.2。2026-10-20）。 */
  onSubmitNext?: (draft: MoneyRecordDraft) => void;
  /** 「記録して続ける」で、この入力の前に続けて記録した件数（0 なら知らせを出さない）。 */
  savedInRow?: number;
  onDelete: (record: MoneyRecord) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onDeleteWallet: (wallet: MoneyWallet) => void;
  onEditCategories: () => void;
  /**
   * レシートの読み取りの結果。あれば、その内容を入れた新しい記録として開く（docs/kakei.md §10.4）。
   * 既にある記録（record）と一緒に渡すと、出金元・日付はそのままで、品目をレシートの品目に入れ替えて開く（§10.8）。
   */
  receipt?: ReceiptScan | null;
  /** 新しく記録するときに最初に選んでおく日（YYYY-MM-DD。記録の一覧の、日の見出しの「＋」から）。無ければ今日。 */
  initialDate?: string | null;
  /** 新しく記録するときに最初に選んでおく種類（Gmail 取り込みの入金の明細から）。 */
  initialKind?: MoneyRecordKind;
  /** 新しく記録するときに最初に選んでおく出金元（口座のID）と、お店（Gmail 取り込みの未確認の「記録を作成する」から。docs/kakei.md §9.5.6.1）。 */
  initialWallet?: string | null;
  initialStore?: string;
  /** 新しく記録するときに最初に入れておく額（カテゴリの決まっていない1行にする。Gmail 取り込みの未確認の「記録を作成する」から）。 */
  initialAmount?: number | null;
  /** 新しく記録するときに最初に入れておく品目（Amazon の注文メールの明細の「記録を作成する」から。docs/kakei.md §9.10）。 */
  initialItems?: ReceiptScanItem[] | null;
  /**
   * レシートを撮って品目を入れる（支出・収入の記録だけ）。既にある記録は品目を入れ替え（§10.8）、新しい記録（null）は
   * レシートの内容で開き直す（§10.4。家計タブの＋の上から外したので、ここから読む。2026-10-20）。
   */
  onScanReceipt?: (record: MoneyRecord | null) => void;
}

/**
 * 自動で作った記録の作り元の言い方（「◯◯から」。分からないときは空）。削除した固定項目の記録は作り元が外れるので、言わない。
 */
function autoRecordSource(record: MoneyRecord, wallets: MoneyWallet[]): string {
  if (record.recurringId !== null) return record.kind === 'income' ? '収入の見込みから' : record.kind === 'transfer' ? '振替の見込みから' : '固定支出から';
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
  onSubmitNext,
  savedInRow = 0,
  onDelete,
  onSaveWallet,
  onDeleteWallet,
  onEditCategories,
  receipt = null,
  initialDate = null,
  initialKind = 'expense',
  initialWallet = null,
  initialStore = '',
  initialAmount = null,
  initialItems = null,
  onScanReceipt,
}: RecordEditorProps) {
  const [kind, setKind] = useState<MoneyRecordKind>(record?.kind ?? (receipt ? 'expense' : initialKind));
  const [occurredOn, setOccurredOn] = useState(
    record?.occurredOn ?? receipt?.occurredOn ?? initialDate ?? toDateStringInTimeZone(new Date()),
  );
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
  const storeOptions = useMemo(() => storeChoices(stores, records, toDateStringInTimeZone(new Date())), [stores, records]);
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
      if (window.confirm(`${RECORD_KIND_LABEL[next]}に切り替えますか？入れた品目は消えます。`)) apply();
    } else {
      apply();
    }
  };

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

  const submit = (next = false) => {
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
              categoryName: '',
              quantity: 1,
              unitPrice: transferAmount,
              name: '',
              memo: '',
            },
          ]
        : itemsFromGroups(groups);
    if (items.length === 0) return window.alert('品目を入れてください。「品目を追加する」からカテゴリを選びます。');
    // 取り込んだ明細から入れた額は、カテゴリを選ぶまで保存しない（docs/kakei.md §9.5.6.1）
    if (initialAmount !== null && groups.some((group) => group.categoryId === null && group.categoryName === '')) return window.alert('カテゴリを選んでください。');
    // 品目はマイナスも入れられるが、記録の合計はマイナスにしない（docs/kakei.md §10.5。DB でも確かめる）。
    if (total < 0) return window.alert('合計がマイナスです。値引きの行の金額を確かめてください。');
    (next && onSubmitNext ? onSubmitNext : onSubmit)({
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
        return viewing && record ? renderView(record) : renderEdit();
    }
  };

  // 日付の上の案内（見込みの額・自動で作った記録）。詳細・編集の両方に出す。
  const notices = (editable: boolean) => (
    <>
      {record?.isEstimate && (
        <div className="mt-2 space-y-2 rounded-xl bg-amber-100 p-3">
          <div className="flex items-center gap-2">
            {stillEstimate && <EstimateBadge />}
            <span className="flex-1 text-[13px] text-amber-800">
              {stillEstimate
                ? editable
                  ? '見込みの額です。検針票・明細などを見て額を直すと確定します'
                  : '見込みの額です。編集で額を直すと確定します'
                : '保存すると確定します'}
            </span>
          </div>
          {editable && stillEstimate && (
            <button type="button" onClick={() => setConfirmed(true)} className="text-sm font-bold text-amber-800">
              この額で確定する
            </button>
          )}
        </div>
      )}
      {record?.month && (
        <p className="mt-2.5 text-xs text-gray-400">
          {autoRecordSource(record, wallets)}自動で作った記録（{formatMonthKey(record.month)}の分）
        </p>
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

  // 値の行: 左にアイコンの列、右に値。区切り線は値の列だけに引く。
  const rowClass = 'flex w-full items-center gap-4 pl-5 text-left';
  const valueClass = 'flex min-w-0 flex-1 items-center gap-2 border-b border-gray-200 pr-5';
  const textClass = (empty: boolean) => `min-w-0 flex-1 truncate text-[15px] ${empty ? 'font-medium text-gray-400' : 'font-bold text-gray-900'}`;

  /** 値の行。clear があれば右に小さな灰色の円に白い「×」。 */
  const field = (icon: ReactNode, text: string, placeholder: string, onClick: () => void, clear?: { label: string; onClear: () => void }) => (
    <div className={rowClass}>
      <span className="flex w-6 shrink-0 justify-center">{icon}</span>
      <div className={`${valueClass} py-[9px]`}>
        <button type="button" onClick={onClick} className={`${textClass(text === '')} text-left`}>
          {text || placeholder}
        </button>
        {clear && text !== '' && (
          <button
            type="button"
            aria-label={clear.label}
            onClick={clear.onClear}
            className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-300 text-white after:absolute after:-inset-2 after:content-['']"
          >
            <X size={10} strokeWidth={3} />
          </button>
        )}
      </div>
    </div>
  );

  /** 記録の編集（入力）。 */
  const renderEdit = () => (
    <>
      <ScreenHeader
        title={record ? '記録の編集' : '記録を追加'}
        onClose={onClose}
        closeAtEnd
        right={
          record && (
            <button type="button" aria-label="この記録を消す" onClick={confirmDelete} className="text-gray-500">
              <Trash2 size={20} />
            </button>
          )
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto pt-1 pb-4">
        {savedInRow > 0 && <p className="mx-4 mb-2 text-[13px] font-bold text-blue-800">✓ {savedInRow}件記録しました。続けて入れてください</p>}
        <div className="flex gap-2 px-4">
          {KINDS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={kind === entry}
              onClick={() => changeKind(entry)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] ${
                kind === entry ? 'bg-blue-100 font-bold text-blue-800' : 'bg-gray-100 font-semibold text-gray-700'
              }`}
            >
              {RECORD_KIND_LABEL[entry]}
            </button>
          ))}
        </div>

        {/* 金額（右に大きく）。品目の合計で、振替だけは押して入れる。 */}
        <button
          type="button"
          disabled={kind !== 'transfer'}
          onClick={() => {
            setAmountExpr(transferAmount > 0 ? String(transferAmount) : '');
            push({ type: 'amount' });
          }}
          className="flex w-full items-center justify-between px-5 pt-1.5 pb-0.5 text-left disabled:cursor-default"
        >
          <span className="flex flex-col items-center leading-none">
            <span className="text-[26px] font-extrabold text-gray-900">¥</span>
            <span className="mt-0.5 text-[11px] font-bold text-gray-700">JPY</span>
          </span>
          <span className="text-[40px] font-extrabold text-gray-900 tabular-nums">{formatBalance(total).replace(/^¥\s*/, '')}</span>
        </button>
        {receiptNotices.length > 0 && (
          <div className="mx-4 mt-2 space-y-1 rounded-xl bg-red-50 p-3">
            {receiptNotices.map((notice) => (
              <p key={notice} className="text-[13px] font-semibold text-red-500">
                {notice}
              </p>
            ))}
          </div>
        )}
        <div className="mx-4">{notices(true)}</div>

        <label className={rowClass}>
          <span className="flex w-6 shrink-0 justify-center">
            <CalendarDays size={22} className="text-gray-700" />
          </span>
          <span className={`${valueClass} py-[9px]`}>
            <span className="sr-only">日付</span>
            <input
              type="date"
              value={occurredOn}
              aria-label={formatDateWithYear(new Date(`${occurredOn}T00:00:00`))}
              onChange={(event) => event.target.value && setOccurredOn(event.target.value)}
              className="flex-1 bg-transparent text-[15px] font-bold text-gray-900 focus:outline-none"
            />
          </span>
        </label>
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
              <ArrowRight size={22} className="text-gray-500" />,
              walletName(toWalletId),
              '入金先',
              () => push({ type: 'wallet', field: 'toWalletId' }),
              { label: '入金先を外す', onClear: () => setToWalletId(null) },
            )}
            <p className="mx-5 mt-2.5 text-xs text-gray-400">振替は集計に入れません</p>
          </>
        ) : (
          field(<Store size={22} className="text-gray-500" />, store, 'お店', () => push({ type: 'store' }), {
            label: 'お店を外す',
            onClear: () => setStore(''),
          })
        )}
        {nextPeriodShown && (
          <label className={rowClass}>
            <span className="w-6 shrink-0" />
            <span className={`${valueClass} py-1.5`}>
              <input
                type="checkbox"
                checked={cardNextPeriod}
                onChange={(event) => setCardNextPeriod(event.target.checked)}
                className="h-5 w-5"
              />
              <span className="flex-1 text-sm font-semibold text-gray-700">引き落としを翌月分に回す</span>
            </span>
          </label>
        )}

        {kind !== 'transfer' && (
          <>
            <div className="mt-3 flex items-center justify-between border-b border-gray-200 px-5 py-1.5">
              <span className="text-sm font-bold text-gray-500">品目一覧</span>
              {!receipt && onScanReceipt && (
                <button
                  type="button"
                  aria-label="レシートから追加"
                  onClick={() => onScanReceipt(record)}
                  className="relative flex h-7 items-center gap-1.5 rounded-full bg-gray-100 px-2.5 text-[13px] font-bold text-gray-700 after:absolute after:-inset-2 after:content-['']"
                >
                  <Camera size={16} />
                  レシートから追加
                </button>
              )}
            </div>
            <div className="px-5">
              <RecordItemGroups groups={groups} title={groupTitle} iconKey={groupIconKey} size="small" onOpen={openGroup} />
            </div>
            <button
              type="button"
              aria-label="カテゴリを追加する"
              onClick={() => push({ type: 'category', purpose: 'add' })}
              className="flex w-full items-center px-5 py-2.5"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <Plus size={14} />
              </span>
            </button>
          </>
        )}
      </div>
      {/* 下いっぱいの保存の帯（青）。新しく足すときは「記録して続ける」も出す（取り込んだ明細からの記録は除く）。 */}
      {!record && onSubmitNext && initialAmount === null ? (
        <div className="flex shrink-0">
          <button type="button" onClick={() => submit(true)} className="flex-1 border-t border-blue-600 bg-white py-4 text-base font-extrabold text-blue-600 hover:bg-blue-50">
            記録して続ける
          </button>
          <button type="button" onClick={() => submit()} className="flex-1 bg-blue-600 py-4 text-base font-extrabold text-white hover:bg-blue-700">
            記録する
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => submit()} className="shrink-0 bg-blue-600 py-4 text-base font-extrabold text-white hover:bg-blue-700">
          {record ? '保存する' : '記録する'}
        </button>
      )}
    </>
  );

  return <FullScreen onBack={onClose}>{renderScreen()}</FullScreen>;
}
