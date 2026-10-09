-- かぞく手帳: 家計タブの起動で読む money_bootstrap から、日用品の台帳（products）を外す
--
-- 日用品の機能（台帳・買った記録の追跡・カテゴリの一覧・家計の「日用品から選ぶ」・リストの追加欄の候補）を
-- 削除した。毎月必ず買うものばかりで、値段を追っても意味がなかったため。この関数が返す 'products' を外す。
-- 表と列そのものの削除は 0085（削除を含むので SQL Editor で流す）。
--
-- 適用の順序: アプリを出す前でも後でもよい。古いアプリは 'products' が無ければ空として扱う
-- （`data[key] ?? []`）ので、今までどおり動く。削除を含まない。

create or replace function public.money_bootstrap(p_family_id uuid)
returns jsonb
language sql
stable
security invoker
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
                        from public.money_latest_holding_values(p_family_id) v)
  );
$$;

comment on function public.money_bootstrap(uuid) is
  '家計タブの起動で読む12本を、家族ID1つで1回にまとめて返す（表の行をそのまま JSON で）。呼ぶ人の権限（RLS）で読む。docs/kakei.md §9.2.6。';

revoke execute on function public.money_bootstrap(uuid) from public, anon;
grant execute on function public.money_bootstrap(uuid) to authenticated;
