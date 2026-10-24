-- かぞく手帳: Amazon の注文メールの明細を、注文番号ごとではなく「メール1通につき1件」にする（docs/kakei.md §9.10）
--
-- Amazon は1回の注文でも、出品者・発送元ごとに注文番号を分け、1通のメールに注文番号が何件も載る。
-- 0119 は注文番号ごとに明細を作っていたため、1回の注文が何件もの明細に分かれていた（2026-10-23に気づいた）。
-- 記録は「いま何を何個買ったか」を残すもので、カードの請求（発送パッケージごと）とは結べない。メール1通 = 1回の注文として1件にする。
--
--   money_amazon_orders / money_amazon_lines は注文番号ごとのまま（重複防止と、注文ごとの値引きの記録）。
--   明細（money_feed）をメール1通につき1件にする:
--     source_id = メールのID（以前は「メールのID#注文番号」）。amazon_order_id = そのメールの最初の注文。
--     同じメールの2件目以降の注文は、未確認（pending / confirm）の明細に足し込む（額・品目の名前・注文番号を作り直して、突き合わせをやり直す）。
--     すでに記録した・記録しないにした明細には足さず、その注文だけの明細を別に作る（source_id は「メールのID#注文番号」）。
--
--   1. money_amazon_order_feed   注文を覚えたら、メール単位の明細を作る・足し込む（置き換え。0120 から）
--   2. money_feed_order_lines    「記録を作成する」で入れる品目と合計を、明細にまとまった全注文ぶん返す（置き換え。0120 から）
--   3. 今ある未確認の明細のうち、同じメールのものを1件にまとめる（残りは「記録しない」にして切り離す）
--   4. （SQL Editor・任意）まとめて切り離した明細を消す
--
-- 注文の保存（money_amazon_order_receive）と Edge Function money-feed-ingest は変えない（注文を1件ずつ呼ぶままで動く）。
-- 画面（アプリ）も変えない: amazon_order_id があれば品目つきで開き、品目と合計は money_feed_order_lines が返す。

-- 1. 注文を覚えたら、メール単位の明細を作る・足し込む ---------------------------------------------------

