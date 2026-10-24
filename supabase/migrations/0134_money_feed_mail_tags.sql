-- かぞく手帳: Gmail の取り込みのラベルを「どこからのメールか」の4つにし、読んだメールは受信トレイから外す（docs/kakei.md §9.8）
--
-- 今まで（0117・0119）は、明細の状態でラベル（かぞく手帳/未確認・済・対象外・読めない）を付け、未確認のメールは受信トレイに戻していた。
-- 受信トレイにメールがたまるので、次のようにする（2026-10-23に決定）。
--   ラベル: Olive/クレジット・Olive/デビット（カードの利用通知）、Amazon（注文メール・発送メール）、対象外（取り込まないメール）
--   受信トレイ: 読み込んだら外す（アーカイブ。Apps Script がラベルを付けるときに外す）
--   ゴミ箱: 確認が済んだら移す
--     利用通知 … そのメールの明細が全部片づいた（記録した・記録しない）
--     発送メール … その荷物の明細が片づいた（明細を作らない荷物（0円・前の作りで記録した）は、品目が注文と結べたら）
--     注文メール … そのメールの注文が全部、片づいた（全部の個数が発送され、その荷物が片づいた。前の作りで記録した注文も）
--     対象外 … すぐ
--   取り込みの開始より前のメールには何もしない（人が自分で片づける）。読めない Amazon のメールは Amazon を付けて残す
--
--   1. money_feed_mails.tag（付けたラベル。今までの label は前の版の Apps Script のために残す）
--   2. money_feed_mail_sync（置き換え。0119 から）
--
-- 行を消す文は無い。
-- 適用の順序: これを適用してから、Apps Script（tools/gas/gmail-feed.gs）を貼り直し、関数 removeOldLabels を1回実行する

-- 1. 付けたラベル ---------------------------------------------------------------------

alter table public.money_feed_mails
  add column if not exists tag text check (tag in ('olive_credit', 'olive_debit', 'amazon', 'skipped'));

comment on column public.money_feed_mails.tag is
  'Apps Script が Gmail に付けたと伝えたラベル（olive_credit・olive_debit・amazon・skipped）。docs/kakei.md §9.8';

-- 2. Apps Script との同期 ----------------------------------------------------------------
--   p_ids:     Apps Script が Gmail で見つけたメールのID
--   p_applied: Apps Script が付けたラベル・ゴミ箱へ移したメール [{ id, label, trashed }]（label は tag の値。前の版は label の値）
--   返り値 { missing: まだ受け取っていないID, changes: [{ id, label, trash }] }（label は tag の値）

create or replace function public.money_feed_mail_sync(p_family uuid, p_ids text[], p_applied jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_missing jsonb;
  v_changes jsonb;
begin
  update public.money_feed_mails m
     set tag = case when a ->> 'label' in ('olive_credit', 'olive_debit', 'amazon', 'skipped') then a ->> 'label' else m.tag end,
         label = case when a ->> 'label' in ('open', 'done', 'unreadable') then a ->> 'label' else m.label end,
         trashed_at = case when (a ->> 'trashed')::boolean then coalesce(m.trashed_at, now()) else m.trashed_at end
    from jsonb_array_elements(coalesce(p_applied, '[]'::jsonb)) as a
   where m.family_id = p_family and m.message_id = a ->> 'id';

  update public.money_feed_tokens set last_sync_at = now() where family_id = p_family;

  select coalesce(jsonb_agg(i.id), '[]'::jsonb) into v_missing
    from unnest(coalesce(p_ids, '{}'::text[])) as i (id)
   where not exists (select 1 from public.money_feed_mails m where m.family_id = p_family and m.message_id = i.id);

  with states as (
    -- そのメールから作った明細（利用通知・発送メール・前の作りの注文メール）
    select m.message_id, m.tag as applied, m.outcome, f.n, f.debit, f.card, f.open
      from public.money_feed_mails m
      left join lateral (
        select count(*) as n,
               bool_or(position('デビット' in coalesce(x.account_name, '')) > 0) as debit,
               bool_or(x.source = 'card_mail') as card,
               bool_or(x.status in ('pending', 'confirm', 'unreadable')) as open
          from public.money_feed x
         where m.outcome in ('feed', 'order') and x.family_id = p_family
           and (x.source_id = m.message_id or x.source_id like m.message_id || '#%')
      ) f on true
     where m.family_id = p_family and m.trashed_at is null and m.outcome <> 'before_start'
  ), settled as (
    select st.*,
           case
             when st.outcome = 'skipped' then true
             when st.outcome = 'feed' then st.n > 0 and not st.open
             when st.outcome <> 'order' then false
             -- 発送メール: 荷物の明細が片づいたら。明細を作らなかった荷物（0円・前の作りで記録した）は、品目が全部、注文と結べたら
             when exists (select 1 from public.money_amazon_shipments s where s.family_id = p_family and s.source_id = st.message_id) then
               case when st.n > 0 then not st.open else not exists (select 1
                             from public.money_amazon_shipments s
                             join public.money_amazon_shipment_lines x on x.shipment_id = s.id
                            where s.family_id = p_family and s.source_id = st.message_id and x.line_id is null) end
             -- 注文メール（前の作りで、このメールから作った明細は見ない。「記録しない」にしたものは荷物の明細として出直すため）: 注文が全部片づいた
             else exists (select 1 from public.money_amazon_orders o where o.family_id = p_family and o.source_id = st.message_id)
                  and not exists (
                    select 1
                      from public.money_amazon_orders o
                     where o.family_id = p_family and o.source_id = st.message_id
                       -- 前の作り（注文ごと・メールごと）で記録した注文は片づいている
                       and not exists (select 1 from public.money_feed f
                                        where f.family_id = p_family and f.source = 'amazon_order'
                                          and f.status in ('linked', 'created')
                                          and not exists (select 1 from public.money_amazon_shipments z where z.feed_id = f.id)
                                          and (f.amazon_order_id = o.id or f.source_id = o.source_id or f.source_id like o.source_id || '#%'))
                       and (
                         -- まだ発送していない個数がある
                         (select coalesce(sum(l.quantity), 0) from public.money_amazon_lines l where l.order_id = o.id)
                           > (select coalesce(sum(x.quantity), 0)
                                from public.money_amazon_shipment_lines x
                                join public.money_amazon_lines l on l.id = x.line_id
                               where l.order_id = o.id)
                         -- 荷物の明細がまだ片づいていない
                         or exists (select 1
                                      from public.money_amazon_shipment_lines x
                                      join public.money_amazon_lines l on l.id = x.line_id
                                      join public.money_amazon_shipments s on s.id = x.shipment_id
                                      join public.money_feed f on f.id = s.feed_id
                                     where l.order_id = o.id and f.status in ('pending', 'confirm', 'unreadable'))
                       ))
           end as trash
      from states st
  ), labels as (
    select message_id, applied, trash,
           case
             when outcome = 'skipped' then 'skipped'
             when outcome in ('order', 'unreadable') then 'amazon'
             when n > 0 and not card then 'skipped'
             when debit then 'olive_debit'
             else 'olive_credit'
           end as label
      from settled
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', message_id, 'label', label, 'trash', trash)), '[]'::jsonb)
    into v_changes
    from (select * from labels where label is distinct from applied or trash limit 100) as c;

  return jsonb_build_object('missing', v_missing, 'changes', v_changes);
end;
$function$;

revoke execute on function public.money_feed_mail_sync(uuid, text[], jsonb) from public, anon, authenticated;
