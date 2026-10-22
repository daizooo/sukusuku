import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables } from '@/types/supabase';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyCategoryKind,
  MoneyItem,
  MoneyMonth,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyRecurring,
  MoneyRecurringDraft,
  MoneyBudgetGroup,
  MoneyBudgetLine,
  MoneyStore,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
} from '@/types/app';
import { DEFAULT_CATEGORIES } from '@/lib/moneyUtils';

type CategoryRow = Tables<'money_categories'>;
type BudgetRow = Tables<'money_budgets'>;
type WalletRow = Tables<'money_wallets'>;
type StoreRow = Tables<'money_stores'>;
type RecordRow = Tables<'money_records'>;
type ItemRow = Tables<'money_items'>;
type RecurringRow = Tables<'money_recurring'>;
type BalanceRow = Tables<'money_wallet_balances'>;
type SupabaseDb = SupabaseClient<Database>;

// 家計タブの読み書き（カテゴリ・予算・出金元・記録。docs/kakei.md §3・§5）。
// mobile版の `mobile/src/lib/api/money.ts` と同じ。

export const rowToCategory = (row: CategoryRow): MoneyCategory => ({
  id: row.id,
  kind: row.kind === 'income' ? 'income' : 'living',
  parentId: row.parent_id,
  name: row.name,
  icon: row.icon ?? null,
  iconColor: row.icon_color ?? null,
  position: row.position,
  archived: row.archived_at !== null,
  budgetGroup: budgetGroupOf(row.budget_group ?? null),
});

const budgetGroupOf = (value: string | null): MoneyBudgetGroup =>
  value === 'reserve' || value === 'fixed' || value === 'estimate' ? value : 'variable';

export const rowToBudgetLine = (row: Tables<'money_budget_lines'>): MoneyBudgetLine => ({
  id: row.id,
  categoryId: row.category_id,
  name: row.name,
  amount: row.amount,
  months: row.months,
  noMonth: row.no_month,
  intervalYears: row.interval_years,
  startMonth: row.start_month === null ? null : row.start_month.slice(0, 7),
  endMonth: row.end_month === null ? null : row.end_month.slice(0, 7),
  position: row.position,
});

export const rowToBudget = (row: BudgetRow): MoneyBudget => ({
  id: row.id,
  categoryId: row.category_id,
  year: row.fiscal_year,
  // 古い行（month_amounts が無い）は、12か月ぜんぶが同じ額。
  monthAmounts:
    row.month_amounts !== null && row.month_amounts.length === 12
      ? row.month_amounts
      : Array.from({ length: 12 }, () => row.monthly_amount),
});

const WALLET_TYPES = ['card', 'cash', 'bank', 'prepaid', 'qr', 'securities'] as const;

export const rowToWallet = (row: WalletRow): MoneyWallet => ({
  id: row.id,
  name: row.name,
  type: WALLET_TYPES.find((type) => type === row.type) ?? 'cash',
  closeDay: row.close_day,
  payDay: row.pay_day,
  payMonthOffset: row.pay_month_offset,
  payWalletId: row.pay_wallet_id,
  iconColor: row.icon_color,
  position: row.position,
  archived: row.archived_at !== null,
});

export const rowToBalance = (row: BalanceRow): MoneyWalletBalance => ({
  id: row.id,
  walletId: row.wallet_id,
  balanceOn: row.balance_on,
  amount: row.amount,
  showInHistory: row.show_in_history,
});

export const rowToStore = (row: StoreRow): MoneyStore => ({
  id: row.id,
  name: row.name,
  position: row.position,
  archived: row.archived_at !== null,
});

const rowToItem = (row: ItemRow): MoneyItem => ({
  id: row.id,
  amount: row.amount,
  categoryId: row.category_id,
  categoryName: row.category_name,
  quantity: row.quantity,
  unitPrice: row.unit_price,
  name: row.name,
  memo: row.memo,
  receiptName: row.receipt_name ?? null,
});

