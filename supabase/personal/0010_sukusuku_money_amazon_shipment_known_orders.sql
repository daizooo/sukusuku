-- かぞく手帳: 0円の注文に当たる発送メールは、荷物として覚えない（docs/kakei.md §9.13）
--
-- 合計 0円（全額ポイント・ギフト券など）の注文は、注文メールを読んでも DB に覚えない（parseAmazonOrderMail）。
-- その発送メールは今まで荷物として覚え、注文が無いので品目を結べないまま、いつまでも待っていた（2026-11-08 に4件を確認）。
-- 0円は DB に残さない（2026-11-09 に決定）ので、発送メールは「DB に注文のある品目」だけを荷物にする。
--   - 注文のある品目が1つも無い発送メール（0円の注文だけの荷物・取り込みの開始より前の注文）は、行を作らない（返り値 status = 'skipped'）
--   - 0円の注文と払う注文が同じ荷物に入るときは、払う注文の品目だけを荷物にする
--     （今まではこの荷物は、0円の品目が結べず、払う注文の分まで明細にならなかった）
--   - 注文があるのに品目が結べないもの（品名の揺れ・注文メールの取りこぼし）は、今まで通り待つ
-- 注文メールは必ず発送メールより先に処理される（Edge Function money-feed-ingest は届いた順に入れ、注文メールが書けなければ
-- あとの発送メールも書かない）。
--
-- 行を消す文は無い（既にある待ちの荷物の片づけは、SQL Editor で流す。PR の本文）。
-- 適用の順序: 先にこれを適用してから、Edge Function を出す。何度流しても同じ。

create or replace function sukusuku.money_amazon_shipment_receive(p_family uuid, p_shipment jsonb) returns jsonb
    language plpgsql security definer
    set search_path to 'sukusuku'
    as $function$
declare
  v_id uuid;
  v_start timestamptz;
  v_known integer;
begin
  select start_at into v_start from sukusuku.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_shipment ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  -- DB に注文のある品目（0円の注文は覚えていないので、ここで外れる）
  select count(*) into v_known
    from jsonb_array_elements(p_shipment -> 'lines') as entries (item)
   where exists (select 1 from sukusuku.money_amazon_orders o
                  where o.family_id = p_family and o.order_no = entries.item ->> 'order_no');
  if v_known = 0 then
    return jsonb_build_object('status', 'skipped');
  end if;

  insert into sukusuku.money_amazon_shipments (family_id, source_id, received_at, shipped_on, subject)
  values (p_family, p_shipment ->> 'source_id', (p_shipment ->> 'received_at')::timestamptz,
          (p_shipment ->> 'shipped_on')::date, left(coalesce(p_shipment ->> 'subject', ''), 500))
  on conflict (family_id, source_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into sukusuku.money_amazon_shipment_lines (family_id, shipment_id, position, order_no, receipt_name, quantity)
  select p_family, v_id, (entries.ordinality - 1)::integer,
         entries.item ->> 'order_no', entries.item ->> 'receipt_name',
         least(9999, greatest(1, coalesce((entries.item ->> 'quantity')::integer, 1)))
    from jsonb_array_elements(p_shipment -> 'lines') with ordinality as entries (item, ordinality)
   where exists (select 1 from sukusuku.money_amazon_orders o
                  where o.family_id = p_family and o.order_no = entries.item ->> 'order_no');

  return jsonb_build_object('status', 'saved', 'id', v_id, 'feed', sukusuku.money_amazon_shipment_feed(v_id));
end;
$function$;

revoke execute on function sukusuku.money_amazon_shipment_receive(uuid, jsonb) from public, anon, authenticated;
