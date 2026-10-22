-- 年間予算を自動記録ルールから切り離す（docs/kakei.md §0.7。2026-10-22）
--
-- - money_categories.budget_group: 大分類の予算の分け方。'variable'（変動費）・'reserve'（予備費）・'fixed'（固定費・確定）・
--   'estimate'（固定費・見込み）。null は変動費。支出をどこで数えるかは、これだけで決める（自動記録ルールは記録を作るためだけ）
-- - money_budget_lines（予算の明細）: 小分類（収入も）ごとの「単価 × 発生する回数」。回数は発生月（months。null は毎月）・
--   ◯年ごと（interval_years。start_month の年から数える）・期間（start_month〜end_month）で決まる。
--   no_month は発生月なし（その年に1回ぶんを見込み支出として数える。予備費・オイル交換・ふるさと納税など）。
--   同じ小分類に何行でも持てる（オイル交換の1回目・2回目、給与の時短→フルタイムなど）
-- - 変動費は今までどおり money_budgets（大分類の月の予算）
-- - money_bootstrap に budget_lines を足す
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。0127 の money_reserve_budgets は使わなくなる（あとで SQL Editor で消す）

alter table public.money_categories
  add column if not exists budget_group text
  check (budget_group is null or budget_group in ('variable', 'reserve', 'fixed', 'estimate'));

comment on column public.money_categories.budget_group is
  '大分類の予算の分け方（variable・reserve・fixed・estimate。null は variable）。docs/kakei.md §0.7';

create table if not exists public.money_budget_lines (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  category_id uuid not null,
  name text not null default '',
  amount integer not null check (amount >= 0),
  months smallint[] check (
    months is null
    or (cardinality(months) > 0 and months <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::smallint[])
  ),
  no_month boolean not null default false,
  interval_years smallint,
  start_month date,
  end_month date,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, family_id) references public.money_categories (id, family_id) on delete cascade,
  constraint money_budget_lines_interval_check check (
    interval_years is null or (interval_years between 2 and 10 and start_month is not null)
  ),
  constraint money_budget_lines_period_check check (
    (start_month is null or extract(day from start_month) = 1)
    and (end_month is null or extract(day from end_month) = 1)
    and (start_month is null or end_month is null or start_month <= end_month)
  )
);

comment on table public.money_budget_lines is
  '予算の明細（単価 × 発生する回数）。発生月・◯年ごと・期間で回数が決まる。自動記録ルールとは別。docs/kakei.md §0.7';

create index if not exists money_budget_lines_family_idx on public.money_budget_lines (family_id);

alter table public.money_budget_lines enable row level security;
create policy "money_budget_lines_family_all" on public.money_budget_lines
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

grant select, insert, update, delete on public.money_budget_lines to authenticated;
grant all on public.money_budget_lines to service_role;

create trigger money_budget_lines_set_updated_at
  before update on public.money_budget_lines
  for each row
  execute function public.set_updated_at();

select public.attach_family_sync('public.money_budget_lines');

-- money_bootstrap（0127 に budget_lines を足した）
create or replace function public.money_bootstrap(p_family_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                     from public.money_categories c where c.family_id = p_family_id),
    'budgets', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
                  from public.money_budgets b where b.family_id = p_family_id),
    'wallets', (select coalesce(jsonb_agg(to_jsonb(w) order by w.position), '[]'::jsonb)
                  from public.money_wallets w where w.family_id = p_family_id),
    'stores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.position, s.name), '[]'::jsonb)
                 from public.money_stores s where s.family_id = p_family_id),
    'recurring', (select coalesce(jsonb_agg(to_jsonb(r) order by r.position), '[]'::jsonb)
                    from public.money_recurring r where r.family_id = p_family_id),
    'balances', (select coalesce(jsonb_agg(to_jsonb(wb)), '[]'::jsonb)
                   from public.money_wallet_balances wb where wb.family_id = p_family_id),
    'records', (
      select coalesce(jsonb_agg(
               to_jsonb(rec) || jsonb_build_object('money_items', coalesce(
                 (select jsonb_agg(to_jsonb(it) order by it.position)
                    from public.money_items it where it.record_id = rec.id),
                 '[]'::jsonb))
               order by rec.occurred_on, rec.created_at, rec.id), '[]'::jsonb)
        from public.money_records rec where rec.family_id = p_family_id),
    'securities', (select coalesce(jsonb_agg(to_jsonb(se) order by se.position), '[]'::jsonb)
                     from public.money_securities se where se.family_id = p_family_id),
    'holdings', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
                   from public.money_holdings h where h.family_id = p_family_id),
    'latest_values', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
                        from public.money_latest_holding_values(p_family_id) v),
    'months', (select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb)
                 from public.money_months m where m.family_id = p_family_id),
    'reserves', (select coalesce(jsonb_agg(to_jsonb(rv) order by rv.year), '[]'::jsonb)
                   from public.money_reserve_budgets rv where rv.family_id = p_family_id),
    'budget_lines', (select coalesce(jsonb_agg(to_jsonb(bl) order by bl.position, bl.created_at), '[]'::jsonb)
                       from public.money_budget_lines bl where bl.family_id = p_family_id)
  );
$function$;
