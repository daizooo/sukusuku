'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Minus, Plus } from 'lucide-react';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyFeedAction,
  MoneyFeedData,
  MoneyFeedRule,
  MoneyFeedRuleDraft,
  MoneyRecord,
  MoneyRecurring,
  MoneyWallet,
  MoneyWalletFeed,
} from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { monthKeyOfDate } from '@/lib/moneyUtils';
import { FEED_ACTION_LABELS, feedRuleAction, feedRuleCondition, feedTimeLabel } from '@/lib/moneyFeedUtils';
import {
  deleteMoneyFeedRule,
  insertMoneyFeedRule,
  issueMoneyFeedToken,
  reorderMoneyFeedRules,
  reprocessMoneyFeed,
  saveMoneyFeedSettings,
  saveMoneyWalletFeed,
  updateMoneyFeedRule,
} from '@/lib/api/moneyFeed';
import { ModalShell } from '../modals/TaskForm';
import CategoryPicker from './CategoryPicker';
import { PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';
import { Chip, ChipRow, Field, WalletChoices, feedInputClass } from './feedParts';

// 家計の設定の「Zaim 取り込み」（docs/kakei.md §9.5.6）。mobile版の `mobile/src/components/money/MoneyFeedSettings.tsx` と同じ並び・文言。
//
// 取り込みに関わる設定をここ1か所で決める: 取り込みの状態と鍵／口座の対応（Zaim の口座名 → 出金元と所持者）／
// 取り込みのルール（条件と動き。上から見て最初に当たったもの）／突き合わせの幅（日数）。
// 口座の対応・ルールを直したら、未確認の明細を突き合わせ直す（money_feed_reprocess）。

interface MoneyFeedSettingsProps {
  familyId: string;
  feed: MoneyFeedData | null;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  records: MoneyRecord[];
  recurring: MoneyRecurring[];
  /** 直したあとに読み直す（明細も突き合わせ直したあと）。 */
  onChanged: () => Promise<void>;
  onBack: () => void;
}

/** 口座の対応の1行。届いた口座名か、口座名を入れてある出金元。 */
interface AccountRow {
  key: string;
  accountName: string;
  toEmail: string | null;
  walletFeed: MoneyWalletFeed | null;
}

const failed = () => window.alert('保存できませんでした。もう一度お試しください。');

/** ひな形（§9.5.6）。ATM・カード会社の文字は、実物のメールが届いたら合わせる。 */
const TEMPLATES: { label: string; draft: Partial<MoneyFeedRuleDraft> }[] = [
  { label: 'ATM の出金 → 財布へ振替', draft: { name: 'ATM の出金', direction: 'out', pattern: 'ATM', action: 'transfer' } },
  { label: 'カードの引き落とし → 補正のみ', draft: { name: 'カードの引き落とし', direction: 'out', pattern: 'カード', action: 'adjust_only' } },
];

const EMPTY_RULE: MoneyFeedRuleDraft = {
  name: '',
  walletId: null,
  direction: null,
  match: 'contains',
  pattern: '',
  amountMin: null,
  amountMax: null,
  action: 'record',
  recordKind: 'expense',
  categoryId: null,
  store: '',
  toWalletId: null,
  recurringId: null,
};

const sectionTitleClass = 'mt-3 text-xs font-bold text-gray-700';
const subClass = 'text-xs leading-relaxed text-gray-500';
const cardClass = 'overflow-hidden rounded-2xl border border-gray-200 bg-white';
const rowClass = 'flex w-full items-center gap-2.5 px-3.5 py-3 text-left';
const dividedClass = 'border-t border-gray-200';

export default function MoneyFeedSettings({
  familyId,
  feed,
  wallets,
  categories,
  budgets,
  records,
  recurring,
  onChanged,
  onBack,
}: MoneyFeedSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [rule, setRule] = useState<{ target: MoneyFeedRule | null; draft: MoneyFeedRuleDraft } | null>(null);

  const walletName = (id: string) => wallets.find((wallet) => wallet.id === id)?.name ?? '（使わない出金元）';
  const names = {
    wallet: walletName,
    category: (id: string) => categories.find((category) => category.id === id)?.name ?? '（削除した種類）',
    recurring: (id: string) => recurring.find((entry) => entry.id === id)?.name || '（固定の記録）',
  };

  const accountRows = useMemo<AccountRow[]>(() => {
    if (!feed) return [];
    const rows = new Map<string, AccountRow>();
    const keyOf = (name: string, email: string | null) => `${name}\n${(email ?? '').toLowerCase()}`;
    const mapped = (name: string, email: string | null) =>
      feed.walletFeeds.find(
        (entry) =>
          entry.feedName === name &&
          (entry.holderZaimEmail === null || email === null || entry.holderZaimEmail.toLowerCase() === email.toLowerCase()),
      ) ?? null;
    for (const entry of feed.accounts) {
      rows.set(keyOf(entry.accountName, entry.toEmail), {
        key: keyOf(entry.accountName, entry.toEmail),
        accountName: entry.accountName,
        toEmail: entry.toEmail,
        walletFeed: mapped(entry.accountName, entry.toEmail),
      });
    }
    for (const entry of feed.walletFeeds) {
      if (entry.feedName === null) continue;
      const key = keyOf(entry.feedName, entry.holderZaimEmail);
      if (![...rows.values()].some((row) => row.walletFeed?.walletId === entry.walletId)) {
        rows.set(key, { key, accountName: entry.feedName, toEmail: entry.holderZaimEmail, walletFeed: entry });
      }
    }
    return [...rows.values()].sort((a, b) => a.accountName.localeCompare(b.accountName, 'ja'));
  }, [feed]);

  if (!feed) {
    return (
      <StackedScreen onBack={onBack}>
        <ScreenHeader title="Zaim 取り込み" icon="back" onClose={onBack} />
        <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
      </StackedScreen>
    );
  }

  const unreadable = feed.open.filter((item) => item.status === 'unreadable').length;
  const open = feed.open.length - unreadable;

  const afterChange = async () => {
    try {
      await reprocessMoneyFeed(supabase);
    } finally {
      await onChanged();
    }
  };

  const issueToken = async () => {
    if (!window.confirm('取り込みの鍵を作り直しますか？いまの鍵は使えなくなります。Apps Script の FEED_TOKEN を新しい鍵に入れ替えてください。')) {
      return;
    }
    try {
      setToken(await issueMoneyFeedToken(supabase));
    } catch {
      failed();
    }
  };

  const saveDays = async (key: 'pairDays' | 'estimateDays' | 'manualDays', value: number) => {
    try {
      await saveMoneyFeedSettings(supabase, familyId, { ...feed.settings, [key]: Math.max(0, Math.min(14, value)) });
      await afterChange();
    } catch {
      failed();
    }
  };

  const moveRule = async (index: number, delta: number) => {
    const ids = feed.rules.map((entry) => entry.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorderMoneyFeedRules(supabase, ids);
      await afterChange();
    } catch {
      failed();
    }
  };

  const saveRule = async (target: MoneyFeedRule | null, draft: MoneyFeedRuleDraft) => {
    setRule(null);
    try {
      if (target) await updateMoneyFeedRule(supabase, target.id, draft);
      else await insertMoneyFeedRule(supabase, familyId, draft, feed.rules.reduce((max, entry) => Math.max(max, entry.position + 1), 0));
      await afterChange();
    } catch {
      failed();
    }
  };

  const removeRule = async (target: MoneyFeedRule) => {
    if (!window.confirm('このルールを削除しますか？作った記録はそのまま残ります。')) return;
    setRule(null);
    try {
      await deleteMoneyFeedRule(supabase, target.id);
      await onChanged();
    } catch {
      failed();
    }
  };

  const saveAccount = async (next: MoneyWalletFeed) => {
    setAccount(null);
    try {
      await saveMoneyWalletFeed(supabase, familyId, next, feed.walletFeeds);
      await afterChange();
    } catch {
      failed();
    }
  };

  return (
    <StackedScreen onBack={onBack}>
      <ScreenHeader title="Zaim 取り込み" icon="back" onClose={onBack} />
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 p-4 pb-10">
        <p className="text-[13px] leading-relaxed text-gray-500">
          Zaim の入出金通知メールを Gmail の Apps Script が送り、口座の明細として取り込みます。振替・自動の記録・手入力と突き合わせ、
          当たらないものは「口座」の面の「未確認」に残ります。
        </p>

        <p className={sectionTitleClass}>取り込みの状態</p>
        <div className={cardClass}>
          <InfoRow label="最後に届いた" value={feedTimeLabel(feed.lastReceivedAt)} />
          <InfoRow label="この30日" value={`${feed.recentCount}件`} />
          <InfoRow label="未確認" value={`${open}件`} />
          {unreadable > 0 && <InfoRow label="読めないメール" value={`${unreadable}件`} />}
          <InfoRow label="取り込みの開始" value={feedTimeLabel(feed.settings.startAt)} />
          <button type="button" onClick={() => void issueToken()} className={`${rowClass} ${dividedClass} text-sm font-bold text-blue-600`}>
            取り込みの鍵を作り直す
          </button>
        </div>

        <p className={sectionTitleClass}>口座の対応</p>
        <p className={subClass}>Zaim の口座名を、かぞく手帳の出金元に結びます。所持者で、同じ銀行の口座を分けます。</p>
        <div className={cardClass}>
          {accountRows.length === 0 && <p className="p-3.5 text-[13px] text-gray-400">まだ明細が届いていません</p>}
          {accountRows.map((row, index) => (
            <button
              key={row.key}
              type="button"
              onClick={() => setAccount(row)}
              className={`${rowClass} ${index > 0 ? dividedClass : ''} hover:bg-gray-50`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-gray-900">{row.accountName}</span>
                {row.toEmail && <span className="block truncate text-xs text-gray-500">{row.toEmail}</span>}
              </span>
              <span className={`max-w-[50%] truncate text-[13px] font-semibold ${row.walletFeed ? 'text-gray-700' : 'text-red-600'}`}>
                {row.walletFeed ? walletName(row.walletFeed.walletId) : '未設定'}
              </span>
              <ChevronRight size={16} className="text-gray-400" />
            </button>
          ))}
        </div>

        <p className={sectionTitleClass}>取り込みのルール</p>
        <p className={subClass}>上から見て、最初に当たったルールで扱います。「次から同じ内容は自動で」で覚えたものも並びます。</p>
        <div className={cardClass}>
          {feed.rules.length === 0 && <p className="p-3.5 text-[13px] text-gray-400">ルールはまだありません</p>}
          {feed.rules.map((entry, index) => (
            <div key={entry.id} className={`${rowClass} ${index > 0 ? dividedClass : ''}`}>
              <button type="button" onClick={() => setRule({ target: entry, draft: { ...entry } })} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-bold text-gray-900">
                  {entry.name || FEED_ACTION_LABELS[entry.action]}
                  {entry.learned ? '（覚えたルール）' : ''}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">{feedRuleCondition(entry, walletName)}</span>
                <span className="mt-0.5 block text-xs font-semibold text-blue-800">→ {feedRuleAction(entry, names)}</span>
              </button>
              <span className="flex flex-col gap-2.5">
                <button type="button" aria-label="上へ" onClick={() => void moveRule(index, -1)} className={index === 0 ? 'text-gray-200' : 'text-gray-500'}>
                  <ArrowUp size={18} />
                </button>
                <button
                  type="button"
                  aria-label="下へ"
                  onClick={() => void moveRule(index, 1)}
                  className={index === feed.rules.length - 1 ? 'text-gray-200' : 'text-gray-500'}
                >
                  <ArrowDown size={18} />
                </button>
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRule({ target: null, draft: EMPTY_RULE })}
          className="flex items-center gap-2 py-2.5 text-[15px] font-bold text-blue-600"
        >
          <Plus size={18} />
          ルールを足す
        </button>
        <div className="space-y-1.5">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => setRule({ target: null, draft: { ...EMPTY_RULE, ...template.draft } })}
              className="block w-full rounded-lg bg-blue-50 px-3 py-2 text-left text-[13px] font-semibold text-blue-800"
            >
              ひな形: {template.label}
            </button>
          ))}
        </div>

        <p className={sectionTitleClass}>突き合わせの幅</p>
        <div className={cardClass}>
          <DaysRow label="振替の組み合わせ" value={feed.settings.pairDays} onChange={(value) => void saveDays('pairDays', value)} />
          <DaysRow label="自動の記録との照合" value={feed.settings.estimateDays} onChange={(value) => void saveDays('estimateDays', value)} divided />
          <DaysRow label="手入力との確認" value={feed.settings.manualDays} onChange={(value) => void saveDays('manualDays', value)} divided />
        </div>
      </div>

      {token !== null && <TokenModal token={token} onClose={() => setToken(null)} />}
      {account !== null && (
        <AccountModal
          row={account}
          wallets={wallets}
          walletFeeds={feed.walletFeeds}
          onClose={() => setAccount(null)}
          onSubmit={(next) => void saveAccount(next)}
        />
      )}
      {rule !== null && (
        <RuleModal
          target={rule.target}
          initial={rule.draft}
          wallets={wallets}
          categories={categories}
          budgets={budgets}
          records={records}
          recurring={recurring}
          onClose={() => setRule(null)}
          onSubmit={(draft) => void saveRule(rule.target, draft)}
          onDelete={rule.target ? () => void removeRule(rule.target!) : undefined}
        />
      )}
    </StackedScreen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-3.5 py-2 text-[13px]">
      <span className="font-semibold text-gray-500">{label}</span>
      <span className="font-bold tabular-nums text-gray-900">{value}</span>
    </div>
  );
}

