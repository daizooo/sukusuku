-- かぞく手帳: Amazon の値引きを「商品ごとの値引きの予算」で扱う（docs/kakei.md §9.7.3）
--
-- 実物（2026-09-14の注文。小計 2,888円・割引 −138円・請求 2,750円）で、値引きは全体への按分ではなく、
-- 定期おトク便のアタックだけに掛かっていた（1,379円 → 1,241円。ブラックキャップ 1,509円は値引きなし）。
-- 0111 の「割引率で按分」をやめ、注文メールの値引きの総額（合計と品目の和の差）を予算として、
-- 請求との差がその範囲に収まる組み合わせを当てる（Edge Function `_shared/amazonOrder.ts`）。
--   - money_amazon_orders.discount_used: 記録に割り振った値引きの合計（予算の残り = −adjust − discount_used）
--   - money_feed_amazon_create の置き換え: 割引率の学習（discount_rate）をやめ、discount_used を足す。
--     記録の品目の額は、組み合わせ（その発送）の値引きを品目の価格の比で配る（1つだけなら、その品目の値引き）。ほかは 0111 と同じ
--   - 0111 で足した discount_rate は使わなくなった。消すのは下の 2.（削除を含むので SQL Editor で流す）
--   - 1. は削除を含まない（MCP で適用してよい）

-- 1. 値引きの予算 ---------------------------------------------------------------

alter table public.money_amazon_orders
  add column if not exists discount_used integer not null default 0 check (discount_used >= 0);

comment on column public.money_amazon_orders.discount_used is
  '記録に割り振った値引きの合計。値引きの予算の残りは（合計と品目の和の差）− これ。docs/kakei.md §9.7.3';

create or replace function public.money_feed_amazon_create(p_feed uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f public.money_feed;
  o public.money_amazon_orders;
  v_count integer;
  v_base integer;
  v_fee integer := 0;
  v_paid integer;
  v_top uuid;
  v_record uuid;
begin
  select * into f from public.money_feed where id = p_feed for update;
  if not found or f.wallet_id is null or f.amazon_order_id is null then
    return null;
  end if;
  select * into o from public.money_amazon_orders where id = f.amazon_order_id and family_id = f.family_id for update;
  if not found then
    return null;
  end if;

  select count(*), coalesce(sum(amount), 0) into v_count, v_base from public.money_amazon_lines
   where family_id = f.family_id and order_id = o.id and id = any (f.amazon_line_ids) and feed_id is null;
  if v_count = 0 or v_count <> array_length(f.amazon_line_ids, 1) then
    return null;
  end if;

  -- 送料などの上乗せ（注文メールの合計が品目の和より高いぶん）は、1行にする
  if f.amazon_with_adjust then
    if o.adjust <= 0 or o.adjust_feed_id is not null then
      return null;
    end if;
    v_fee := o.adjust;
  end if;
  v_paid := f.amount - v_fee;
  -- 品目の和より高い請求・半分より安い請求（値引きすぎ）は、別の請求とみなして作らない
  if v_paid <= 0 or v_paid > v_base or v_paid * 2 < v_base then
    return null;
  end if;

  insert into public.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id)
  values (f.family_id, 'expense', f.occurred_on, f.wallet_id, coalesce(nullif(btrim(f.store_hint), ''), 'Amazon'), f.id)
  returning id into v_record;

  -- この発送の値引き（品目の和 − 請求）を、品目の価格の比で配る（どの商品の値引きかは注文メールに出ないので、組み合わせの中では比で）。
  -- 端数は小数部の大きい品目から1円ずつ足して、合計を請求額に合わせる。個数で割り切れなければ1個として扱う
  with shares as (
    select l.id, l.position, l.amount, l.quantity, l.category_id, l.name, l.receipt_name,
           (l.amount::bigint * v_paid) / v_base as floor_share,
           (l.amount::bigint * v_paid) % v_base as remainder
      from public.money_amazon_lines l
     where l.family_id = f.family_id and l.id = any (f.amazon_line_ids)
  ), ranked as (
    select s.*,
           row_number() over (order by s.remainder desc, s.position) as rk,
           v_paid - sum(s.floor_share) over () as leftover
      from shares s
  ), priced as (
    select r.*, (r.floor_share + case when r.rk <= r.leftover then 1 else 0 end)::integer as share
      from ranked r
  )
  insert into public.money_items (family_id, record_id, amount, category_id, quantity, unit_price, name, receipt_name, position)
  select f.family_id, v_record, p.share, p.category_id,
         case when p.quantity > 1 and p.share % p.quantity = 0 then p.quantity else 1 end,
         case when p.quantity > 1 and p.share % p.quantity = 0 then p.share / p.quantity else p.share end,
         p.name, p.receipt_name, p.position
    from priced p
   order by p.position;

  if v_fee > 0 then
    select l.category_id into v_top from public.money_amazon_lines l
     where l.family_id = f.family_id and l.id = any (f.amazon_line_ids)
     order by l.amount desc, l.position
     limit 1;
    insert into public.money_items (family_id, record_id, amount, category_id, quantity, unit_price, name, position)
    values (f.family_id, v_record, v_fee, v_top, 1, v_fee, '送料など', 1000);
    update public.money_amazon_orders set adjust_feed_id = f.id where id = o.id;
  end if;

  -- 割り振った値引きを、予算から引く
  update public.money_amazon_orders set discount_used = discount_used + (v_base - v_paid) where id = o.id;

  update public.money_amazon_lines set feed_id = f.id
   where family_id = f.family_id and id = any (f.amazon_line_ids);
  update public.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id = f.id;
  return v_record;
end;
$function$;

revoke execute on function public.money_feed_amazon_create(uuid) from public, anon, authenticated;

-- 2. SQL Editor で流す（削除を含む。使わなくなった 0111 の列。流さなくても動く） ------------

alter table public.money_amazon_orders drop column if exists discount_rate;