export const rowToRecord = (row: RecordRow & { money_items: ItemRow[] }): MoneyRecord => ({
  id: row.id,
  kind: row.kind === 'income' ? 'income' : row.kind === 'transfer' ? 'transfer' : 'expense',
  occurredOn: row.occurred_on,
  walletId: row.wallet_id,
  toWalletId: row.to_wallet_id,
  store: row.store,
  createdBy: row.created_by,
  isEstimate: row.is_estimate,
  recurringId: row.recurring_id,
  month: row.month === null ? null : row.month.slice(0, 7),
  cardNextPeriod: row.card_next_period,
  items: [...row.money_items].sort((a, b) => a.position - b.position).map(rowToItem),
});

const RECORD_KINDS = ['expense', 'income', 'transfer'] as const;
const HOLIDAY_RULES = ['next', 'prev', 'none'] as const;

export const rowToRecurring = (row: RecurringRow): MoneyRecurring => ({
  id: row.id,
  kind: RECORD_KINDS.find((kind) => kind === row.kind) ?? 'expense',
  day: row.day,
  weekOfMonth: row.week_of_month,
  weekday: row.weekday,
  months: row.months,
  startMonth: row.start_month === null ? null : row.start_month.slice(0, 7),
  endMonth: row.end_month === null ? null : row.end_month.slice(0, 7),
  holiday: HOLIDAY_RULES.find((rule) => rule === row.holiday) ?? 'next',
  amountMode: row.amount_mode === 'fixed' ? 'fixed' : 'estimate',
  amount: row.amount,
  walletId: row.wallet_id,
  toWalletId: row.to_wallet_id,
  store: row.store,
  categoryId: row.category_id,
  name: row.name,
  position: row.position,
  archived: row.archived_at !== null,
  // 日本の日付（UTC+9）で。
  createdAt: new Date(Date.parse(row.created_at) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
  makesRecord: row.makes_record,
  skippedMonths: row.skipped_months,
  intervalYears: row.interval_years,
  dayKnown: row.day_known,
  deferredUntil: row.deferred_until,
});

/** 一度に読む行数（Supabase の Data API は1回に1000行まで）。 */
const PAGE = 500;

/**
 * 家族の記録をすべて読む（古い順）。1ページ目で総数が分かるので、残りのページは並べて読む
 * （順に読むと、記録が増えるほど往復が増えて家計タブの表示が遅くなる）。
 */
async function loadRecords(supabase: SupabaseDb, familyId: string): Promise<MoneyRecord[]> {
  const readPage = (from: number) =>
    supabase
      .from('money_records')
      .select('*, money_items(*)', { count: 'exact' })
      .eq('family_id', familyId)
      .order('occurred_on', { ascending: true })
      .order('created_at', { ascending: true })
      // 同じ日時の記録があってもページをまたいで並びが変わらないよう、最後は id で決める。
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

  const first = await readPage(0);
  if (first.error) throw first.error;
  const total = first.count ?? 0;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, index) => readPage((index + 1) * PAGE)),
  );
  const rows = [...(first.data ?? [])];
  for (const page of rest) {
    if (page.error) throw page.error;
    rows.push(...(page.data ?? []));
  }
  return rows.map(rowToRecord);
}

export interface MoneyData {
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  recurring: MoneyRecurring[];
  balances: MoneyWalletBalance[];
  /** 月の締め（docs/kakei.md §4.5）。 */
  months: MoneyMonth[];
  /** 予算の明細（収入・予備費・固定費。docs/kakei.md §0.7）。 */
  budgetLines: MoneyBudgetLine[];
}