function DaysRow({ label, value, onChange, divided }: { label: string; value: number; onChange: (value: number) => void; divided?: boolean }) {
  return (
    <div className={`${rowClass} ${divided ? dividedClass : ''}`}>
      <span className="flex-1 text-sm font-bold text-gray-900">{label}</span>
      <button type="button" aria-label="1日へらす" disabled={value <= 0} onClick={() => onChange(value - 1)} className="text-gray-500 disabled:text-gray-200">
        <Minus size={18} />
      </button>
      <span className="min-w-16 text-center text-sm font-bold text-gray-900">前後{value}日</span>
      <button type="button" aria-label="1日ふやす" disabled={value >= 14} onClick={() => onChange(value + 1)} className="text-gray-500 disabled:text-gray-200">
        <Plus size={18} />
      </button>
    </div>
  );
}

function TokenModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <ModalShell
      title="新しい取り込みの鍵"
      onClose={onClose}
      footer={
        <PrimaryButton
          label={copied ? 'コピーしました' : 'コピーする'}
          onClick={() => {
            void navigator.clipboard.writeText(token).then(() => setCopied(true));
          }}
        />
      }
    >
      <div className="space-y-3">
        <p className="break-all select-all text-[15px] font-bold tracking-wide text-gray-900">{token}</p>
        <p className={subClass}>
          この鍵はいまだけ表示します。Apps Script の「スクリプト プロパティ」の FEED_TOKEN に貼ってください。人には見せないでください。
        </p>
      </div>
    </ModalShell>
  );
}

