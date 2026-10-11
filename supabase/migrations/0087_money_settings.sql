-- かぞく手帳: 家計の設定「集計の開始月」（docs/kakei.md §0.4）
--
-- 年の振り返りと、年初からの累計は、この月以降の「記録のある月」だけを数える。それより前の月は、月の画面では見られるが、
-- 年と累計には入れない（Zaim から移した記録や、使い始めの中途半端な月を数えないため）。
-- null は「全部の月を数える」。家族ごとに1行。値は月の初日（2026年11月なら 2026-11-01）。
--
-- 1. money_settings: 表・RLS・更新日時・変更台帳（family_sync。docs/sync.md）
-- 2. money_bootstrap: 起動の読み込みに settings を足す（古いアプリはこのキーを読まないだけで、今までどおり動く）
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。

create table if not exists public.money_settings (
  family_id uuid primary key references public.families (id) on delete cascade,
  start_month date check (start_month is null or start_month = date_trunc('month', start_month)::date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.money_settings is
  '家計の設定（家族ごとに1行）。start_month は年・累計を数え始める月（月の初日。null は全部）。docs/kakei.md §0.4。';

drop trigger if exists money_settings_set_updated_at on public.money_settings;
create trigger money_settings_set_updated_at
  before update on public.money_settings
  for each row
  execute function public.set_updated_at();

alter table public.money_settings enable row level security;

drop policy if exists "money_settings_family_all" on public.money_settings;
create policy "money_settings_family_all" on public.money_settings
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

select public.attach_family_sync('public.money_settings');

-- ============================================================
-- 2. money_bootstrap（0084 と同じ。settings を足した）
-- ============================================================
create or replace function public.money_bootstrap(p_family_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                     from public.money_categories c where c.family_id = p_family_id),
    'budgets', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
                  from public.money_budgets b where b.family_id = p_family_id),
    'wallets', (select coalesce(jsonb_agg(to_jsonb(w) order by w.position), '[]'::jsonb)
                  from public.money_wallets w where w.family_id = p_family_id),
    'stores', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
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
    'special_items', (select coalesce(jsonb_agg(to_jsonb(si) order by si.position), '[]'::jsonb)
                        from public.special_items si where si.family_id = p_family_id),
    'special_plans', (select coalesce(jsonb_agg(to_jsonb(sp)), '[]'::jsonb)
                        from public.special_plans sp where sp.family_id = p_family_id),
    'securities', (select coalesce(jsonb_agg(to_jsonb(se) order by se.position), '[]'::jsonb)
                     from public.money_securities se where se.family_id = p_family_id),
    'holdings', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
                   from public.money_holdings h where h.family_id = p_family_id),
    'latest_values', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
                        from public.money_latest_holding_values(p_family_id) v),
    'settings', (select to_jsonb(ms) from public.money_settings ms where ms.family_id = p_family_id)
  );
$$;
