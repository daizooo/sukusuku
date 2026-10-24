-- 目安の割合（docs/kakei.md §0.9。2026-10-24）
-- - money_ratio_targets: 家族ごとの、支出の種類（変動費・予備費・固定費）の収入に対する目安の割合（%）。年の振り返りの見出しに
--   「11%（目安35%）」の形で出す。固定費（fixed）は、確定と見込みを合わせた固定費全体の目安（大分類の budget_group の fixed とは別）
-- - money_bootstrap に ratio_targets を足す。budgets・budget_lines は表を読まずに空の配列を返す
--   （予算は money_recurring から作る。0136。古いアプリのためにキーは残す。表は 0138 で消す）
-- - 本番の家族に初期値（変動費35%・予備費15%・固定費35%。残りの15%が貯金）を入れる
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。

create table if not exists public.money_ratio_targets (
  family_id uuid not null references public.families (id) on delete cascade,
  budget_group text not null check (budget_group in ('variable', 'reserve', 'fixed')),
  percent smallint not null check (percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, budget_group)
);

comment on table public.money_ratio_targets is
  '支出の種類（variable・reserve・fixed〔確定＋見込み〕）の、収入に対する目安の割合（%）。年の振り返りで実績の割合と並べる。docs/kakei.md §0.9';

alter table public.money_ratio_targets enable row level security;
create policy "money_ratio_targets_family_all" on public.money_ratio_targets
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

grant select, insert, update, delete on public.money_ratio_targets to authenticated;
grant all on public.money_ratio_targets to service_role;

create trigger money_ratio_targets_set_updated_at
  before update on public.money_ratio_targets
  for each row
  execute function public.set_updated_at();

select public.attach_family_sync('public.money_ratio_targets');

-- money_bootstrap（0129 に ratio_targets を足し、budgets・budget_lines を空にした）
create or replace function public.money_bootstrap(p_family_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                     from public.money_categories c where c.family_id = p_family_id),
    'budgets', '[]'::jsonb,
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
    'budget_lines', '[]'::jsonb,
    'ratio_targets', (select coalesce(jsonb_agg(to_jsonb(rt)), '[]'::jsonb)
                        from public.money_ratio_targets rt where rt.family_id = p_family_id)
  );
$function$;

-- 初期値（家計を使っている家族）
insert into public.money_ratio_targets (family_id, budget_group, percent)
select f.id, v.budget_group, v.percent
  from public.families f
 cross join (values ('variable', 35), ('reserve', 15), ('fixed', 35)) as v (budget_group, percent)
 where exists (select 1 from public.money_categories c where c.family_id = f.id)
on conflict (family_id, budget_group) do nothing;