create or replace function public.money_amazon_order_feed(p_order uuid, p_received_at timestamptz, p_subject text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.money_amazon_orders;
  f public.money_feed;
  v_id uuid;
  v_status text;
  v_store text;
  v_names text;
  v_nos text;
  v_total integer;
  v_source_id text;
begin
  select * into o from public.money_amazon_orders where id = p_order;
  if not found then
    return null;
  end if;
  -- この注文がすでに明細になっていれば、そのまま（注文番号ごとだった前の明細も）
  select status into v_status from public.money_feed where family_id = o.family_id and amazon_order_id = o.id limit 1;
  if found then
    return v_status;
  end if;

  -- 同じメールの明細（メールのID）
  select * into f from public.money_feed
   where family_id = o.family_id and source = 'amazon_order' and source_id = o.source_id
   for update;

  if f.id is not null and f.status in ('pending', 'confirm') then
    -- 未確認の明細に足し込む。額・品目の名前・注文番号をそのメールの全注文で作り直し、突き合わせをやり直す
    select sum(oo.total)::integer, string_agg(oo.order_no, ' / ' order by oo.created_at, oo.order_no)
      into v_total, v_nos
      from public.money_amazon_orders oo
     where oo.family_id = o.family_id and oo.source_id = o.source_id
       and not exists (select 1 from public.money_feed x where x.amazon_order_id = oo.id and x.id <> f.id);
    select string_agg(l.name, '・' order by oo.created_at, oo.order_no, l.position) into v_names
      from public.money_amazon_orders oo
      join public.money_amazon_lines l on l.order_id = oo.id
     where oo.family_id = o.family_id and oo.source_id = o.source_id
       and not exists (select 1 from public.money_feed x where x.amazon_order_id = oo.id and x.id <> f.id);
    update public.money_feed
       set amount = v_total, description = left(coalesce(v_names, ''), 200), raw_line = left('注文番号 ' || v_nos, 500),
           candidate_record_ids = '{}', status = 'pending'
     where id = f.id;
    return public.money_feed_process(f.id);
  end if;

  -- 新しい明細。同じメールの明細がすでに片づいていれば、この注文だけの明細にする
  v_source_id := case when f.id is not null then o.source_id || '#' || o.order_no else o.source_id end;
  v_total := o.total;
  v_nos := o.order_no;

  -- お店: 登録したお店のうち Amazon の名前のもの、無ければ「Amazon」
  select s.name into v_store from public.money_stores s
   where s.family_id = o.family_id and s.archived_at is null and normalize(s.name, NFKC) ~* '(amazon|アマゾン)'
   order by length(s.name), s.name
   limit 1;
  -- 未確認の一覧に出す品目の名前（利用先の代わり）
  select string_agg(l.name, '・' order by l.position) into v_names
    from public.money_amazon_lines l where l.order_id = o.id;

  insert into public.money_feed (family_id, source, source_id, received_at, subject, raw_line,
                                 direction, occurred_on, amount, account_name, description, store_hint, amazon_order_id, status)
  values (o.family_id, 'amazon_order', v_source_id, coalesce(p_received_at, o.created_at),
          left(coalesce(nullif(p_subject, ''), 'Amazon の注文'), 500), left('注文番号 ' || v_nos, 500),
          'out', o.ordered_on, v_total, '三井住友カード（Amazon）', left(coalesce(v_names, ''), 200),
          coalesce(v_store, 'Amazon'), o.id, 'pending')
  on conflict (family_id, source, source_id) do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicate';
  end if;
  return public.money_feed_process(v_id);
end;
$function$;

revoke execute on function public.money_amazon_order_feed(uuid, timestamptz, text) from public, anon, authenticated;

-- 2. 「記録を作成する」で入れる品目（アプリが呼ぶ） ------------------------------------------
--   返り値 { total, lines: [{ receipt_name, name, quantity, unit_price, category_id }] }（0120 と同じ形）
--   明細にまとまった全注文の合計と品目を返す。明細の注文 = amazon_order_id の注文と、同じメールで別の明細に入っていない注文
--   （source_id に # を含む = 注文番号ごとの明細は、amazon_order_id の注文だけ）。並びは注文の順、注文の中はメールの並び順

create or replace function public.money_feed_order_lines(p_feed uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with fo as (
    select o.*
      from public.money_feed f
      join public.money_amazon_orders o
        on o.family_id = f.family_id
       and (o.id = f.amazon_order_id
            or (position('#' in f.source_id) = 0
                and o.source_id = f.source_id
                and not exists (select 1 from public.money_feed x where x.amazon_order_id = o.id and x.id <> f.id)))
     where f.id = p_feed and f.family_id = public.current_family_id()
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
   where exists (select 1 from fo);
$function$;

revoke execute on function public.money_feed_order_lines(uuid) from public, anon;
grant execute on function public.money_feed_order_lines(uuid) to authenticated;

-- 3. 今ある未確認の明細を、同じメールのものを1件にまとめる ------------------------------------------
--   注文番号ごとの未確認（pending）の明細が、同じメールに2件以上あるとき: 先に作った1件を残し（source_id をメールのIDにして、額・品目の名前・
--   注文番号を全注文で作り直す）、残りは「記録しない」にして注文から切り離す（行は消さない。消すのは 4）。
--   すでに記録した・結んだ・記録しないにした明細は触らない。

do $$
declare
  g record;
  v_keep uuid;
  v_total integer;
  v_nos text;
  v_names text;
begin
  for g in
    select o.family_id, o.source_id, array_agg(f.id order by f.created_at, f.id) as fids
      from public.money_feed f
      join public.money_amazon_orders o on o.id = f.amazon_order_id and o.family_id = f.family_id
     where f.source = 'amazon_order' and f.status = 'pending' and position('#' in f.source_id) > 0
     group by o.family_id, o.source_id
    having count(*) > 1
  loop
    v_keep := g.fids[1];
    update public.money_feed
       set status = 'ignored', resolved_at = now(), amazon_order_id = null, candidate_record_ids = '{}'
     where id = any (g.fids[2:]);

    select sum(oo.total)::integer, string_agg(oo.order_no, ' / ' order by oo.created_at, oo.order_no)
      into v_total, v_nos
      from public.money_amazon_orders oo
     where oo.family_id = g.family_id and oo.source_id = g.source_id
       and not exists (select 1 from public.money_feed x where x.amazon_order_id = oo.id and x.id <> v_keep);
    select string_agg(l.name, '・' order by oo.created_at, oo.order_no, l.position) into v_names
      from public.money_amazon_orders oo
      join public.money_amazon_lines l on l.order_id = oo.id
     where oo.family_id = g.family_id and oo.source_id = g.source_id
       and not exists (select 1 from public.money_feed x where x.amazon_order_id = oo.id and x.id <> v_keep);

    update public.money_feed
       set source_id = g.source_id, amount = v_total, description = left(coalesce(v_names, ''), 200),
           raw_line = left('注文番号 ' || v_nos, 500), candidate_record_ids = '{}'
     where id = v_keep;
    perform public.money_feed_process(v_keep);
  end loop;
end;
$$;

-- 4. （SQL Editor・任意）まとめて切り離した明細を消す --------------------------------------------------
--   3 で「記録しない」にして注文から切り離した明細（注文番号ごとの source_id = メールのID#注文番号、amazon_order_id が空）。
--   消さなくても動きは変わらない（一覧には出ない）。
--
-- delete from public.money_feed
--  where source = 'amazon_order' and status = 'ignored' and amazon_order_id is null and position('#' in source_id) > 0;