function AccountModal({
  row,
  wallets,
  walletFeeds,
  onClose,
  onSubmit,
}: {
  row: AccountRow;
  wallets: MoneyWallet[];
  walletFeeds: MoneyWalletFeed[];
  onClose: () => void;
  onSubmit: (next: MoneyWalletFeed) => void;
}) {
  const [walletId, setWalletId] = useState<string | null>(row.walletFeed?.walletId ?? null);
  const current = walletFeeds.find((entry) => entry.walletId === walletId) ?? null;
  const [holderName, setHolderName] = useState(row.walletFeed?.holderName ?? '');
  const [email, setEmail] = useState(row.walletFeed?.holderZaimEmail ?? row.toEmail ?? '');
  const [kana, setKana] = useState(row.walletFeed?.holderKana ?? '');

  const pick = (id: string) => {
    setWalletId(id);
    const entry = walletFeeds.find((feed) => feed.walletId === id);
    if (entry && !row.walletFeed) {
      setHolderName(entry.holderName ?? '');
      setKana(entry.holderKana ?? '');
    }
  };

  return (
    <ModalShell
      title={`「${row.accountName}」の口座`}
      onClose={onClose}
      footer={
        <PrimaryButton
          label="保存する"
          disabled={walletId === null}
          onClick={() =>
            walletId &&
            onSubmit({
              walletId,
              feedName: row.accountName,
              holderName: holderName.trim() || null,
              holderZaimEmail: email.trim() || null,
              holderKana: kana.trim() || null,
            })
          }
        />
      }
    >
      <div className="space-y-4">
        <Field label="かぞく手帳の出金元">
          <WalletChoices
            wallets={wallets.filter((wallet) => wallet.type === 'bank' || wallet.type === 'securities' || wallet.id === walletId)}
            selectedId={walletId}
            onPick={pick}
          />
        </Field>
        {current?.feedName && current.feedName !== row.accountName && (
          <p className={subClass}>この出金元には「{current.feedName}」が結ばれています。保存すると「{row.accountName}」に変わります。</p>
        )}
        <Field label="所持者（例: 本人・妻・子）">
          <input className={feedInputClass} value={holderName} onChange={(event) => setHolderName(event.target.value)} placeholder="本人" />
        </Field>
        <Field label="所持者の Zaim のアカウント（通知の宛先）" hint="同じ銀行の口座が2つあるとき、宛先で分けます。">
          <input
            className={feedInputClass}
            type="email"
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="example@gmail.com"
          />
        </Field>
        <Field label="名義（カナ）" hint="自分の口座から振り込んだ出金は、依頼人名が名義になります。宛先で分けられないときに使います。">
          <input className={feedInputClass} value={kana} onChange={(event) => setKana(event.target.value)} placeholder="ヤマダ タロウ" />
        </Field>
      </div>
    </ModalShell>
  );
}