export async function loadMoney(supabase: SupabaseDb, familyId: string): Promise<MoneyData> {
  const [categoryResult, budgetResult, walletResult, storeResult, recurringResult, balanceResult, monthResult, lineResult, records] =
    await Promise.all([
      supabase.from('money_categories').select('*').eq('family_id', familyId),
      supabase.from('money_budgets').select('*').eq('family_id', familyId),
      supabase.from('money_wallets').select('*').eq('family_id', familyId).order('position', { ascending: true }),
      supabase.from('money_stores').select('*').eq('family_id', familyId).order('position', { ascending: true }).order('name', { ascending: true }),
      supabase.from('money_recurring').select('*').eq('family_id', familyId).order('position', { ascending: true }),
      supabase.from('money_wallet_balances').select('*').eq('family_id', familyId),
      supabase.from('money_months').select('*').eq('family_id', familyId),
      supabase.from('money_budget_lines').select('*').eq('family_id', familyId).order('position', { ascending: true }),
      loadRecords(supabase, familyId),
    ]);
  if (categoryResult.error) throw categoryResult.error;
  if (budgetResult.error) throw budgetResult.error;
  if (walletResult.error) throw walletResult.error;
  if (storeResult.error) throw storeResult.error;
  if (recurringResult.error) throw recurringResult.error;
  if (balanceResult.error) throw balanceResult.error;
  if (monthResult.error) throw monthResult.error;
  if (lineResult.error) throw lineResult.error;
  return {
    categories: (categoryResult.data ?? []).map(rowToCategory),
    budgets: (budgetResult.data ?? []).map(rowToBudget),
    wallets: (walletResult.data ?? []).map(rowToWallet),
    stores: (storeResult.data ?? []).map(rowToStore),
    records,
    recurring: (recurringResult.data ?? []).map(rowToRecurring),
    balances: (balanceResult.data ?? []).map(rowToBalance),
    months: (monthResult.data ?? []).map(rowToMonth),
    budgetLines: (lineResult.data ?? []).map(rowToBudgetLine),
  };
}

// ---- 月の締め（docs/kakei.md §4.5） ----

export const rowToMonth = (row: Tables<'money_months'>): MoneyMonth => ({
  month: row.month.slice(0, 7),
  closedAt: row.closed_at,
});

