-- 家計タブの起動で読むものを、家族ID1つで1回の問い合わせにまとめる関数（docs/kakei.md §9.2.6）。
--
-- 家計タブは起動で 種類・予算・出金元・お店・定期・残高・記録（品目つき）・日用品の台帳・特別費の項目と予定・
-- 証券の銘柄と保有・保有ごとの最新の評価額 の13本を読んでいた。Android の OkHttp は同じホストへの
-- 同時リクエストが5本までなので、3回に分かれて走る。この関数で1本にして、往復の待ちを減らす。
--
-- 返すのは表の行そのまま（to_jsonb）なので、アプリの行 → 画面の型への変換は今までと同じものを使う。
-- 記録は品目を `money_items` に入れて返す（select('*, money_items(*)') と同じ形）。
-- 評価額の履歴は返さない（推移を開いたときに読む。0075）。
--
-- 呼ぶ人の権限（RLS）で読む。見えるのは自分の家族の行だけ。
-- 適用の順序: これを適用してから、アプリ（PWA・mobile）を出す。削除を含まない。

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
    'products', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
                   from public.household_products p where p.family_id = p_family_id),
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
  '家計タブの起動で読む13本を、家族ID1つで1回にまとめて返す（表の行をそのまま JSON で）。呼ぶ人の権限（RLS）で読む。docs/kakei.md §9.2.6。';

revoke execute on function public.money_bootstrap(uuid) from public, anon;
grant execute on function public.money_bootstrap(uuid) to authenticated;
