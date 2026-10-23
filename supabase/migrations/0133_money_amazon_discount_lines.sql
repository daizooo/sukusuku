-- かぞく手帳: Amazon の荷物の値引きを、品目に配らず「値引き」の行にする（docs/kakei.md §9.13）
--
-- 今まで（0132）は、注文の合計を品目の値引き前の額の比で配っていた。1つの注文が複数の荷物に分かれると、
-- 値引きがどの荷物に乗るか分からず、荷物の額がカードの請求と数円〜ずれた。
--   1. money_amazon_shipment_feed（置き換え）: 品目は値引き前の額。値引き（注文の品目の和 − 合計）を、品目ごとに
--      「なし・5%・10%」（定期おトク便。1個あたり四捨五入 × 個数）で説明できる組み合わせが1通りだけなら、その品目に乗せる。
--      当てはまらない値引き（ポイント・クーポン）・送料などは、注文の最後の荷物のいちばん大きい品目に乗せる
--      例（実物 250-7991927）: 合計 4,607円。アタック 1,100 の 110 ＋ ディアナチュラ 1,419 の 142 = 252 だけが当てはまる
--          → 荷物A（アタック・ディアナチュラ）2,267円、荷物B（防臭袋 1,170×2）2,340円（請求と同じ）
--   2. money_feed_order_lines（置き換え）: 荷物の品目に、乗る値引き（discount）を足して返す。アプリの feedOrderItems が
--      品目の下に「値引き」のマイナスの行（その品目と同じカテゴリ）を足す
--
-- 作った明細の額は変えない（これから作る荷物の明細から）。行を消す文は無い。

-- 1. 荷物の明細を作る（0132 から。額の決め方だけ変えた） ------------------------------------------

