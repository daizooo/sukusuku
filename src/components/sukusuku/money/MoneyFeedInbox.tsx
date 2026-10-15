'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyFeedItem, MoneyRecord, MoneyStore, MoneyWallet } from '@/types/app';
import type { MoneyFeedFill, MoneyFeedResolve } from '@/lib/api/moneyFeed';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { formatYen, monthKeyOfDate, recordTotal, storeChoices } from '@/lib/moneyUtils';
import {
  feedAmountLabel,
  feedDayLabel,
  feedLinkCandidates,
  feedStatusLabel,
  sortFeedInbox,
  storeCategoryGuess,
} from '@/lib/moneyFeedUtils';
import { ModalShell } from '../modals/TaskForm';
import CategoryPicker from './CategoryPicker';
import StorePicker from './StorePicker';
import { FullScreen, PrimaryButton, ScreenHeader, incomeAmountClass } from './moneyVisual';
import { Chip, ChipRow, Field, ToggleRow, WalletChoices, feedInputClass } from './feedParts';

// 取り込んだ明細の「未確認」（docs/kakei.md §9.5.5・§9.5.6.1）。mobile版の `mobile/src/components/money/MoneyFeedInbox.tsx` と同じ並び・文言。
//
// 「口座」の面の上の「未確認 n件」から開く。手入力との確認 → 口座が決まっていない → 未確認 → 読めない の順。
// 1件を押すと片づけ方を選ぶ枠: 口座を選ぶ／手入力と同じか（同じ取引・振替に置き換える・別の取引）／
// 記録にする・振替にする・既にある記録と結ぶ・記録しない。「次から同じ内容は自動で」を選ぶと取り込みのルールに覚える。

interface MoneyFeedInboxProps {
  items: MoneyFeedItem[];
  /** 明細から来た記録（結ぶ候補から除く）。 */
  linkedRecordIds: string[];
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  /** お店の設定（記録にするときのお店の選択に使う）。 */
  stores: MoneyStore[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  onResolve: (item: MoneyFeedItem, resolve: MoneyFeedResolve) => Promise<boolean>;
  /** 読めないメールに、口座・向き・日付・額を手で入れる。入れたあとは未確認として続けて片づける。 */
  onFill: (item: MoneyFeedItem, fill: MoneyFeedFill) => Promise<boolean>;
  onClose: () => void;
}

export default function MoneyFeedInbox({
  items,
  linkedRecordIds,
  wallets,
  records,
  stores,
  categories,
  budgets,
  onResolve,
  onFill,
  onClose,
}: MoneyFeedInboxProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(() => sortFeedInbox(items), [items]);
  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? null;
  const opened = items.find((item) => item.id === openId) ?? null;

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title={`未確認 ${items.length}件`} icon="back" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 bg-gray-50 p-4 pb-8">
        {sorted.length === 0 && <p className="py-6 text-center text-sm text-gray-400">未確認の明細はありません</p>}
        {sorted.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setOpenId(item.id)}
            className="flex w-full items-center gap-2.5 rounded-2xl border border-gray-200 bg-white p-3 text-left hover:bg-gray-50"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`text-[11px] font-bold ${item.status === 'confirm' ? 'text-red-600' : 'text-blue-800'}`}>
                  {feedStatusLabel(item)}
                </span>
                <span className="text-[11px] font-semibold text-gray-500">{feedDayLabel(item.occurredOn)}</span>
              </span>
              <span className="mt-0.5 block truncate text-sm font-bold text-gray-900">
                {walletName(item.walletId) ?? item.accountName ?? item.subject}
              </span>
              {item.description !== '' && <span className="mt-0.5 line-clamp-2 block text-xs text-gray-500">{item.description}</span>}
            </span>
            <span className={`text-base font-extrabold tabular-nums ${item.direction === 'in' ? incomeAmountClass : 'text-gray-900'}`}>
              {feedAmountLabel(item)}
            </span>
            <ChevronRight size={18} className="text-gray-400" />
          </button>
        ))}
      </div>
      {opened && (
        <FeedItemModal
          key={opened.id}
          item={opened}
          linkedRecordIds={linkedRecordIds}
          wallets={wallets}
          records={records}
          stores={stores}
          categories={categories}
          budgets={budgets}
          onClose={() => setOpenId(null)}
          onResolve={async (resolve) => {
            if (await onResolve(opened, resolve)) setOpenId(null);
          }}
          onFill={async (fill) => {
            // 入れたあとも片づいていなければ、同じ明細の枠を開いたまま次の片づけ方を選ぶ
            await onFill(opened, fill);
          }}
        />
      )}
    </FullScreen>
  );
}

