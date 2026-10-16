-- かぞく手帳: Amazon の値引き（クーポン・ポイント）を、品目の価格に比例して按分する（docs/kakei.md §9.7.3）
--
-- Amazon は値引きを、注文の各商品の価格に比例して按分する。なので同じ注文の請求は、発送が分かれても同じ割引率になる。
-- 記録の品目も、値引きを按分した額（実際に払った額）で入れる（0110 の「ポイント・値引き」のマイナスの行はやめる）。
--   - money_amazon_orders.discount_rate: 注文の割引率（最初の請求を割り振ったときの、1 − 請求 / 品目の和）。以後の請求は、この率の按分どおりのものだけを当てる
--   - money_feed_amazon_create の置き換え:
--       請求額から送料などの上乗せ（amazon_with_adjust のとき o.adjust。プラスのときだけ）を引いた額を、品目の価格の比で按分して品目の額にする
--       （端数は小数部の大きい品目から1円ずつ足して、合計を請求額に合わせる。個数で割り切れなければ1個として扱う。レシートの税の配り方と同じ）
--       品目の和より高い請求・半分より安い請求は作らない
--   - 削除を含まない

alter table public.money_amazon_orders
  add column if not exists discount_rate numeric check (discount_rate is null or (discount_rate >= 0 and discount_rate < 1));

comment on column public.money_amazon_orders.discount_rate is
  '最初の請求を割り振ったときに確かめた割引率（1 − 請求 / 品目の和）。null はまだ。docs/kakei.md §9.7.3';

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

  -- 送料などの上乗せ（注文メールの合計が品目の和より高いぶん）は、按分せず1行にする
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

  -- 値引きは品目の価格に比例して按分する。端数は小数部の大きい品目から1円ずつ足して、合計を請求額に合わせる
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

  -- この注文の割引率を、最初の請求から確かめる（以後の請求は、この率の按分どおりのものだけを当てる）
  update public.money_amazon_orders
     set discount_rate = (v_base - v_paid)::numeric / v_base
   where id = o.id and discount_rate is null;

  update public.money_amazon_lines set feed_id = f.id
   where family_id = f.family_id and id = any (f.amazon_line_ids);
  update public.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id = f.id;
  return v_record;
end;
$function$;

revoke execute on function public.money_feed_amazon_create(uuid) from public, anon, authenticated;
