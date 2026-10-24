-- かぞく手帳: Gmail の取り込みで「対象外」のメールをゴミ箱へ移さない（docs/kakei.md §9.8）
--
-- 0134 では、取り込まないメール（対象外）はすぐゴミ箱へ移していた。人が確かめてから手で消すので、
-- 「対象外」のラベルを付けて受信トレイから外すだけにする（2026-10-24に決定）。
--   money_feed_mail_sync（置き換え。0134 から。対象外の trash を false にしただけ）
--
-- 行を消す文は無い。Apps Script は変えない（返す trash が false になるだけ）。

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
             when st.outcome = 'skipped' then false
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
  -- 「対象外」は人が確かめてから消すので、ゴミ箱へ移さない（0135）
  select coalesce(jsonb_agg(jsonb_build_object('id', message_id, 'label', label, 'trash', trash)), '[]'::jsonb)
    into v_changes
    from (select message_id, label, coalesce(trash, false) and label <> 'skipped' as trash
            from labels
           where label is distinct from applied or (trash and label <> 'skipped')
           limit 100) as c;

  return jsonb_build_object('missing', v_missing, 'changes', v_changes);
end;
$function$;

revoke execute on function public.money_feed_mail_sync(uuid, text[], jsonb) from public, anon, authenticated;
