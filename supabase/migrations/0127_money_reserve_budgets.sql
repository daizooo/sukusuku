-- 予備費を小分類ごとにする（docs/kakei.md §0.7。2026-10-21）
--
-- - money_reserve_budgets（家族・小分類・年で1行）: その小分類の、その年の予備費（年の予算）。
--   年の行が無ければ、前の年のいちばん近い行の額を使う（アプリ）。行のある小分類が予備費の小分類
-- - money_bootstrap の reserves は、この表を返す（0115 の money_reserves〔家族・年で1つの額〕と money_categories.reserve は使わなくなる。
--   消すのは削除を含むので、あとで SQL Editor で流す）
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。古いアプリの予備費は 0 に見える（本番には予備費の行が無い）

create table if not exists public.money_reserve_budgets (
  family_id uuid not null references public.families (id) on delete cascade,
  category_id uuid not null,
  year integer not null,
  amount integer not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, category_id, year),
  foreign key (category_id, family_id) references public.money_categories (id, family_id) on delete cascade
);

comment on table public.money_reserve_budgets is
  '予備費の小分類ごとの年の額（暦年）。行のある小分類が予備費の小分類。docs/kakei.md §0.7';

alter table public.money_reserve_budgets enable row level security;
create policy "money_reserve_budgets_family_all" on public.money_reserve_budgets
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

grant select, insert, update, delete on public.money_reserve_budgets to authenticated;
grant all on public.money_reserve_budgets to service_role;

create trigger money_reserve_budgets_set_updated_at
  before update on public.money_reserve_budgets
  for each row
  execute function public.set_updated_at();

select public.attach_family_sync('public.money_reserve_budgets');

-- money_bootstrap（0115 の reserves を money_reserve_budgets に替えた）
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
                   from public.money_reserve_budgets rv where rv.family_id = p_family_id)
  );
$function$;
