-- かぞく手帳: お店を、記録の保存で自動では登録しないようにする（docs/kakei.md §3.5）
--
-- これまでは記録を保存すると、まだ無いお店の名前をすべて money_stores に登録していた。
-- 一度しか行かないお店まで登録され、お店の選択画面が膨らむため、記録の入力で
-- 「お店に登録して使う」を選んだとき（p_record.register_store = true）だけ登録する。
-- 「この記録だけに使う」を選んだお店は、記録にだけ名前が残る（最近使ったお店には出る）。
--
-- 適用: 関数の本体に delete があるため、MCP ではなく SQL Editor で流す（CLAUDE.md）。
-- 適用の順序: どちらが先でもよい。
--   - 古いアプリは register_store を送らないので、新しいお店は登録されなくなる（記録は今までどおり保存できる）
--   - 適用前の新しいアプリは、今までどおりすべて登録される

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
    family_id, record_id, amount, category_id, special_item_id, special_plan_id, product_id,
    quantity, unit_price, name, memo, position
  )
  select
    v_family,
    v_id,
    (item ->> 'amount')::integer,
    nullif(item ->> 'category_id', '')::uuid,
    nullif(item ->> 'special_item_id', '')::uuid,
    nullif(item ->> 'special_plan_id', '')::uuid,
    nullif(item ->> 'product_id', '')::uuid,
    coalesce((item ->> 'quantity')::integer, 1),
    (item ->> 'unit_price')::integer,
    coalesce(item ->> 'name', ''),
    coalesce(item ->> 'memo', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as entries (item, ordinality);

  update public.household_products as product
    set price = coalesce(item.unit_price, product.price),
        money_category_id = coalesce(product.money_category_id, item.category_id)
    from public.money_items as item
    where item.record_id = v_id
      and item.product_id = product.id;

  return v_id;
end;
$$;

comment on function public.save_money_record(jsonb, jsonb) is
  '家計の記録（詳細＋品目）を1回で保存する。品目は入れ替える。p_record.register_store が true のときだけ、お店を money_stores に登録する。見込みの印は p_record.is_estimate。docs/kakei.md §3.2・§3.3・§3.5。';

revoke execute on function public.save_money_record(jsonb, jsonb) from public, anon;
grant execute on function public.save_money_record(jsonb, jsonb) to authenticated;
