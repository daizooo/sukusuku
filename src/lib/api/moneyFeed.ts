import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/types/supabase';
import type {
  MoneyFeedAccount,
  MoneyFeedData,
  MoneyFeedItem,
  MoneyFeedRule,
  MoneyFeedRuleDraft,
  MoneyFeedSettings,
  MoneyWalletFeed,
} from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;
type FeedRow = Pick<
  Tables<'money_feed'>,
  | 'id'
  | 'received_at'
  | 'to_email'
  | 'subject'
  | 'direction'
  | 'occurred_on'
  | 'amount'
  | 'account_name'
  | 'description'
  | 'wallet_id'
  | 'status'
  | 'pair_id'
  | 'record_id'
  | 'candidate_record_ids'
>;
type RuleRow = Tables<'money_feed_rules'>;

// Zaim 取り込みの読み書き（家計タブ。docs/kakei.md §9.5）。mobile版の `mobile/src/lib/api/moneyFeed.ts` と同じ。
// 明細を入れるのはサーバー（Edge Function money-feed-ingest）。アプリは読む・片づける（money_feed_resolve）・設定を直す。

const FEED_COLUMNS =
  'id, received_at, to_email, subject, direction, occurred_on, amount, account_name, description, wallet_id, status, pair_id, record_id, candidate_record_ids';

/** 片づいていない明細（未確認・確認・読めない）。 */
export const OPEN_FEED_STATUSES = ['pending', 'confirm', 'unreadable'] as const;

const DEFAULT_SETTINGS: MoneyFeedSettings = { startAt: null, pairDays: 3, estimateDays: 5, manualDays: 3 };

const rowToFeed = (row: FeedRow): MoneyFeedItem => ({
  id: row.id,
  receivedAt: row.received_at,
  toEmail: row.to_email,
  subject: row.subject,
  direction: row.direction === 'in' || row.direction === 'out' ? row.direction : null,
  occurredOn: row.occurred_on,
  amount: row.amount,
  accountName: row.account_name,
  description: row.description,
  walletId: row.wallet_id,
  status: row.status as MoneyFeedItem['status'],
  pairId: row.pair_id,
  recordId: row.record_id,
  candidateRecordIds: row.candidate_record_ids ?? [],
});

const rowToRule = (row: RuleRow): MoneyFeedRule => ({
  id: row.id,
  position: row.position,
  name: row.name,
  walletId: row.wallet_id,
  direction: row.direction === 'in' || row.direction === 'out' ? row.direction : null,
  match: row.match === 'key' ? 'key' : 'contains',
  pattern: row.pattern,
  amountMin: row.amount_min,
  amountMax: row.amount_max,
  action: row.action as MoneyFeedRule['action'],
  recordKind: row.record_kind === 'expense' || row.record_kind === 'income' ? row.record_kind : null,
  categoryId: row.category_id,
  store: row.store,
  toWalletId: row.to_wallet_id,
  recurringId: row.recurring_id,
  learned: row.learned,
});

