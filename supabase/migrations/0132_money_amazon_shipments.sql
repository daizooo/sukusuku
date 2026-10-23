-- かぞく手帳: Amazon の未確認の明細を、発送パッケージ（＝請求1件）ごとにする（docs/kakei.md §9.13）
--
-- Amazon は発送した日に、発送パッケージごとにカードへ請求する（別々に注文した品目が同じ荷物になれば、その合計で1回）。
-- 記録を請求とかみ合わせ、締めでカードの明細と1件ずつ振り返れるように、未確認の明細を「荷物1つにつき1件」にする。
--
--   注文メール: 品目・個数・単価と、注文の合計（値引き・ポイントを引いた、払う額）を覚える（今まで通り。明細は作らない）
--   発送メール: どの注文のどの品目が何個、同じ荷物に入ったかと、発送日を覚える（単価は値引き前なので使わない）
--   荷物の品目がすべて注文と結べたら、未確認の明細を1件作る（日付は発送日。額は注文の合計を品目に配ったもの）。
--   注文メールと発送メールがそろうまでは、未確認に出さない
--
--   1. 表 money_amazon_shipments（荷物 = 発送メール1通）・money_amazon_shipment_lines（荷物の品目。注文の品目と結ぶ）
--   2. money_amazon_shipment_feed    荷物の品目を注文と結び、額を配って明細を作る
--   3. money_amazon_shipment_receive 発送メールを覚える（Edge Function money-feed-ingest が呼ぶ）
--   4. money_amazon_order_receive    注文を覚えても明細は作らない。この注文を待っている荷物があれば、そこで明細を作る（置き換え。0119 から）
--   5. money_feed_order_lines        荷物の明細なら、荷物の品目（発送した個数）と、配った額の合計を返す（置き換え。0131 から）
--   6. 切り替え: 注文ごと・メールごとに作った未確認の明細は「記録しない」にする（発送メールが届けば、荷物の明細として出直す）
--
-- 行を消す文は無い。
-- 適用の順序: これを適用してから、Edge Function money-feed-ingest を出し、Apps Script（tools/gas/gmail-feed.gs）を貼り直す（発送メールも探す）

-- 1. 表 ---------------------------------------------------------------------------

create table if not exists public.money_amazon_shipments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- 発送メールの Gmail のメッセージID
  source_id text not null,
  received_at timestamptz not null,
  -- 発送日（発送メールの受信日、日本時間）。明細・記録の日付
  shipped_on date not null,
  subject text not null default '',
  -- 作った明細（品目がまだ注文と結べないあいだは空）
  feed_id uuid,
  created_at timestamptz not null default now(),
  constraint money_amazon_shipments_source_key unique (family_id, source_id),
  constraint money_amazon_shipments_id_family_key unique (id, family_id),
  constraint money_amazon_shipments_feed_fkey foreign key (feed_id, family_id)
    references public.money_feed (id, family_id) on delete set null (feed_id)
);

create table if not exists public.money_amazon_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  shipment_id uuid not null,
  -- 発送メールの並び順
  position integer not null,
  order_no text not null,
  -- 発送メールの品名（注文メールの品名と同じ表記）
  receipt_name text not null,
  quantity integer not null check (quantity >= 1 and quantity <= 9999),
  -- 結んだ注文の品目（結べるまで空）
  line_id uuid references public.money_amazon_lines (id) on delete set null,
  -- 注文の合計を配った額（明細を作るときに決める）
  amount integer check (amount >= 0),
  created_at timestamptz not null default now(),
  constraint money_amazon_shipment_lines_shipment_fkey foreign key (shipment_id, family_id)
    references public.money_amazon_shipments (id, family_id) on delete cascade
);

create index if not exists idx_money_amazon_shipments_feed_id on public.money_amazon_shipments (feed_id);
create index if not exists idx_money_amazon_shipment_lines_shipment_id on public.money_amazon_shipment_lines (shipment_id);
create index if not exists idx_money_amazon_shipment_lines_line_id on public.money_amazon_shipment_lines (line_id);
create index if not exists idx_money_amazon_shipment_lines_order_no on public.money_amazon_shipment_lines (family_id, order_no);

-- 関数（security definer）からだけ触る。アプリからは読まない（ポリシー無し）
alter table public.money_amazon_shipments enable row level security;
alter table public.money_amazon_shipment_lines enable row level security;
grant all on public.money_amazon_shipments to service_role;
grant all on public.money_amazon_shipment_lines to service_role;

select public.attach_family_sync('public.money_amazon_shipments');
select public.attach_family_sync('public.money_amazon_shipment_lines');

