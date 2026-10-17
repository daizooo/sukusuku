-- 予備費（docs/kakei.md §3.7。2026-10-18）
--
-- 予算の「予備費」: 起きるかどうかも、いつかも分からない出費（冠婚葬祭・家電の故障など）のための年の額。
-- 予備費に小分類を紐づけ、その小分類の記録は予備費の予算で数える（記録はいつもどおり、その小分類に付ける）。
--
-- - money_reserves（家族・年で1行）: その年の予備費の額。年の行が無ければ、前の年のいちばん近い行の額を使う（アプリ）
-- - money_categories.reserve: 予備費に紐づけた小分類
-- - money_bootstrap に reserves を足す（0103 から reserves の1行だけ足した）
-- 削除を含む文は無い。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。古いアプリは reserves を読まないだけで、今までどおり動く

alter table public.money_categories
  add column if not exists reserve boolean not null default false;

create table if not exists public.money_reserves (
  family_id uuid not null references public.families (id) on delete cascade,
  year integer not null,
  amount integer not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, year)
);

comment on table public.money_reserves is
  '予備費の年の額（暦年）。紐づけた小分類は money_categories.reserve。docs/kakei.md §3.7';

alter table public.money_reserves enable row level security;
create policy "money_reserves_family_all" on public.money_reserves
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create trigger money_reserves_set_updated_at
  before update on public.money_reserves
  for each row
  execute function public.set_updated_at();

select public.attach_family_sync('public.money_reserves');

-- money_bootstrap（0103 に reserves を足した）
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
                   from public.money_reserves rv where rv.family_id = p_family_id)
  );
$function$;