/** 取り込みの画面に要るもの（明細・ルール・設定・口座の対応）を並べて読む。 */
export async function loadMoneyFeed(supabase: SupabaseDb, familyId: string): Promise<MoneyFeedData> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [open, recent, rules, settings, wallets] = await Promise.all([
    supabase
      .from('money_feed')
      .select(FEED_COLUMNS)
      .eq('family_id', familyId)
      .in('status', [...OPEN_FEED_STATUSES])
      .order('received_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(200),
    // 届いた口座名と、最後に届いた日時・この30日の件数・明細から来た記録（新しい500件から）
    supabase
      .from('money_feed')
      .select('account_name, to_email, received_at, record_id')
      .eq('family_id', familyId)
      .order('received_at', { ascending: false })
      .limit(500),
    supabase
      .from('money_feed_rules')
      .select('*')
      .eq('family_id', familyId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('money_feed_settings')
      .select('start_at, pair_days, estimate_days, manual_days')
      .eq('family_id', familyId)
      .maybeSingle(),
    supabase
      .from('money_wallets')
      .select('id, feed_name, holder_name, holder_zaim_email, holder_kana')
      .eq('family_id', familyId),
  ]);
  for (const result of [open, recent, rules, settings, wallets]) if (result.error) throw result.error;

  const accounts = new Map<string, MoneyFeedAccount>();
  for (const row of recent.data ?? []) {
    if (!row.account_name) continue;
    const key = `${row.account_name}\n${(row.to_email ?? '').toLowerCase()}`;
    if (!accounts.has(key)) {
      accounts.set(key, { accountName: row.account_name, toEmail: row.to_email, lastReceivedAt: row.received_at });
    }
  }
  const recentRows = recent.data ?? [];

  return {
    open: (open.data ?? []).map(rowToFeed),
    rules: (rules.data ?? []).map(rowToRule),
    settings: settings.data
      ? {
          startAt: settings.data.start_at,
          pairDays: settings.data.pair_days,
          estimateDays: settings.data.estimate_days,
          manualDays: settings.data.manual_days,
        }
      : DEFAULT_SETTINGS,
    walletFeeds: (wallets.data ?? []).map(
      (row): MoneyWalletFeed => ({
        walletId: row.id,
        feedName: row.feed_name,
        holderName: row.holder_name,
        holderZaimEmail: row.holder_zaim_email,
        holderKana: row.holder_kana,
      }),
    ),
    accounts: [...accounts.values()],
    linkedRecordIds: [...new Set(recentRows.flatMap((row) => (row.record_id ? [row.record_id] : [])))],
    lastReceivedAt: recentRows[0]?.received_at ?? null,
    recentCount: recentRows.filter((row) => row.received_at >= since).length,
  };
}

/** 明細の片づけ方（§9.5.5・§9.5.6.1）。DB の money_feed_resolve の動きと同じ。 */
export type MoneyFeedResolve =
  | { action: 'wallet'; walletId: string; remember: boolean }
  | { action: 'link'; recordId: string; learn: boolean }
  | { action: 'replace'; recordId: string }
  | { action: 'separate' }
  | { action: 'record'; categoryId: string; store: string; learn: boolean }
  | { action: 'transfer'; toWalletId: string; learn: boolean }
  | { action: 'ignore'; learn: boolean };

/** 明細を1件片づける。返り値は片づけたあとの状態（pending なら、まだ未確認に残る）。 */
export async function resolveMoneyFeed(supabase: SupabaseDb, feedId: string, resolve: MoneyFeedResolve): Promise<string> {
  const args: Record<string, unknown> = {};
  if (resolve.action === 'wallet') Object.assign(args, { wallet_id: resolve.walletId, remember: resolve.remember });
  if (resolve.action === 'link') Object.assign(args, { record_id: resolve.recordId, learn: resolve.learn });
  if (resolve.action === 'replace') Object.assign(args, { record_id: resolve.recordId });
  if (resolve.action === 'record') {
    Object.assign(args, { category_id: resolve.categoryId, store: resolve.store, learn: resolve.learn });
  }
  if (resolve.action === 'transfer') Object.assign(args, { to_wallet_id: resolve.toWalletId, learn: resolve.learn });
  if (resolve.action === 'ignore') Object.assign(args, { learn: resolve.learn });
  const { data, error } = await supabase.rpc('money_feed_resolve', {
    p_feed: feedId,
    p_action: resolve.action,
    p_args: args as Database['public']['Functions']['money_feed_resolve']['Args']['p_args'],
  });
  if (error) throw error;
  return data;
}

/** 読めないメールに、口座・向き・日付・額を手で入れて未確認に戻し、突き合わせる。返り値は突き合わせたあとの状態。 */
export interface MoneyFeedFill {
  walletId: string;
  direction: 'in' | 'out';
  occurredOn: string;
  amount: number;
}

export async function fillMoneyFeed(supabase: SupabaseDb, feedId: string, fill: MoneyFeedFill): Promise<string> {
  const { data, error } = await supabase.rpc('money_feed_fill', {
    p_feed: feedId,
    p_wallet: fill.walletId,
    p_direction: fill.direction,
    p_occurred_on: fill.occurredOn,
    p_amount: fill.amount,
  });
  if (error) throw error;
  return data;
}

/** 口座の対応・ルールを直したあと、未確認を突き合わせ直す。返り値は片づいた件数。 */
export async function reprocessMoneyFeed(supabase: SupabaseDb): Promise<number> {
  const { data, error } = await supabase.rpc('money_feed_reprocess');
  if (error) throw error;
  return data;
}

/** 取り込みの鍵を作り直す。鍵はこの返り値でしか見られない（DB にはハッシュだけ）。 */
export async function issueMoneyFeedToken(supabase: SupabaseDb): Promise<string> {
  const { data, error } = await supabase.rpc('money_feed_issue_token');
  if (error) throw error;
  return data;
}

export async function saveMoneyFeedSettings(
  supabase: SupabaseDb,
  familyId: string,
  settings: Pick<MoneyFeedSettings, 'pairDays' | 'estimateDays' | 'manualDays'>,
): Promise<void> {
  const { error } = await supabase.from('money_feed_settings').upsert(
    {
      family_id: familyId,
      pair_days: settings.pairDays,
      estimate_days: settings.estimateDays,
      manual_days: settings.manualDays,
    },
    { onConflict: 'family_id' },
  );
  if (error) throw error;
}

/** 出金元の Zaim での口座名と所持者を直す。同じ宛先・口座名を持つほかの出金元からは外す。 */
export async function saveMoneyWalletFeed(
  supabase: SupabaseDb,
  familyId: string,
  feed: MoneyWalletFeed,
  previous: MoneyWalletFeed[],
): Promise<void> {
  const email = feed.holderZaimEmail?.toLowerCase() ?? null;
  const clash = previous.filter(
    (entry) =>
      entry.walletId !== feed.walletId &&
      feed.feedName !== null &&
      entry.feedName === feed.feedName &&
      (entry.holderZaimEmail === null || email === null || entry.holderZaimEmail.toLowerCase() === email),
  );
  for (const entry of clash) {
    const { error } = await supabase.from('money_wallets').update({ feed_name: null }).eq('id', entry.walletId);
    if (error) throw error;
  }
  const { error } = await supabase
    .from('money_wallets')
    .update({
      feed_name: feed.feedName,
      holder_name: feed.holderName,
      holder_zaim_email: feed.holderZaimEmail,
      holder_kana: feed.holderKana,
    })
    .eq('id', feed.walletId)
    .eq('family_id', familyId);
  if (error) throw error;
}

const ruleFields = (draft: MoneyFeedRuleDraft) => ({
  name: draft.name,
  wallet_id: draft.walletId,
  direction: draft.direction,
  match: draft.match,
  pattern: draft.pattern,
  amount_min: draft.amountMin,
  amount_max: draft.amountMax,
  action: draft.action,
  record_kind: draft.action === 'record' ? draft.recordKind : null,
  category_id: draft.action === 'record' ? draft.categoryId : null,
  store: draft.action === 'record' ? draft.store : '',
  to_wallet_id: draft.action === 'transfer' ? draft.toWalletId : null,
  recurring_id: draft.action === 'link_recurring' ? draft.recurringId : null,
});

export async function insertMoneyFeedRule(
  supabase: SupabaseDb,
  familyId: string,
  draft: MoneyFeedRuleDraft,
  position: number,
): Promise<MoneyFeedRule> {
  const { data, error } = await supabase
    .from('money_feed_rules')
    .insert({ ...ruleFields(draft), family_id: familyId, position })
    .select('*')
    .single();
  if (error) throw error;
  return rowToRule(data);
}

export async function updateMoneyFeedRule(supabase: SupabaseDb, id: string, draft: MoneyFeedRuleDraft): Promise<MoneyFeedRule> {
  const { data, error } = await supabase.from('money_feed_rules').update(ruleFields(draft)).eq('id', id).select('*').single();
  if (error) throw error;
  return rowToRule(data);
}

export async function deleteMoneyFeedRule(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_feed_rules').delete().eq('id', id);
  if (error) throw error;
}

/** ルールの並びを、渡した順（上から）にする。 */
export async function reorderMoneyFeedRules(supabase: SupabaseDb, ids: string[]): Promise<void> {
  const results = await Promise.all(
    ids.map((id, position) => supabase.from('money_feed_rules').update({ position }).eq('id', id)),
  );
  for (const result of results) if (result.error) throw result.error;
}