create or replace function public.money_amazon_shipment_feed(p_shipment uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.money_amazon_shipments;
  sl public.money_amazon_shipment_lines;
  o public.money_amazon_orders;
  v_line uuid;
  v_waiting boolean := false;
  v_base integer;
  v_full boolean;
  v_rest integer;
  v_count integer;
  v_picks integer[];
  v_total integer;
  v_names text;
  v_nos text;
  v_first uuid;
  v_store text;
  v_id uuid;
begin
  select * into s from public.money_amazon_shipments where id = p_shipment for update;
  if not found then
    return null;
  end if;
  if s.feed_id is not null then
    return (select status from public.money_feed where id = s.feed_id);
  end if;

  -- 品目を注文と結ぶ
  for sl in
    select * from public.money_amazon_shipment_lines where shipment_id = s.id and line_id is null order by position
  loop
    select l.id into v_line
      from public.money_amazon_lines l
      join public.money_amazon_orders oo on oo.id = l.order_id
     where oo.family_id = s.family_id and oo.order_no = sl.order_no and l.receipt_name = sl.receipt_name
       and l.quantity - coalesce((select sum(x.quantity) from public.money_amazon_shipment_lines x where x.line_id = l.id), 0) >= sl.quantity
     order by l.position
     limit 1;
    if v_line is null then
      select min(l.id::text)::uuid into v_line
        from public.money_amazon_lines l
        join public.money_amazon_orders oo on oo.id = l.order_id
       where oo.family_id = s.family_id and oo.order_no = sl.order_no
         and l.quantity - coalesce((select sum(x.quantity) from public.money_amazon_shipment_lines x where x.line_id = l.id), 0) >= sl.quantity
      having count(*) = 1;
    end if;
    if v_line is null then
      v_waiting := true;
    else
      update public.money_amazon_shipment_lines set line_id = v_line where id = sl.id;
    end if;
  end loop;
  if v_waiting then
    return 'waiting';
  end if;

  -- 前の作りで記録した・確認中の注文なら作らない
  if exists (
    select 1
      from public.money_amazon_shipment_lines x
      join public.money_amazon_lines l on l.id = x.line_id
      join public.money_amazon_orders oo on oo.id = l.order_id
      join public.money_feed f on f.family_id = oo.family_id and f.source = 'amazon_order' and f.status <> 'ignored'
                              and (f.amazon_order_id = oo.id or (position('#' in f.source_id) = 0 and f.source_id = oo.source_id))
     where x.shipment_id = s.id
       and not exists (select 1 from public.money_amazon_shipments z where z.feed_id = f.id)
  ) then
    return 'recorded';
  end if;

  -- 額（注文ごと）: 品目は値引き前の額。値引きは、品目に当てはめられれば（定期おトク便の 5%・10%）その品目に乗せる。
  -- 注文の全部の個数が発送された荷物で、注文の合計に足りない（余る）ぶんを、その荷物のいちばん大きい品目に乗せる
  -- （当てはめられない値引き・ポイント・送料など。注文の荷物の額の和 = 注文の合計）
  for o in
    select distinct oo.*
      from public.money_amazon_shipment_lines x
      join public.money_amazon_lines l on l.id = x.line_id
      join public.money_amazon_orders oo on oo.id = l.order_id
     where x.shipment_id = s.id
  loop
    select sum(l.amount)::integer,
           sum(l.quantity) = (select coalesce(sum(x.quantity), 0)
                                from public.money_amazon_shipment_lines x
                                join public.money_amazon_lines l2 on l2.id = x.line_id
                               where l2.order_id = o.id),
           count(*)
      into v_base, v_full, v_count
      from public.money_amazon_lines l
     where l.order_id = o.id;

    -- 値引き（品目の和 − 合計）を、品目ごとに「なし・5%・10%」（1個あたり四捨五入 × 個数）で説明できる組み合わせ。1通りだけなら使う
    v_picks := null;
    if v_base - o.total > 0 and v_count <= 12 then
      with recursive ls as (
        select row_number() over (order by l.position, l.id) as n, l.unit_price, l.quantity
          from public.money_amazon_lines l
         where l.order_id = o.id
      ),
      walk (n, total, picks) as (
        select 0::bigint, 0, array[]::integer[]
        union all
        select w.n + 1, w.total + d.unit_off * ls.quantity, w.picks || d.unit_off
          from walk w
          join ls on ls.n = w.n + 1
          cross join lateral (select distinct round(ls.unit_price * r.pct / 100.0)::integer as unit_off
                                from (values (0), (5), (10)) as r (pct)) d
         where w.total + d.unit_off * ls.quantity <= v_base - o.total
      )
      select case when count(distinct picks) = 1 then min(picks) end
        into v_picks
        from walk
       where n = v_count and total = v_base - o.total;
    end if;

    update public.money_amazon_shipment_lines x
       set amount = (l.unit_price - coalesce(v_picks[p.n::integer], 0)) * x.quantity
      from public.money_amazon_lines l
      join (select row_number() over (order by l3.position, l3.id) as n, l3.id
              from public.money_amazon_lines l3
             where l3.order_id = o.id) p on p.id = l.id
     where l.id = x.line_id and x.shipment_id = s.id and l.order_id = o.id;

    if v_full then
      select o.total - coalesce(sum(x.amount), 0) into v_rest
        from public.money_amazon_shipment_lines x
        join public.money_amazon_lines l on l.id = x.line_id
       where l.order_id = o.id;
      if v_rest <> 0 then
        update public.money_amazon_shipment_lines
           set amount = greatest(amount + v_rest, 0)
         where id = (select x.id
                       from public.money_amazon_shipment_lines x
                       join public.money_amazon_lines l on l.id = x.line_id
                      where x.shipment_id = s.id and l.order_id = o.id
                      order by x.amount desc, x.position
                      limit 1);
      end if;
    end if;
  end loop;

  select coalesce(sum(x.amount), 0)::integer,
         string_agg(l.name, '・' order by x.position),
         (array_agg(l.order_id order by x.position))[1]
    into v_total, v_names, v_first
    from public.money_amazon_shipment_lines x
    join public.money_amazon_lines l on l.id = x.line_id
   where x.shipment_id = s.id;
  if v_total <= 0 then
    return 'skipped';
  end if;
  select string_agg(distinct x.order_no, ' / ') into v_nos
    from public.money_amazon_shipment_lines x where x.shipment_id = s.id;

  -- お店: 登録したお店のうち Amazon の名前のもの、無ければ「Amazon」
  select st.name into v_store from public.money_stores st
   where st.family_id = s.family_id and st.archived_at is null and normalize(st.name, NFKC) ~* '(amazon|アマゾン)'
   order by length(st.name), st.name
   limit 1;

  insert into public.money_feed (family_id, source, source_id, received_at, subject, raw_line,
                                 direction, occurred_on, amount, account_name, description, store_hint, amazon_order_id, status)
  values (s.family_id, 'amazon_order', s.source_id, s.received_at,
          left(coalesce(nullif(s.subject, ''), 'Amazon の発送'), 500), left('注文番号 ' || coalesce(v_nos, ''), 500),
          'out', s.shipped_on, v_total, '三井住友カード（Amazon）', left(coalesce(v_names, ''), 200),
          coalesce(v_store, 'Amazon'), v_first, 'pending')
  on conflict (family_id, source, source_id) do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicate';
  end if;
  update public.money_amazon_shipments set feed_id = v_id where id = s.id;
  return public.money_feed_process(v_id);
end;
$function$;

revoke execute on function public.money_amazon_shipment_feed(uuid) from public, anon, authenticated;

-- 2. 「記録を作成する」で入れる品目（0132 から。荷物の品目に discount を足した） ---------------------------
--   荷物の明細: 荷物の品目（発送した個数・値引き前の単価・乗る値引き）と、合計 = 明細の額
--   前の作りの明細（注文ごと・メールごと）: 0131 と同じ（値引きはアプリが1行にまとめる）

create or replace function public.money_feed_order_lines(p_feed uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  f public.money_feed;
  v_result jsonb;
begin
  select * into f from public.money_feed where id = p_feed and family_id = public.current_family_id();
  if not found then
    return null;
  end if;

  if exists (select 1 from public.money_amazon_shipments s where s.feed_id = f.id) then
    select jsonb_build_object(
             'total', coalesce(sum(x.amount), 0),
             'lines', coalesce(jsonb_agg(jsonb_build_object(
                        'receipt_name', l.receipt_name,
                        'name', coalesce(nullif((select i.name from public.money_items i
                                                  where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.name <> ''
                                                  order by i.created_at desc limit 1), ''), l.name),
                        'quantity', x.quantity,
                        'unit_price', l.unit_price,
                        -- この品目に乗る値引き（マイナスは送料など）。アプリは品目の下に「値引き」の行を足す
                        'discount', l.unit_price * x.quantity - x.amount,
                        'category_id', coalesce(
                          (select i.category_id from public.money_items i
                            where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.category_id is not null
                              and exists (select 1 from public.money_categories c where c.id = i.category_id and c.archived_at is null)
                            order by i.created_at desc limit 1),
                          (select c.id from public.money_categories c where c.id = l.category_id and c.archived_at is null)))
                      order by x.position), '[]'::jsonb))
      into v_result
      from public.money_amazon_shipments s
      join public.money_amazon_shipment_lines x on x.shipment_id = s.id
      join public.money_amazon_lines l on l.id = x.line_id
     where s.feed_id = f.id;
    return v_result;
  end if;

  with fo as (
    select o.*
      from public.money_amazon_orders o
     where o.family_id = f.family_id
       and (o.id = f.amazon_order_id
            or (position('#' in f.source_id) = 0
                and o.source_id = f.source_id
                and not exists (select 1 from public.money_feed x where x.amazon_order_id = o.id and x.id <> f.id)))
  )
  select jsonb_build_object(
           'total', (select sum(fo.total) from fo),
           'lines', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'receipt_name', l.receipt_name,
                      'name', coalesce(nullif((select i.name from public.money_items i
                                                where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.name <> ''
                                                order by i.created_at desc limit 1), ''), l.name),
                      'quantity', l.quantity,
                      'unit_price', l.unit_price,
                      'category_id', coalesce(
                        (select i.category_id from public.money_items i
                          where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.category_id is not null
                            and exists (select 1 from public.money_categories c where c.id = i.category_id and c.archived_at is null)
                          order by i.created_at desc limit 1),
                        (select c.id from public.money_categories c where c.id = l.category_id and c.archived_at is null)))
                    order by fo.created_at, fo.order_no, l.position)
               from fo
               join public.money_amazon_lines l on l.order_id = fo.id), '[]'::jsonb))
    into v_result
   where exists (select 1 from fo);
  return v_result;
end;
$function$;

revoke execute on function public.money_feed_order_lines(uuid) from public, anon;
grant execute on function public.money_feed_order_lines(uuid) to authenticated;