type Mode = 'record' | 'transfer' | 'link' | 'ignore';

const MODES: { id: Mode; label: string }[] = [
  { id: 'record', label: '記録にする' },
  { id: 'transfer', label: '振替にする' },
  { id: 'link', label: '既にある記録と結ぶ' },
  { id: 'ignore', label: '記録しない' },
];

const candidateButtonClass = 'rounded-lg bg-blue-100 px-3 py-2 text-[13px] font-bold text-blue-800 disabled:opacity-50';

function FeedItemModal({
  item,
  linkedRecordIds,
  wallets,
  records,
  stores,
  categories,
  budgets,
  onClose,
  onResolve,
  onFill,
}: {
  item: MoneyFeedItem;
  linkedRecordIds: string[];
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  stores: MoneyStore[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  onClose: () => void;
  onResolve: (resolve: MoneyFeedResolve) => Promise<void>;
  onFill: (fill: MoneyFeedFill) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('record');
  // 読めないメールの手入力（口座・向き・日付・額）
  const [fillDirection, setFillDirection] = useState<'in' | 'out'>('out');
  const [fillOn, setFillOn] = useState(() => toDateStringInTimeZone(new Date(item.receivedAt)));
  const [fillAmount, setFillAmount] = useState('');
  const [walletId, setWalletId] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  // カードの利用通知は、利用先に当てたお店と、そのお店でいちばん多いカテゴリを初めから入れておく（§9.6）
  const [categoryId, setCategoryId] = useState<string | null>(() =>
    item.storeHint ? storeCategoryGuess(records, item.storeHint, item.direction === 'in' ? 'income' : 'expense') : null,
  );
  const [store, setStore] = useState(item.storeHint ?? '');
  // お店の選択で「お店に登録して使う」を選んだか（記録の入力と同じ。docs/kakei.md §3.5）
  const [registerStore, setRegisterStore] = useState(false);
  const [pickingStore, setPickingStore] = useState(false);
  const storeOptions = useMemo(() => storeChoices(stores, records), [stores, records]);
  const [toWalletId, setToWalletId] = useState<string | null>(null);
  const [linkId, setLinkId] = useState<string | null>(null);
  const [learn, setLearn] = useState(true);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [busy, setBusy] = useState(false);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '—';
  const categoryName = categories.find((category) => category.id === categoryId)?.name ?? null;
  const candidates = useMemo(() => records.filter((record) => item.candidateRecordIds.includes(record.id)), [records, item]);
  const linkChoices = useMemo(() => feedLinkCandidates(item, records, new Set(linkedRecordIds)), [item, records, linkedRecordIds]);

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
    <div className="space-y-0.5">
      <p className="text-[22px] font-extrabold tabular-nums text-gray-900">{feedAmountLabel(item)}</p>
      <p className="text-[13px] font-semibold text-gray-700">
        {feedDayLabel(item.occurredOn)}　{item.accountName ?? ''}
      </p>
      {item.description !== '' && <p className="text-[13px] leading-relaxed text-gray-500">{item.description}</p>}
    </div>
  );

  // 読めないメール: 件名を見ながら、口座・向き・日付・額を手で入れる（入れると未確認として突き合わせる）。記録しないこともできる
  if (item.status === 'unreadable' || item.direction === null) {
    const amount = Number(fillAmount.replace(/[^0-9]/g, ''));
    const canFill = !busy && walletId !== null && amount > 0 && fillOn !== '';
    const fill = async () => {
      if (!canFill || walletId === null) return;
      setBusy(true);
      try {
        await onFill({ walletId, direction: fillDirection, occurredOn: fillOn, amount });
      } finally {
        setBusy(false);
      }
    };
    return (
      <ModalShell
        title="読めないメール"
        onClose={onClose}
        footer={
          <div className="space-y-1">
            <PrimaryButton label="この内容で取り込む" disabled={!canFill} onClick={() => void fill()} />
            <button
              type="button"
              disabled={busy}
              onClick={() => void run({ action: 'ignore', learn: false })}
              className="w-full py-2.5 text-sm font-bold text-gray-700"
            >
              記録しない
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-gray-500">{item.subject}</p>
          <p className="text-xs leading-relaxed text-gray-500">
            メールの形が違い、日付・額・口座を読めませんでした。件名を見て入れると、ほかの明細と同じく振替・自動の記録・手入力と突き合わせます。
          </p>
          <Field label="向き">
            <ChipRow>
              <Chip label="出金" selected={fillDirection === 'out'} onClick={() => setFillDirection('out')} />
              <Chip label="入金" selected={fillDirection === 'in'} onClick={() => setFillDirection('in')} />
            </ChipRow>
          </Field>
          <Field label="日付">
            <input type="date" className={feedInputClass} value={fillOn} onChange={(event) => setFillOn(event.target.value)} />
          </Field>
          <Field label="金額（円）">
            <input
              className={feedInputClass}
              inputMode="numeric"
              value={fillAmount}
              onChange={(event) => setFillAmount(event.target.value)}
              placeholder="例: 20000"
            />
          </Field>
          <Field label="口座">
            <WalletChoices wallets={wallets} selectedId={walletId} onPick={setWalletId} />
          </Field>
        </div>
      </ModalShell>
    );
  }

  // 口座が決まっていない: 口座を選ぶ
  if (item.walletId === null) {
    return (
      <ModalShell
        title="口座を選ぶ"
        onClose={onClose}
        footer={
          <PrimaryButton
            label="この口座にする"
            disabled={walletId === null || busy}
            onClick={() => walletId && void run({ action: 'wallet', walletId, remember })}
          />
        }
      >
        <div className="space-y-4">
          {summary}
          <WalletChoices wallets={wallets} selectedId={walletId} onPick={setWalletId} />
          <ToggleRow label={`次から「${item.accountName ?? ''}」はこの口座`} value={remember} onChange={setRemember} />
        </div>
      </ModalShell>
    );
  }

  // 手入力と同じか確認（§9.5.5）
  if (item.status === 'confirm') {
    const paired = item.pairId !== null;
    return (
      <ModalShell
        title="手入力と同じ取引ですか"
        onClose={onClose}
        footer={
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ action: 'separate' })}
            className="w-full py-2.5 text-sm font-bold text-gray-700"
          >
            {paired ? '別の取引（新しく振替を作る）' : '別の取引'}
          </button>
        }
      >
        <div className="space-y-4">
          {summary}
          {paired && <p className="text-xs leading-relaxed text-gray-500">この明細は、ほかの口座の明細と組になった振替です。</p>}
          {candidates.length === 0 && (
            <p className="text-xs leading-relaxed text-gray-500">当たった手入力の記録が見つかりません（消されたかもしれません）。</p>
          )}
          {candidates.map((record) => (
            <div key={record.id} className="space-y-2 rounded-xl border border-gray-200 p-2.5">
              <RecordLine record={record} walletName={walletName} categories={categories} />
              <div className="flex flex-wrap gap-1.5">
                {(!paired || record.kind === 'transfer') && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run({ action: 'link', recordId: record.id, learn: false })}
                    className={candidateButtonClass}
                  >
                    同じ取引
                  </button>
                )}
                {paired && record.kind !== 'transfer' && (
                  <>
                    <button
                      type="button"
                      disabled={busy || record.items.length !== 1}
                      onClick={() => void run({ action: 'replace', recordId: record.id })}
                      className={candidateButtonClass}
                    >
                      振替に置き換える
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ action: 'link', recordId: record.id, learn: false })}
                      className={candidateButtonClass}
                    >
                      手入力を残す
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </ModalShell>
    );
  }

  // 未確認: 記録にする・振替にする・結ぶ・記録しない
  const kind = item.direction === 'in' ? 'income' : 'expense';
  const canSave =
    !busy &&
    (mode === 'record' ? categoryId !== null : mode === 'transfer' ? toWalletId !== null : mode === 'link' ? linkId !== null : true);
  const save = () => {
    if (mode === 'record' && categoryId) {
      void run({ action: 'record', categoryId, store, registerStore: store !== '' && registerStore, learn });
    }
    if (mode === 'transfer' && toWalletId) void run({ action: 'transfer', toWalletId, learn });
    if (mode === 'link' && linkId) void run({ action: 'link', recordId: linkId, learn });
    if (mode === 'ignore') void run({ action: 'ignore', learn });
  };

  return (
    <>
      <ModalShell title={walletName(item.walletId)} onClose={onClose} footer={<PrimaryButton label="保存する" disabled={!canSave} onClick={save} />}>
        <div className="space-y-4">
          <ChipRow>
            {MODES.map((entry) => (
              <Chip key={entry.id} label={entry.label} selected={mode === entry.id} onClick={() => setMode(entry.id)} />
            ))}
          </ChipRow>
          {summary}
          {mode === 'record' && (
            <>
              <Field label={kind === 'income' ? '収入のカテゴリ' : '支出のカテゴリ'}>
                <button
                  type="button"
                  onClick={() => setPickingCategory(true)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-300 px-3 py-2 text-left"
                >
                  <span className={`text-[15px] font-semibold ${categoryName ? 'text-gray-900' : 'text-gray-400'}`}>
                    {categoryName ?? 'カテゴリを選ぶ'}
                  </span>
                  <ChevronRight size={18} className="text-gray-400" />
                </button>
              </Field>
              <Field
                label="お店（任意）"
                hint={item.storeHint ? `利用先「${item.description}」から当てました。違えば直してください。` : undefined}
              >
                <button
                  type="button"
                  onClick={() => setPickingStore(true)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-300 px-3 py-2 text-left"
                >
                  <span className={`text-[15px] font-semibold ${store ? 'text-gray-900' : 'text-gray-400'}`}>{store || 'お店を選ぶ'}</span>
                  <ChevronRight size={18} className="text-gray-400" />
                </button>
              </Field>
            </>
          )}
          {mode === 'transfer' && (
            <Field label={item.direction === 'out' ? '入金先（相手の出金元）' : '出金元（相手の出金元）'}>
              <WalletChoices wallets={wallets} selectedId={toWalletId} onPick={setToWalletId} exclude={item.walletId} />
            </Field>
          )}
          {mode === 'link' && (
            <Field label="結ぶ記録（同じ口座・前後7日）" hint="見込みの記録を選ぶと、額を明細の額にして確定します。">
              {linkChoices.length === 0 && <p className="text-xs text-gray-500">当たる記録がありません</p>}
              {linkChoices.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  aria-pressed={linkId === record.id}
                  onClick={() => setLinkId(record.id)}
                  className={`w-full rounded-xl border p-2.5 text-left ${linkId === record.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}
                >
                  <RecordLine record={record} walletName={walletName} categories={categories} />
                </button>
              ))}
            </Field>
          )}
          {mode === 'ignore' && (
            <p className="text-xs leading-relaxed text-gray-500">記録を作りません。残高がずれたら、口座の詳細から補正してください。</p>
          )}
          <ToggleRow label="次から同じ内容は自動で" value={learn} onChange={setLearn} />
        </div>
      </ModalShell>
      {pickingStore && (
        // お店の選択は StorePicker（StackedScreen）が戻る操作の層を積むので、ここでは枠だけ
        <div className="fixed inset-0 z-50 flex justify-center bg-black/30">
          <div className="flex h-full w-full max-w-md flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <StorePicker
              value={store}
              registered={storeOptions.registered}
              recent={storeOptions.recent}
              others={storeOptions.others}
              canRegister
              onPick={(value, register) => {
                setStore(value);
                setRegisterStore(register);
                // カテゴリがまだなら、そのお店でいちばん多く使ったカテゴリを入れる
                if (categoryId === null) setCategoryId(storeCategoryGuess(records, value, kind));
                setPickingStore(false);
              }}
              onClose={() => setPickingStore(false)}
            />
          </div>
        </div>
      )}
      {pickingCategory && (
        // カテゴリの選択は CategoryPicker（StackedScreen）が戻る操作の層を積むので、ここでは枠だけ
        <div className="fixed inset-0 z-50 flex justify-center bg-black/30">
          <div className="flex h-full w-full max-w-md flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <CategoryPicker
            kind={kind}
            monthKey={monthKeyOfDate(new Date())}
            categories={categories}
            budgets={budgets}
            records={records}
            onPick={(choice) => {
              setCategoryId(choice.categoryId);
              setPickingCategory(false);
            }}
            onClose={() => setPickingCategory(false)}
          />
          </div>
        </div>
      )}
    </>
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
    <span className="flex items-center gap-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-gray-900">
          {feedDayLabel(record.occurredOn)}　{kindLabel}
          {category ? `・${category}` : ''}
          {record.isEstimate ? '（見込み）' : ''}
        </span>
        <span className="block truncate text-xs text-gray-500">
          {where}
          {record.store !== '' ? `・${record.store}` : ''}
        </span>
      </span>
      <span className="text-sm font-bold tabular-nums text-gray-900">{formatYen(recordTotal(record))}</span>
    </span>
  );
}
