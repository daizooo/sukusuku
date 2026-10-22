-- 使わなくなった予備費の仕組みを消す（docs/kakei.md §0.7。2026-10-22）
--
-- 予備費は、大分類の予算の分け方（money_categories.budget_group = 'reserve'）と予算の明細（money_budget_lines。0129）で持つ。
-- 0115 の money_reserves（家族・年で1つの額）と money_categories.reserve（予備費に紐づけた小分類）、
-- 0127 の money_reserve_budgets（小分類ごとの年の額）は使わない。
-- 適用の順序: アプリ（PWA・mobile）を出してから、1. money_bootstrap の置き換え（MCP）、2. 削除（SQL Editor）。

-- 1. money_bootstrap（0129 から reserves を外した）
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
    'budget_lines', (select coalesce(jsonb_agg(to_jsonb(bl) order by bl.position, bl.created_at), '[]'::jsonb)
                       from public.money_budget_lines bl where bl.family_id = p_family_id)
  );
$function$;

-- 2. 削除（SQL Editor で流す）
drop table if exists public.money_reserve_budgets;
drop table if exists public.money_reserves;
alter table public.money_categories drop column if exists reserve;
