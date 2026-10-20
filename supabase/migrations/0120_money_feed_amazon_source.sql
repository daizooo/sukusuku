-- かぞく手帳: Amazon の注文メールの明細を、明細の種類（source）で分ける・品目の個数を残す（docs/kakei.md §9.10）
--
-- 0119 では注文メールの明細を source = 'card_mail' のまま amazon_order_id で見分けていた。種類 'amazon_order' に分ける。
-- 「記録を作成する」の品目は、値引きを配った額を DB で返していたが、個数で割り切れないと1個にしていた。
-- 個数を残すため、DB は注文の合計と品目（値引き前）だけを返し、配り方はアプリ（moneyFeedUtils の feedOrderItems）で決める。
--
--   1. source の check 制約に 'amazon_order' を足す・使わなくなった money_feed_amazon_create を消す（削除を含む。SQL Editor で流す）
--   2. 注文メールの明細を 'amazon_order' にする・money_amazon_order_feed を置き換える（以下は MCP で適用）
--   3. money_feed_order_lines を置き換える（返り値 { total, lines: [{ receipt_name, name, quantity, unit_price, category_id }] }）
--
-- 適用の順序: 1（SQL Editor）→ 2・3

-- 1. （SQL Editor）-------------------------------------------------------------

alter table public.money_feed drop constraint if exists money_feed_source_check;
alter table public.money_feed add constraint money_feed_source_check
  check (source = any (array['zaim_mail'::text, 'card_mail'::text, 'amazon_order'::text]));

drop function if exists public.money_feed_amazon_create(uuid);

-- 2. 注文メールの明細の種類 ---------------------------------------------------------

update public.money_feed set source = 'amazon_order' where amazon_order_id is not null and source = 'card_mail';

create or replace function public.money_amazon_order_feed(p_order uuid, p_received_at timestamptz, p_subject text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.money_amazon_orders;
  v_id uuid;
  v_status text;
  v_store text;
  v_names text;
begin
  select * into o from public.money_amazon_orders where id = p_order;
  if not found then
    return null;
  end if;
  select status into v_status from public.money_feed where family_id = o.family_id and amazon_order_id = o.id limit 1;
  if found then
    return v_status;
  end if;

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
  values (o.family_id, 'amazon_order', o.source_id || '#' || o.order_no, coalesce(p_received_at, o.created_at),
          left(coalesce(nullif(p_subject, ''), 'Amazon の注文'), 500), left('注文番号 ' || o.order_no, 500),
          'out', o.ordered_on, o.total, '三井住友カード（Amazon）', left(coalesce(v_names, ''), 200),
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

-- 3. 「記録を作成する」で入れる品目（アプリが呼ぶ） ------------------------------------------
--   返り値 { total: 注文メールの合計, lines: [{ receipt_name, name, quantity, unit_price, category_id }] }（注文メールの並び順。単価は値引き前）
--   品名・カテゴリは、同じ品名（メールの表記 = money_items.receipt_name）の、いちばん新しい品目のもの。無ければ注文のときに決めたもの

create or replace function public.money_feed_order_lines(p_feed uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
           'total', o.total,
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
                    order by l.position)
               from public.money_amazon_lines l
              where l.order_id = o.id), '[]'::jsonb))
    from public.money_feed f
    join public.money_amazon_orders o on o.id = f.amazon_order_id and o.family_id = f.family_id
   where f.id = p_feed and f.family_id = public.current_family_id();
$function$;

revoke execute on function public.money_feed_order_lines(uuid) from public, anon;
grant execute on function public.money_feed_order_lines(uuid) to authenticated;