/** その月（YYYY-MM）を締める／締めを外す。締めを外しても行は残し、closed_at を空にする。 */
export async function setMoneyMonthClosed(
  supabase: SupabaseDb,
  familyId: string,
  month: string,
  closed: boolean,
): Promise<MoneyMonth> {
  const { data, error } = await supabase
    .from('money_months')
    .upsert(
      { family_id: familyId, month: `${month}-01`, closed_at: closed ? new Date().toISOString() : null },
      { onConflict: 'family_id,month' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return rowToMonth(data);
}

/** 見込みの記録を、今の額のまま確定する（締めの画面の「確定」。記録の詳細の「この額で確定する」と同じ結果）。 */
export async function confirmMoneyEstimate(supabase: SupabaseDb, recordId: string): Promise<void> {
  const { error } = await supabase.from('money_records').update({ is_estimate: false }).eq('id', recordId);
  if (error) throw error;
}

// ---- 記録 ----

async function loadRecord(supabase: SupabaseDb, id: string): Promise<MoneyRecord> {
  const { data, error } = await supabase.from('money_records').select('*, money_items(*)').eq('id', id).single();
  if (error) throw error;
  return rowToRecord(data);
}

/** 記録（詳細＋品目）を保存する。品目はすべて入れ替わる（DBの save_money_record）。 */
export async function saveMoneyRecord(supabase: SupabaseDb, draft: MoneyRecordDraft): Promise<MoneyRecord> {
  const record: Json = {
    id: draft.id,
    kind: draft.kind,
    occurred_on: draft.occurredOn,
    wallet_id: draft.walletId,
    to_wallet_id: draft.kind === 'transfer' ? draft.toWalletId : null,
    store: draft.kind === 'transfer' ? '' : draft.store.trim(),
    register_store: draft.registerStore === true,
    is_estimate: draft.isEstimate,
    // レシートの店名（読み取りで入れた記録だけ。直すときは送らなければ今のまま。docs/kakei.md §10.3）
    receipt_store: draft.receiptStore ?? null,
  };
  const items: Json = draft.items.map((item) => ({
    amount: item.amount,
    category_id: item.categoryId,
    category_name: item.categoryId === null ? item.categoryName : '',
    quantity: item.quantity,
    unit_price: item.unitPrice,
    name: item.name.trim(),
    memo: item.memo.trim(),
    receipt_name: item.receiptName ?? null,
  }));
  const { data, error } = await supabase.rpc('save_money_record', { p_record: record, p_items: items });
  if (error) throw error;
  // 「翌月分に回す」は save_money_record が持たない列なので、保存のあとに入れる（docs/kakei.md §3.4。0104）。
  const cardNextPeriod = draft.cardNextPeriod;
  if (cardNextPeriod || draft.id !== null) {
    const { error: flagError } = await supabase.from('money_records').update({ card_next_period: cardNextPeriod }).eq('id', data);
    if (flagError) throw flagError;
  }
  return loadRecord(supabase, data);
}

export async function deleteMoneyRecord(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_records').delete().eq('id', id);
  if (error) throw error;
}

// ---- カテゴリ・予算 ----

export async function insertMoneyCategory(
  supabase: SupabaseDb,
  familyId: string,
  fields: {
    kind: MoneyCategoryKind;
    parentId: string | null;
    name: string;
    icon: string | null;
    iconColor?: string | null;
    position: number;
  },
): Promise<MoneyCategory> {
  const { data, error } = await supabase
    .from('money_categories')
    .insert({
      family_id: familyId,
      kind: fields.kind,
      parent_id: fields.parentId,
      name: fields.name.trim(),
      icon: fields.icon,
      icon_color: fields.iconColor ?? null,
      position: fields.position,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToCategory(data);
}

export async function updateMoneyCategory(
  supabase: SupabaseDb,
  id: string,
  fields: {
    name?: string;
    icon?: string | null;
    iconColor?: string | null;
    position?: number;
    archived?: boolean;
    budgetGroup?: MoneyBudgetGroup;
  },
): Promise<MoneyCategory> {
  const { data, error } = await supabase
    .from('money_categories')
    .update({
      ...(fields.name !== undefined && { name: fields.name.trim() }),
      ...(fields.icon !== undefined && { icon: fields.icon }),
      ...(fields.iconColor !== undefined && { icon_color: fields.iconColor }),
      ...(fields.position !== undefined && { position: fields.position }),
      ...(fields.archived !== undefined && { archived_at: fields.archived ? new Date().toISOString() : null }),
      ...(fields.budgetGroup !== undefined && { budget_group: fields.budgetGroup === 'variable' ? null : fields.budgetGroup }),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToCategory(data);
}

/**
 * カテゴリ（大分類・小分類）を消す。大分類を消すと小分類と予算も消える（外部キーの cascade）。
 * 記録の品目には消したカテゴリの名前だけが残る（DBのトリガ money_categories_keep_name。docs/kakei.md §3.1）。
 */
export async function deleteMoneyCategory(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_categories').delete().eq('id', id);
  if (error) throw error;
}

/**
 * 標準のカテゴリ（moneyUtils の DEFAULT_CATEGORIES）を入れる。カテゴリがまだ無い家族向け。
 * 読み込みに失敗してカテゴリが空に見えているときに押されても二重に入らないよう、DBにカテゴリが1つでもあれば何も足さない
 * （2026-10-08に、プレビューで読み込みに失敗したまま押されて、標準のカテゴリが2回入った）。
 */
export async function insertDefaultMoneyCategories(supabase: SupabaseDb, familyId: string): Promise<MoneyCategory[]> {
  const { count, error: countError } = await supabase
    .from('money_categories')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', familyId);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new Error('この家族にはもうカテゴリがあります');
  const { data: parents, error } = await supabase
    .from('money_categories')
    .insert(
      DEFAULT_CATEGORIES.map((category, index) => ({
        family_id: familyId,
        kind: category.kind,
        name: category.name,
        position: index,
      })),
    )
    .select('*');
  if (error) throw error;
  const byName = new Map((parents ?? []).map((row) => [`${row.kind}:${row.name}`, row.id]));
  const children = DEFAULT_CATEGORIES.flatMap((category) =>
    category.children.map((name, index) => ({
      family_id: familyId,
      kind: category.kind,
      parent_id: byName.get(`${category.kind}:${category.name}`)!,
      name,
      position: index,
    })),
  );
  const { data: childRows, error: childError } = await supabase.from('money_categories').insert(children).select('*');
  if (childError) throw childError;
  return [...(parents ?? []), ...(childRows ?? [])].map(rowToCategory);
}

/**
 * 大分類の、その年の1月〜12月の月額を保存する（DBの列名は fiscal_year のまま。中身は暦年）。
 * monthAmounts は長さ12（null の月は予算なし）。monthly_amount には12月の額を入れる（古いアプリはこの列だけを読む）。
 */
export async function saveMoneyBudget(
  supabase: SupabaseDb,
  familyId: string,
  categoryId: string,
  year: number,
  monthAmounts: readonly (number | null)[],
): Promise<MoneyBudget> {
  const { data, error } = await supabase
    .from('money_budgets')
    .upsert(
      {
        family_id: familyId,
        category_id: categoryId,
        fiscal_year: year,
        monthly_amount: monthAmounts[11] ?? 0,
        month_amounts: monthAmounts as number[],
      },
      { onConflict: 'category_id,fiscal_year' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return rowToBudget(data);
}

// ---- 予算の明細（docs/kakei.md §0.7。収入・予備費・固定費） ----

export interface MoneyBudgetLineDraft {
  categoryId: string;
  name: string;
  amount: number;
  months: number[] | null;
  noMonth: boolean;
  intervalYears: number | null;
  /** YYYY-MM。 */
  startMonth: string | null;
  /** YYYY-MM。 */
  endMonth: string | null;
}

const budgetLineFields = (draft: MoneyBudgetLineDraft) => ({
  category_id: draft.categoryId,
  name: draft.name.trim(),
  amount: draft.amount,
  months: draft.noMonth ? null : draft.months,
  no_month: draft.noMonth,
  interval_years: draft.intervalYears,
  start_month: draft.startMonth === null ? null : `${draft.startMonth}-01`,
  end_month: draft.endMonth === null ? null : `${draft.endMonth}-01`,
});

/** 予算の明細を足す（id が null）か直す。 */
export async function saveMoneyBudgetLine(
  supabase: SupabaseDb,
  familyId: string,
  id: string | null,
  draft: MoneyBudgetLineDraft,
  position: number,
): Promise<MoneyBudgetLine> {
  const query =
    id === null
      ? supabase.from('money_budget_lines').insert({ ...budgetLineFields(draft), family_id: familyId, position })
      : supabase.from('money_budget_lines').update(budgetLineFields(draft)).eq('id', id);
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return rowToBudgetLine(data);
}

export async function deleteMoneyBudgetLine(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_budget_lines').delete().eq('id', id);
  if (error) throw error;
}

// ---- 出金元 ----

const walletFields = (draft: MoneyWalletDraft) => ({
  name: draft.name.trim(),
  type: draft.type,
  // 締め日・引き落とし日・引き落とし口座はカードだけ（docs/kakei.md §3.4）。
  close_day: draft.type === 'card' ? draft.closeDay : null,
  pay_day: draft.type === 'card' ? draft.payDay : null,
  pay_month_offset: draft.type === 'card' && draft.payDay !== null ? draft.payMonthOffset : null,
  pay_wallet_id: draft.type === 'card' ? draft.payWalletId : null,
  icon_color: draft.iconColor,
});

export async function insertMoneyWallet(
  supabase: SupabaseDb,
  familyId: string,
  draft: MoneyWalletDraft,
  position: number,
): Promise<MoneyWallet> {
  const { data, error } = await supabase
    .from('money_wallets')
    .insert({ ...walletFields(draft), family_id: familyId, position })
    .select('*')
    .single();
  if (error) throw error;
  return rowToWallet(data);
}

export async function updateMoneyWallet(
  supabase: SupabaseDb,
  id: string,
  draft: MoneyWalletDraft,
): Promise<MoneyWallet> {
  const { data, error } = await supabase.from('money_wallets').update(walletFields(draft)).eq('id', id).select('*').single();
  if (error) throw error;
  return rowToWallet(data);
}

/**
 * 出金元を削除する。記録は残り、出金元は「なし」になる（DBの外部キーが on delete set null）。
 * その出金元で確定した残高・証券の保有・取り込みのルールは一緒に消える（on delete cascade）。
 */
export async function deleteMoneyWallet(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_wallets').delete().eq('id', id);
  if (error) throw error;
}

/** 出金元の並び順を直す（口座の面の並べ替え）。 */
export async function updateMoneyWalletPosition(supabase: SupabaseDb, id: string, position: number): Promise<void> {
  const { error } = await supabase.from('money_wallets').update({ position }).eq('id', id);
  if (error) throw error;
}

/** 使わなくした出金元をまた使う。 */
export async function restoreMoneyWallet(supabase: SupabaseDb, id: string): Promise<MoneyWallet> {
  const { data, error } = await supabase.from('money_wallets').update({ archived_at: null }).eq('id', id).select('*').single();
  if (error) throw error;
  return rowToWallet(data);
}

// ---- 確定した残高（docs/kakei.md §9.3） ----

/** 出金元の、その日の終わりの残高を確定する。同じ日の確定があれば上書きする。 */
export async function saveMoneyWalletBalance(
  supabase: SupabaseDb,
  familyId: string,
  walletId: string,
  balanceOn: string,
  amount: number,
  showInHistory: boolean,
): Promise<MoneyWalletBalance> {
  const { data: session } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('money_wallet_balances')
    .upsert(
      {
        family_id: familyId,
        wallet_id: walletId,
        balance_on: balanceOn,
        amount,
        show_in_history: showInHistory,
        created_by: session.session?.user.id ?? null,
      },
      { onConflict: 'wallet_id,balance_on' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return rowToBalance(data);
}

/** 確定した残高を取り消す（入れ間違い）。 */
export async function deleteMoneyWalletBalance(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_wallet_balances').delete().eq('id', id);
  if (error) throw error;
}

// ---- お店（設定データ。docs/kakei.md §3.5） ----

/** お店の設定を読み直す（記録の保存で「お店に登録して使う」を選んだお店が登録されたあとなど）。 */
export async function loadMoneyStores(supabase: SupabaseDb, familyId: string): Promise<MoneyStore[]> {
  const { data, error } = await supabase.from('money_stores').select('*').eq('family_id', familyId).order('position', { ascending: true }).order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToStore);
}

/** お店を足す。同じ名前が使わなくなっていれば、また使えるようにする。 */
export async function insertMoneyStore(supabase: SupabaseDb, familyId: string, name: string): Promise<MoneyStore> {
  const { data, error } = await supabase
    .from('money_stores')
    .upsert({ family_id: familyId, name: name.trim(), archived_at: null }, { onConflict: 'family_id,name' })
    .select('*')
    .single();
  if (error) throw error;
  return rowToStore(data);
}

/** お店の名前を直す。記録のお店の名前は変わらない（設定だけ直す）。 */
export async function renameMoneyStore(supabase: SupabaseDb, id: string, name: string): Promise<MoneyStore> {
  const { data, error } = await supabase.from('money_stores').update({ name: name.trim() }).eq('id', id).select('*').single();
  if (error) throw error;
  return rowToStore(data);
}

/** お店の並び順を直す（設定の並べ替え）。 */
export async function updateMoneyStorePosition(supabase: SupabaseDb, id: string, position: number): Promise<void> {
  const { error } = await supabase.from('money_stores').update({ position }).eq('id', id);
  if (error) throw error;
}

/** お店を削除する（記録のお店の名前は残る）。 */
export async function deleteMoneyStore(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_stores').delete().eq('id', id);
  if (error) throw error;
}

/** お店を使わなくする／また使う（記録には残る）。 */
export async function setMoneyStoreArchived(supabase: SupabaseDb, id: string, archived: boolean): Promise<MoneyStore> {
  const { data, error } = await supabase
    .from('money_stores')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToStore(data);
}

// ---- 毎月の記録のルール（docs/kakei.md §3.3） ----

const recurringFields = (draft: MoneyRecurringDraft) => ({
  kind: draft.kind,
  day: draft.day,
  week_of_month: draft.weekOfMonth,
  weekday: draft.weekday,
  months: draft.months,
  start_month: draft.startMonth === null ? null : `${draft.startMonth}-01`,
  end_month: draft.endMonth === null ? null : `${draft.endMonth}-01`,
  holiday: draft.holiday,
  amount_mode: draft.amountMode,
  amount: draft.amount,
  wallet_id: draft.walletId,
  to_wallet_id: draft.kind === 'transfer' ? draft.toWalletId : null,
  store: draft.kind === 'transfer' ? '' : draft.store.trim(),
  category_id: draft.kind === 'transfer' ? null : draft.categoryId,
  name: draft.name.trim(),
  // 帯に出すもの（記録を作らない。docs/kakei.md §3.6）は支出だけ。日付未定にできるのも帯に出すものだけ（DBの check でも止める）。
  makes_record: draft.kind !== 'expense' || draft.makesRecord,
  skipped_months: draft.skippedMonths,
  interval_years: draft.intervalYears,
  day_known: draft.kind !== 'expense' || draft.makesRecord || draft.dayKnown,
});

export async function insertMoneyRecurring(
  supabase: SupabaseDb,
  familyId: string,
  draft: MoneyRecurringDraft,
  position: number,
): Promise<MoneyRecurring> {
  const { data, error } = await supabase
    .from('money_recurring')
    .insert({ ...recurringFields(draft), family_id: familyId, position })
    .select('*')
    .single();
  if (error) throw error;
  return rowToRecurring(data);
}

export async function updateMoneyRecurring(
  supabase: SupabaseDb,
  id: string,
  draft: MoneyRecurringDraft,
): Promise<MoneyRecurring> {
  const { data, error } = await supabase
    .from('money_recurring')
    .update(recurringFields(draft))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToRecurring(data);
}

/** ルールの並び順を直す（設定の並べ替え）。 */
export async function updateMoneyRecurringPosition(supabase: SupabaseDb, id: string, position: number): Promise<void> {
  const { error } = await supabase.from('money_recurring').update({ position }).eq('id', id);
  if (error) throw error;
}

/** 見積費の「今年はなし」にした回（予定の月 YYYY-MM）を入れ直す（docs/kakei.md §3.6）。 */
export async function updateMoneyRecurringSkipped(
  supabase: SupabaseDb,
  id: string,
  skippedMonths: string[],
): Promise<MoneyRecurring> {
  const { data, error } = await supabase
    .from('money_recurring')
    .update({ skipped_months: skippedMonths })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToRecurring(data);
}

/** 帯に出すものを「翌月へ送る」（docs/kakei.md §0.7）。until（YYYY-MM-DD）まで帯に出さない。null で戻す。 */
export async function updateMoneyRecurringDeferred(
  supabase: SupabaseDb,
  id: string,
  until: string | null,
): Promise<MoneyRecurring> {
  const { data, error } = await supabase
    .from('money_recurring')
    .update({ deferred_until: until })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToRecurring(data);
}

/** ルールを削除する。作った記録は残る（記録の recurring_id が外れるだけ）。 */
export async function deleteMoneyRecurring(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('money_recurring').delete().eq('id', id);
  if (error) throw error;
}

/** ルールを使わなくする／また使う。作った記録はそのまま残る。 */
export async function setMoneyRecurringArchived(
  supabase: SupabaseDb,
  id: string,
  archived: boolean,
): Promise<MoneyRecurring> {
  const { data, error } = await supabase
    .from('money_recurring')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToRecurring(data);
}
