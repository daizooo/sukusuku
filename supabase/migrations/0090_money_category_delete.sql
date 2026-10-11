-- かぞく手帳: 家計のカテゴリを「使わなくする」から「削除する」に（docs/kakei.md §3.1）
--
-- カテゴリ（大分類・小分類）を消せるようにする。消したカテゴリは、記録の品目に **名前だけ** 残す
-- （money_items.category_name。カテゴリへの紐づけ category_id は外れる）。
--   - 大分類を消すと、小分類と予算（money_budgets）も一緒に消える（外部キーの cascade）。小分類の品目にはその小分類の名前が残る
--   - 固定費・固定収入のルール（money_recurring.category_id）は、従来どおり外れる（on delete set null）。種類のないルールは記録を作らない
--   - 品目の category_id を外す前に、BEFORE DELETE のトリガで名前を写す（カテゴリ1行ごとに動くので、cascade で消える小分類も写る）
--
-- 流し方（CLAUDE.md「本番DBへの migration の適用」）:
--   1. 〔MCPで適用済み〕列とトリガ（追加だけ）
--   2. 〔SQL Editor で流す〕外部キーの付け替え（drop を含む）と、save_money_record（本体に delete を含む）
--   アプリ（PWA・mobile）は 2 まで適用してから出す（古いアプリは category_name を保存で落とす。まだ削除は出ないので影響なし）

-- 1. 追加だけ -----------------------------------------------------------------

alter table public.money_items
  add column if not exists category_name text not null default '';

comment on column public.money_items.category_name is
  '削除したカテゴリの名前（category_id が null のとき）。名前だけを残し、集計では合計にだけ数える（docs/kakei.md §3.1）。';

create or replace function public.money_categories_keep_name()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  update public.money_items
     set category_name = old.name
   where category_id = old.id
     and family_id = old.family_id;
  return old;
end;
$function$;

drop trigger if exists money_categories_keep_name on public.money_categories;
create trigger money_categories_keep_name
  before delete on public.money_categories
  for each row
  execute function public.money_categories_keep_name();

-- 2. SQL Editor で流す（drop・delete を含む） -----------------------------------

alter table public.money_items drop constraint if exists money_items_category_fkey;
alter table public.money_items
  add constraint money_items_category_fkey foreign key (category_id, family_id)
    references public.money_categories (id, family_id) on delete set null (category_id);

-- save_money_record（0089 から、品目に category_name を足した）
create or replace function public.save_money_record(p_record jsonb, p_items jsonb)
returns uuid
language plpgsql
set search_path to ''
as $function$
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
    family_id, record_id, amount, category_id, category_name,
    quantity, unit_price, name, memo, position
  )
  select
    v_family,
    v_id,
    (item ->> 'amount')::integer,
    nullif(item ->> 'category_id', '')::uuid,
    -- 削除したカテゴリの名前。カテゴリを選んでいる品目では持たない。
    case when nullif(item ->> 'category_id', '') is null then coalesce(item ->> 'category_name', '') else '' end,
    coalesce((item ->> 'quantity')::integer, 1),
    (item ->> 'unit_price')::integer,
    coalesce(item ->> 'name', ''),
    coalesce(item ->> 'memo', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as entries (item, ordinality);

  return v_id;
end;
$function$;