-- 2. 荷物の明細を作る ---------------------------------------------------------------
--   - 荷物の品目を、注文番号と品名で注文の品目に結ぶ（同じ品名が並ぶときは、まだ発送していない個数の残る先の品目）。
--     品名で当たらなくても、その注文でまだ発送していない品目が1つだけならそれに結ぶ。1つでも結べなければ待つ（'waiting'）
--   - 結んだ注文が、前の作り（注文ごと・メールごと）で記録した・確認中の明細を持つなら作らない（'recorded'。二重にしない）
--   - 額: 注文ごとに、注文の合計を品目の値引き前の額の比で配る（切り捨て）。その荷物で注文の全部の個数が発送されたら、
--     注文の合計に足りない端数を、その荷物のいちばん大きい品目に足す（注文の荷物の額の和 = 注文の合計）
--   - 明細: 日付は発送日、額は配った額の和（0円ならポイント・ギフト券だけの支払いで請求が無いので作らない。'skipped'）

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

  -- 額を配る（注文ごと）
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
                               where l2.order_id = o.id)
      into v_base, v_full
      from public.money_amazon_lines l
     where l.order_id = o.id;

    update public.money_amazon_shipment_lines x
       set amount = case when v_base > 0 then floor(o.total::numeric * l.unit_price * x.quantity / v_base)::integer else 0 end
      from public.money_amazon_lines l
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

-- 3. 発送メールを覚える -----------------------------------------------------------------
--   p_shipment: { source_id, received_at, subject, shipped_on, lines: [{ order_no, receipt_name, quantity }] }
--   返り値 { status: saved | duplicate | before_start, id, feed: 明細の状態（waiting = 注文メール待ち） }

create or replace function public.money_amazon_shipment_receive(p_family uuid, p_shipment jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_start timestamptz;
begin
  select start_at into v_start from public.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_shipment ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into public.money_amazon_shipments (family_id, source_id, received_at, shipped_on, subject)
  values (p_family, p_shipment ->> 'source_id', (p_shipment ->> 'received_at')::timestamptz,
          (p_shipment ->> 'shipped_on')::date, left(coalesce(p_shipment ->> 'subject', ''), 500))
  on conflict (family_id, source_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.money_amazon_shipment_lines (family_id, shipment_id, position, order_no, receipt_name, quantity)
  select p_family, v_id, (entries.ordinality - 1)::integer,
         entries.item ->> 'order_no', entries.item ->> 'receipt_name',
         least(9999, greatest(1, coalesce((entries.item ->> 'quantity')::integer, 1)))
    from jsonb_array_elements(p_shipment -> 'lines') with ordinality as entries (item, ordinality);

  return jsonb_build_object('status', 'saved', 'id', v_id, 'feed', public.money_amazon_shipment_feed(v_id));
end;
$function$;

revoke execute on function public.money_amazon_shipment_receive(uuid, jsonb) from public, anon, authenticated;

-- 4. 注文を覚える（0119 から。明細は作らず、この注文を待っている荷物の明細を作る） ----------------------------

create or replace function public.money_amazon_order_receive(p_family uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_start timestamptz;
  v_ship uuid;
begin
  select start_at into v_start from public.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_order ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into public.money_amazon_orders (family_id, order_no, source_id, ordered_on, total, adjust)
  values (p_family, p_order ->> 'order_no', p_order ->> 'source_id', (p_order ->> 'ordered_on')::date,
          (p_order ->> 'total')::integer, coalesce((p_order ->> 'adjust')::integer, 0))
  on conflict (family_id, order_no) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.money_amazon_lines (family_id, order_id, position, receipt_name, name, quantity, unit_price, amount, category_id)
  select p_family, v_id, (entries.ordinality - 1)::integer,
         entries.item ->> 'receipt_name', coalesce(entries.item ->> 'name', ''),
         coalesce((entries.item ->> 'quantity')::integer, 1), (entries.item ->> 'unit_price')::integer,
         (entries.item ->> 'amount')::integer,
         (select c.id from public.money_categories c
           where c.family_id = p_family and c.id = nullif(entries.item ->> 'category_id', '')::uuid)
    from jsonb_array_elements(p_order -> 'lines') with ordinality as entries (item, ordinality);

  -- この注文を待っている荷物（発送メールが先に届いたもの）の明細を作る
  for v_ship in
    select distinct x.shipment_id
      from public.money_amazon_shipment_lines x
      join public.money_amazon_shipments s on s.id = x.shipment_id
     where x.family_id = p_family and x.order_no = p_order ->> 'order_no' and s.feed_id is null
  loop
    perform public.money_amazon_shipment_feed(v_ship);
  end loop;

  return jsonb_build_object('status', 'saved', 'id', v_id);
end;
$function$;

revoke execute on function public.money_amazon_order_receive(uuid, jsonb) from public, anon, authenticated;

-- 5. 「記録を作成する」で入れる品目（アプリが呼ぶ。返り値の形は 0120 と同じ） ------------------------------
--   荷物の明細: 荷物の品目（発送した個数・値引き前の単価）と、合計 = 配った額の和（= 明細の額）。値引きはアプリの feedOrderItems が品目に配る
--   前の作りの明細（注文ごと・メールごと）: 0131 と同じ

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

-- 6. 切り替え: 注文ごと・メールごとに作った、まだ未確認の明細は「記録しない」にする -----------------------------
--   注文と品目は残るので、発送メールが届けば荷物の明細として出直す（2 の「前の作りで記録した」には当たらない: 記録しないにした明細は数えない）

update public.money_feed f
   set status = 'ignored', resolved_at = now(), candidate_record_ids = '{}'
 where f.source = 'amazon_order' and f.status in ('pending', 'confirm')
   and not exists (select 1 from public.money_amazon_shipments s where s.feed_id = f.id);
