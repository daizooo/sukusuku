-- かぞく手帳: 日用品の機能を削除する（台帳・カテゴリの一覧・家計の品目の product_id）
--
-- 日用品の機能（台帳、買った記録の追跡、カテゴリの一覧、家計の「日用品から選ぶ」、リストの追加欄の候補）を
-- 削除した。毎月必ず買うものばかりで、値段を追っても意味がなかったため。
--   1. save_money_record から、品目の product_id の保存と、台帳の「いつもの値段」の更新を外す
--   2. money_items.product_id を消す
--   3. household_products と household_product_categories を消す
--      （RLS・トリガ・family_sync のトリガ・money_category_id の列は表と一緒に消える）
-- 家計の品目の quantity・unit_price は、日用品とは関係なく品目の入力で使うので残す。
--
-- 適用: 削除（drop・関数の本体の delete）を含むため、MCP ではなく SQL Editor で流す（CLAUDE.md）。
-- 適用の順序: 0084 とアプリ（PWA・mobile）を出したあとに流す。
--   - 古いアプリは日用品の表を読むので、先に流すと日用品の画面・リストの追加欄の候補が読めなくなる
--   - 1.は表を消す前に（この順で）流すこと。1つのトランザクションにまとめてある
-- 日用品の台帳のデータは消える。残したい場合は、流す前に household_products を書き出しておく。

begin;

create or replace function public.save_money_record(p_record jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_family uuid := public.current_family_id();
  v_id uuid := nullif(p_record ->> 'id', '')::uuid;
  v_store text := btrim(coalesce(p_record ->> 'store', ''));
  v_estimate boolean := coalesce((p_record ->> 'is_estimate')::boolean, false);
  v_register boolean := coalesce((p_record ->> 'register_store')::boolean, false);
begin
  if v_family is null then
    raise exception 'no family';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a record needs at least one item';
  end if;

  if v_id is null then
    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, created_by, is_estimate)
    values (
      v_family,
      p_record ->> 'kind',
      (p_record ->> 'occurred_on')::date,
      nullif(p_record ->> 'wallet_id', '')::uuid,
      nullif(p_record ->> 'to_wallet_id', '')::uuid,
      coalesce(p_record ->> 'store', ''),
      (select auth.uid()),
      v_estimate
    )
    returning id into v_id;
  else
    update public.money_records
      set kind = p_record ->> 'kind',
          occurred_on = (p_record ->> 'occurred_on')::date,
          wallet_id = nullif(p_record ->> 'wallet_id', '')::uuid,
          to_wallet_id = nullif(p_record ->> 'to_wallet_id', '')::uuid,
          store = coalesce(p_record ->> 'store', ''),
          is_estimate = v_estimate
      where id = v_id;
    if not found then
      raise exception 'record not found';
    end if;
    delete from public.money_items where record_id = v_id;
  end if;

  -- 「お店に登録して使う」を選んだときだけ、お店の設定に登録する（使わなくしていれば、また使えるようにする）。
  if v_store <> '' and v_register then
    insert into public.money_stores (family_id, name)
    values (v_family, v_store)
    on conflict (family_id, name) do update set archived_at = null;
  end if;

  insert into public.money_items (
    family_id, record_id, amount, category_id, special_item_id, special_plan_id,
    quantity, unit_price, name, memo, position
  )
  select
    v_family,
    v_id,
    (item ->> 'amount')::integer,
    nullif(item ->> 'category_id', '')::uuid,
    nullif(item ->> 'special_item_id', '')::uuid,
    nullif(item ->> 'special_plan_id', '')::uuid,
    coalesce((item ->> 'quantity')::integer, 1),
    (item ->> 'unit_price')::integer,
    coalesce(item ->> 'name', ''),
    coalesce(item ->> 'memo', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as entries (item, ordinality);

  return v_id;
end;
$$;

comment on function public.save_money_record(jsonb, jsonb) is
  '家計の記録（詳細＋品目）を1回で保存する。品目は入れ替える。p_record.register_store が true のときだけ、お店を money_stores に登録する。見込みの印は p_record.is_estimate。docs/kakei.md §3.2・§3.3・§3.5。';

revoke execute on function public.save_money_record(jsonb, jsonb) from public, anon;
grant execute on function public.save_money_record(jsonb, jsonb) to authenticated;

alter table public.money_items drop column if exists product_id;

drop table if exists public.household_products;
drop table if exists public.household_product_categories;

commit;