const ACTIONS: MoneyFeedAction[] = ['record', 'transfer', 'link_recurring', 'adjust_only', 'ignore'];

function RuleModal({
  target,
  initial,
  wallets,
  categories,
  budgets,
  records,
  recurring,
  onClose,
  onSubmit,
  onDelete,
}: {
  target: MoneyFeedRule | null;
  initial: MoneyFeedRuleDraft;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  records: MoneyRecord[];
  recurring: MoneyRecurring[];
  onClose: () => void;
  onSubmit: (draft: MoneyFeedRuleDraft) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<MoneyFeedRuleDraft>(initial);
  const [pickingCategory, setPickingCategory] = useState(false);
  const set = (patch: Partial<MoneyFeedRuleDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const accounts = wallets.filter((wallet) => !wallet.archived && (wallet.type === 'bank' || wallet.type === 'securities'));
  const usableRecurring = recurring.filter((entry) => !entry.archived);
  const categoryName = categories.find((category) => category.id === draft.categoryId)?.name ?? null;
  const amount = (text: string): number | null => {
    const value = Number(text.replace(/[^0-9]/g, ''));
    return text.trim() === '' || !Number.isFinite(value) ? null : value;
  };

  const valid =
    (draft.action !== 'record' || draft.categoryId !== null) &&
    (draft.action !== 'transfer' || draft.toWalletId !== null) &&
    (draft.action !== 'link_recurring' || draft.recurringId !== null);

  return (
    <>
      <ModalShell
        title={target ? 'ルールを編集' : 'ルールを足す'}
        onClose={onClose}
        footer={
          <div className="space-y-1">
            <PrimaryButton
              label="保存する"
              disabled={!valid}
              onClick={() => onSubmit({ ...draft, name: draft.name.trim(), pattern: draft.pattern.trim() })}
            />
            {onDelete && (
              <button type="button" onClick={onDelete} className="w-full py-2 text-sm text-red-500">
                削除
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="名前（任意）">
            <input className={feedInputClass} value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder="例: ATM の出金" />
          </Field>
          <p className={sectionTitleClass}>条件（全部に当たったとき）</p>
          <Field label="口座">
            <ChipRow>
              <Chip label="どの口座でも" selected={draft.walletId === null} onClick={() => set({ walletId: null })} />
              {accounts.map((wallet) => (
                <Chip key={wallet.id} label={wallet.name} selected={draft.walletId === wallet.id} onClick={() => set({ walletId: wallet.id })} />
              ))}
            </ChipRow>
          </Field>
          <Field label="向き">
            <ChipRow>
              <Chip label="どちらでも" selected={draft.direction === null} onClick={() => set({ direction: null })} />
              <Chip label="出金" selected={draft.direction === 'out'} onClick={() => set({ direction: 'out' })} />
              <Chip label="入金" selected={draft.direction === 'in'} onClick={() => set({ direction: 'in' })} />
            </ChipRow>
          </Field>
          {draft.match === 'key' ? (
            <Field label="内容（覚えたもの）" hint="この内容と同じ明細に当たります（数字・日付・依頼人名は除いて比べます）。">
              <p className="text-sm font-semibold text-gray-900">{draft.pattern}</p>
            </Field>
          ) : (
            <Field label="内容に含む文字（空なら何でも）" hint="全角・半角は区別しません。">
              <input className={feedInputClass} value={draft.pattern} onChange={(event) => set({ pattern: event.target.value })} placeholder="例: ATM" />
            </Field>
          )}
          <Field label="金額（任意）">
            <div className="flex items-center gap-2">
              <input
                className={feedInputClass}
                inputMode="numeric"
                value={draft.amountMin === null ? '' : String(draft.amountMin)}
                onChange={(event) => set({ amountMin: amount(event.target.value) })}
                placeholder="下限"
              />
              <span className="text-sm font-semibold text-gray-500">〜</span>
              <input
                className={feedInputClass}
                inputMode="numeric"
                value={draft.amountMax === null ? '' : String(draft.amountMax)}
                onChange={(event) => set({ amountMax: amount(event.target.value) })}
                placeholder="上限"
              />
            </div>
          </Field>

          <p className={sectionTitleClass}>動き</p>
          <ChipRow>
            {ACTIONS.map((action) => (
              <Chip key={action} label={FEED_ACTION_LABELS[action]} selected={draft.action === action} onClick={() => set({ action })} />
            ))}
          </ChipRow>
          {draft.action === 'record' && (
            <>
              <ChipRow>
                <Chip label="支出" selected={draft.recordKind !== 'income'} onClick={() => set({ recordKind: 'expense', categoryId: null })} />
                <Chip label="収入" selected={draft.recordKind === 'income'} onClick={() => set({ recordKind: 'income', categoryId: null })} />
              </ChipRow>
              <Field label="種類">
                <button
                  type="button"
                  onClick={() => setPickingCategory(true)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-300 px-3 py-2 text-left"
                >
                  <span className={`text-[15px] font-semibold ${categoryName ? 'text-gray-900' : 'text-gray-400'}`}>
                    {categoryName ?? '種類を選ぶ'}
                  </span>
                  <ChevronRight size={18} className="text-gray-400" />
                </button>
              </Field>
              <Field label="お店（任意）">
                <input className={feedInputClass} value={draft.store} onChange={(event) => set({ store: event.target.value })} placeholder="例: 水道局" />
              </Field>
            </>
          )}
          {draft.action === 'transfer' && (
            <Field label="相手の出金元" hint="出金なら 口座 → 相手、入金なら 相手 → 口座 の振替を作ります。">
              <WalletChoices wallets={wallets} selectedId={draft.toWalletId} onPick={(toWalletId) => set({ toWalletId })} />
            </Field>
          )}
          {draft.action === 'link_recurring' && (
            <Field label="結ぶ固定の記録" hint="そのルールで作った記録（前後の日数は突き合わせの幅）と結び、額を明細の額にして確定します。">
              <ChipRow>
                {usableRecurring.map((entry) => (
                  <Chip
                    key={entry.id}
                    label={entry.name || entry.store || '（名前なし）'}
                    selected={draft.recurringId === entry.id}
                    onClick={() => set({ recurringId: entry.id })}
                  />
                ))}
              </ChipRow>
            </Field>
          )}
          {draft.action === 'adjust_only' && (
            <p className={subClass}>
              新しい記録は作りません。この口座から引き落とすカードの、カード代金の見込みの振替があれば額を明細の額にして確定し、無ければ記録しません。
            </p>
          )}
          {draft.action === 'ignore' && <p className={subClass}>記録を作りません。</p>}
        </div>
      </ModalShell>
      {pickingCategory && (
        // 種類の選択は CategoryPicker（StackedScreen）が戻る操作の層を積むので、ここでは枠だけ
        <div className="fixed inset-0 z-50 flex justify-center bg-black/30">
          <div className="flex h-full w-full max-w-md flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <CategoryPicker
            kind={draft.recordKind === 'income' ? 'income' : 'expense'}
            monthKey={monthKeyOfDate(new Date())}
            categories={categories}
            budgets={budgets}
            records={records}
            onPick={(choice) => {
              set({ categoryId: choice.categoryId });
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
