-- かぞく手帳: 家計の設定データ「お店」（docs/kakei.md §3.5）
--
-- 予算・種類・出金元と同じ、家族で編集・追加できる設定データ。記録（money_records）は今までどおり
-- お店を名前の文字列（store）で持ち、この表とは結ばない（設定を直しても過去の記録は変わらない）。
--   - お店の選択画面は、ここに登録したお店を先に出し、続けて「最近使ったお店」を出す
--   - 記録を保存したとき、まだ無いお店の名前はここに自動で登録する（save_money_record）
--   - 使わなくしたお店は選択画面に出さない（archived_at。記録には残る）
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは表を読まないだけで、今までどおり動く（save_money_record の戻り値も同じ）

-- ============================================================
-- 1. money_stores: お店
-- ============================================================
create table if not exists public.money_stores (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  -- 使わなくした日時。記録には名前が残るので、これで選択画面に出さなくする。
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_stores_family_name_key unique (family_id, name)
);

comment on table public.money_stores is
  '家計のお店（設定データ）。記録は名前の文字列で持つので、ここを直しても過去の記録は変わらない。docs/kakei.md §3.5。';

drop trigger if exists money_stores_set_updated_at on public.money_stores;
create trigger money_stores_set_updated_at
  before update on public.money_stores
  for each row
  execute function public.set_updated_at();

alter table public.money_stores enable row level security;

drop policy if exists "money_stores_family_all" on public.money_stores;
create policy "money_stores_family_all" on public.money_stores
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- ============================================================
-- 2. いまある記録のお店を登録する
-- ============================================================
insert into public.money_stores (family_id, name)
select distinct family_id, btrim(store)
  from public.money_records
 where btrim(store) <> ''
on conflict (family_id, name) do nothing;

-- ============================================================
-- 3. 記録の保存（0063 と同じ。お店の名前を自動で登録する処理を足した）
-- ============================================================
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
begin
  if v_family is null then
    raise exception 'no family';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a record needs at least one item';
  end if;

  if v_id is null then
    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, created_by)
    values (
      v_family,
      p_record ->> 'kind',
      (p_record ->> 'occurred_on')::date,
      nullif(p_record ->> 'wallet_id', '')::uuid,
      nullif(p_record ->> 'to_wallet_id', '')::uuid,
      coalesce(p_record ->> 'store', ''),
      (select auth.uid())
    )
    returning id into v_id;
  else
    update public.money_records
      set kind = p_record ->> 'kind',
          occurred_on = (p_record ->> 'occurred_on')::date,
          wallet_id = nullif(p_record ->> 'wallet_id', '')::uuid,
          to_wallet_id = nullif(p_record ->> 'to_wallet_id', '')::uuid,
          store = coalesce(p_record ->> 'store', '')
      where id = v_id;
    if not found then
      raise exception 'record not found';
    end if;
    delete from public.money_items where record_id = v_id;
  end if;

  -- まだ登録の無いお店は、設定データとして登録する（使わなくしたお店はそのまま）。
  if v_store <> '' then
    insert into public.money_stores (family_id, name)
    values (v_family, v_store)
    on conflict (family_id, name) do nothing;
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
  '家計の記録（詳細＋品目）を1回で保存する。品目は入れ替える。新しいお店は money_stores に登録する。docs/kakei.md §3.2・§3.5。';

revoke execute on function public.save_money_record(jsonb, jsonb) from public, anon;
grant execute on function public.save_money_record(jsonb, jsonb) to authenticated;
