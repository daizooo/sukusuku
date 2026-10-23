'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MoneyCategory, MoneyFeedItem, MoneyRecord, MoneyWallet } from '@/types/app';
import type { MoneyFeedFill, MoneyFeedResolve } from '@/lib/api/moneyFeed';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { formatYen, recordTotal, type PendingEstimate } from '@/lib/moneyUtils';
import { feedAmountLabel, feedDayLabel, feedStatusLabel, feedStoreName, sortFeedInbox } from '@/lib/moneyFeedUtils';
import { ModalShell } from '../modals/TaskForm';
import { FullScreen, PrimaryButton, ScreenHeader, incomeAmountClass } from './moneyVisual';
import { Chip, ChipRow, Field, ToggleRow, WalletChoices, feedInputClass } from './feedParts';

// 取り込んだ明細の「未確認」（docs/kakei.md §9.5.5・§9.5.6.1）。mobile版の `mobile/src/components/money/MoneyFeedInbox.tsx` と同じ並び・文言。
//
// 記録の面の上の帯「未確定明細 n件」から開く（2026-10-21。docs/kakei.md §0.7）。見出しは「Gmail から取り込んだ明細」と「見込み」の2つ。
// 一覧にボタンは置かない。行を押すと中（下から開く画面）で片づける。
// Gmail の明細は、手入力との確認 → 口座が決まっていない → 未確認 → 読めない の順。
// 1件を押すと片づけ方を選ぶ枠: 口座を選ぶ／手入力と同じか（同じ取引・振替に置き換える・別の取引）／
// 記録を作成する・記録しない。記録を作成するは、額・日付・出金元・お店を入れた記録の入力を開く（カテゴリは人が選ぶ。2026-10-19）。
// 見込み（帯に出すルールの、日が来て記録が無い回。pendingEstimates）は、中で額を直して「この額で記録する」「翌月へ送る」「今月はなし」。

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
  /** 帯に出す見込みのうち、日が来て記録が無い回。 */
  estimates: PendingEstimate[];
  /** この額で記録する（出金元があればその場で記録、無ければ記録の入力を開く）。 */
  onRecordEstimate: (entry: PendingEstimate, amount: number) => void;
  /** 翌月へ送る（翌月1日まで帯に出さない）。 */
  onDeferEstimate: (entry: PendingEstimate) => Promise<boolean>;
  /** 今月はなし（その回を skippedMonths に足す）。 */
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
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(() => sortFeedInbox(items), [items]);
  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? null;
  const opened = items.find((item) => item.id === openId) ?? null;
  const [estimateOpen, setEstimateOpen] = useState<string | null>(null);
  const openedEstimate = estimates.find((entry) => estimateKey(entry) === estimateOpen) ?? null;

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title={`未確定明細 ${items.length + estimates.length}件`} icon="back" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 bg-gray-50 p-4 pb-8">
        {sorted.length === 0 && estimates.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">未確定の明細はありません</p>
        )}
        {sorted.length > 0 && <p className="text-[13px] font-extrabold text-gray-700">Gmail から取り込んだ明細</p>}
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
        {estimates.length > 0 && (
          <p className={`text-[13px] font-extrabold text-gray-700 ${sorted.length > 0 ? 'pt-2' : ''}`}>見込み</p>
        )}
        {estimates.map((entry) => (
          <button
            key={estimateKey(entry)}
            type="button"
            onClick={() => setEstimateOpen(estimateKey(entry))}
            className="flex w-full items-center gap-2.5 rounded-2xl border border-gray-200 bg-white p-3 text-left hover:bg-gray-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-gray-900">{estimateName(entry, categories)}</span>
              <span className="mt-0.5 block truncate text-xs text-gray-500">
                {feedDayLabel(entry.date)}
                {walletName(entry.rule.walletId) ? `・${walletName(entry.rule.walletId)}` : ''}
              </span>
            </span>
            <span className="rounded-md bg-amber-100 px-1.5 py-px text-[11px] font-bold text-amber-800">
              {entry.rule.amountMode === 'estimate' ? '見込み' : '確定'}
            </span>
            <span className="text-base font-extrabold tabular-nums text-gray-900">{formatYen(entry.amount)}</span>
            <ChevronRight size={18} className="text-gray-400" />
          </button>
        ))}
      </div>
      {openedEstimate && (
        <EstimateModal
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
        <FeedItemModal
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
    </FullScreen>
  );
}

const candidateButtonClass = 'rounded-lg bg-blue-100 px-3 py-2 text-[13px] font-bold text-blue-800 disabled:opacity-50';

function FeedItemModal({
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
  const [fillOn, setFillOn] = useState(() => toDateStringInTimeZone(new Date(item.receivedAt)));
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

  // 未確認: 記録を作成する（額・日付・出金元・お店を入れた記録の入力を開く）・記録しない。
  // 同じお店でも買うものでカテゴリが変わるので、カテゴリはここで決めず、記録の入力で選ぶ（品目を分けてもよい。2026-10-19）
  return (
    <ModalShell
      title={walletName(item.walletId)}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <PrimaryButton label="記録を作成する" disabled={busy} onClick={onRecord} />
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
        {summary}
        {feedStoreName(item) !== '' && <p className="text-sm font-bold text-gray-900">お店: {feedStoreName(item)}</p>}
        <p className="text-xs leading-relaxed text-gray-500">
          {item.amazonOrderId
            ? '記録を作成するを押すと、額・日付（発送日）・出金元・お店と、荷物の品目を入れた記録の入力を開きます。値引きは「値引き」の行（値引きされた品目と同じカテゴリ）にしてあります。カテゴリの決まっていない品目を選んで保存してください。'
            : '記録を作成するを押すと、額・日付・出金元・お店を入れた記録の入力を開きます。カテゴリを選んで保存してください。'}
          記録しないときは、残高がずれたら口座の詳細から補正してください。
        </p>
      </div>
    </ModalShell>
  );
}

/** 見込みの中: カテゴリ・日・出金元と額（直せる）。この額で記録する／翌月へ送る／今月はなし。 */
function EstimateModal({
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
  const rows: [string, string][] = [
    ['カテゴリ', category ? (parent ? `${parent.name} › ${category.name}` : category.name) : '—'],
    ['日', feedDayLabel(entry.date)],
    ['出金元', wallet?.name ?? '記録の入力で選ぶ'],
  ];
  const secondaryClass = 'flex-1 rounded-xl border border-gray-300 py-3 text-sm font-bold text-gray-700 disabled:opacity-50';
  return (
    <ModalShell
      title={name}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <PrimaryButton label="この額で記録する" disabled={busy || amount <= 0} onClick={() => onRecord(amount)} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void run(onDefer)} className={secondaryClass}>
              翌月へ送る
            </button>
            <button type="button" disabled={busy} onClick={() => void run(onSkip)} className={secondaryClass}>
              今月はなし
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-gray-100 px-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center gap-3 py-2.5">
              <span className="text-sm font-semibold text-gray-700">{label}</span>
              <span className="min-w-0 flex-1 truncate text-right text-sm font-bold text-gray-900">{value}</span>
            </div>
          ))}
        </div>
        <Field label="金額（円）">
          <input
            className={feedInputClass}
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            onFocus={(event) => event.target.select()}
            inputMode="numeric"
          />
        </Field>
        {entry.plannedMonth !== entry.date.slice(0, 7) && (
          <p className="text-xs leading-relaxed text-gray-500">{Number(entry.plannedMonth.slice(5, 7))}月の分で、まだ記録がありません。</p>
        )}
      </div>
    </ModalShell>
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
