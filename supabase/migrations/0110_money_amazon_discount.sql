-- かぞく手帳: Amazon の注文メールに出ない値引き（ポイント・クーポン）に対応する（docs/kakei.md §9.7.3）
--
-- 注文メール・発送メールの品目の額は値引き前で、ポイントの利用額は載らない。請求が品目の和（+ 注文メールの差）より安いときは、
-- そのぶんを「ポイント・値引き」のマイナスの1行にして記録を作る（差が品目の和の2割を超えるときは別の請求とみなして作らない）。
--   - money_feed_amazon_create の置き換えだけ（0109 から、額の条件を「合う」から「安い方に2割まで」に広げ、差の行を足した）。削除を含まない

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
  v_sum integer;
  v_adjust integer := 0;
  v_extra integer;
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

  select count(*), coalesce(sum(amount), 0) into v_count, v_sum from public.money_amazon_lines
   where family_id = f.family_id and order_id = o.id and id = any (f.amazon_line_ids) and feed_id is null;
  if v_count = 0 or v_count <> array_length(f.amazon_line_ids, 1) then
    return null;
  end if;
  if f.amazon_with_adjust then
    if o.adjust_feed_id is not null then
      return null;
    end if;
    v_adjust := o.adjust;
  end if;
  -- 請求が品目の和（+ 差）より安いぶんは、注文メールに出ない値引き（ポイント・クーポン）。大きすぎる差は別の請求とみなす
  v_extra := v_sum + v_adjust - f.amount;
  if v_extra < 0 or v_extra * 5 > v_sum + v_adjust then
    return null;
  end if;

  insert into public.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id)
  values (f.family_id, 'expense', f.occurred_on, f.wallet_id, coalesce(nullif(btrim(f.store_hint), ''), 'Amazon'), f.id)
  returning id into v_record;

  insert into public.money_items (family_id, record_id, amount, category_id, quantity, unit_price, name, receipt_name, position)
  select f.family_id, v_record, l.amount, l.category_id, l.quantity, l.unit_price, l.name, l.receipt_name, l.position
    from public.money_amazon_lines l
   where l.family_id = f.family_id and l.id = any (f.amazon_line_ids)
   order by l.position;

  -- 値引き・送料などの差は、いちばん金額の大きい品目と同じ種類の1行にする（レシートの小計の値引きと同じ。docs/kakei.md §10.5）
  if v_adjust <> 0 or v_extra > 0 then
    select l.category_id into v_top from public.money_amazon_lines l
     where l.family_id = f.family_id and l.id = any (f.amazon_line_ids)
     order by l.amount desc, l.position
     limit 1;
  end if;
  if v_adjust <> 0 then
    insert into public.money_items (family_id, record_id, amount, category_id, quantity, unit_price, name, position)
    values (f.family_id, v_record, v_adjust, v_top, 1, v_adjust,
            case when v_adjust < 0 then '値引き・クーポン' else '送料など' end, 1000);
    update public.money_amazon_orders set adjust_feed_id = f.id where id = o.id;
  end if;
  if v_extra > 0 then
    insert into public.money_items (family_id, record_id, amount, category_id, quantity, unit_price, name, position)
    values (f.family_id, v_record, -v_extra, v_top, 1, -v_extra, 'ポイント・値引き', 1001);
  end if;

  update public.money_amazon_lines set feed_id = f.id
   where family_id = f.family_id and id = any (f.amazon_line_ids);
  update public.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id = f.id;
  return v_record;
end;
$function$;

revoke execute on function public.money_feed_amazon_create(uuid) from public, anon, authenticated;
