-- かぞく手帳: 月の締め（振り返りの確定。docs/kakei.md §4.1・§4.5）
--
-- 過ぎた月の収支を、見込みの記録も含めてすべて出して確かめ、「締める」で確定する。
--   - money_months（家族・月で1行）。closed_at が入っていれば締めた月。締めを外すと null にする（行は消さない）
--   - 締めた人は持たない（2026-10-15に決定）
--   - 家族で共有するので attach_family_sync を呼ぶ
--   - money_bootstrap に months を足す（0100 から months の1行だけ足した）
-- 削除を含む文は無い。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは months を読まないだけで、今までどおり動く

create table if not exists public.money_months (
  family_id uuid not null references public.families (id) on delete cascade,
  -- その月の1日
  month date not null check (extract(day from month) = 1),
  -- 締めた日時。null は締めていない（締めを外した）
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, month)
);

comment on table public.money_months is
  '月の締め（振り返りの確定）。closed_at があれば締めた月。docs/kakei.md §4.5';

alter table public.money_months enable row level security;
create policy "money_months_family_all" on public.money_months
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create trigger money_months_set_updated_at
  before update on public.money_months
  for each row
  execute function public.set_updated_at();

select public.attach_family_sync('public.money_months');

-- money_bootstrap（0100 に months を足した）
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
                 from public.money_months m where m.family_id = p_family_id)
  );
$function$;
