-- かぞく手帳: Amazon の注文メールから、未確認の明細を作る（docs/kakei.md §9.10。PR2）
--
-- Amazon の買い物は注文メールから取り込む（Amazon のカードの利用通知は読み取りで捨てる。§9.9）。
-- 今までの「利用通知に注文の品目を割り振る」仕組み（§9.7.3。money_feed_amazon_create）はやめる。
--
--   1. money_amazon_order_feed     注文ごとに未確認の明細を1件作る（届いたらすぐ。出金元は「三井住友カード（Amazon）」の口座の対応、日付は注文日）。
--                                  注文メールの明細は source = 'card_mail' のまま、amazon_order_id で見分ける
--   2. money_amazon_order_receive  注文を覚えたら、明細も作る（置き換え）
--   3. money_feed_order_lines      「記録を作成する」で入れる品目（値引きは品目に配る・送料は「送料など」の1行・品名とカテゴリは同じ品名の前の記録から）
--   4. money_feed_process          注文メールの明細は、取り込みのルール・自動の記録との照合を使わない（置き換え。0116 から）
--   5. money_feed_mail_sync        注文メールのラベルを、明細の状態で決める（未確認 → 済。置き換え。0117 から）
--   6. 切り替えの片づけ             未確認に残る Amazon のカードの利用通知は「記録しない」に。口座の対応を結び直し、
--                                  まだ記録していない注文（取り込みの開始より後）を明細にする
--
-- 行を消す文は無い。使わなくなった money_feed_amazon_create は別に消す（SQL Editor。PR の本文）
--
-- 適用の順序: これを適用してから、Edge Function money-feed-ingest を出す（Apps Script はそのまま）

-- 1. 注文ごとの明細 ----------------------------------------------------------------
--   同じ注文の明細があれば作らない。source_id は「メールのID#注文番号」（1通に注文が何件も入るため。§9.8 の同期でメールと結ぶ）

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
  values (o.family_id, 'card_mail', o.source_id || '#' || o.order_no, coalesce(p_received_at, o.created_at),
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

-- 2. 注文を覚えたら、明細も作る（0109 から。最後に money_amazon_order_feed を呼ぶ） --------------

create or replace function public.money_amazon_order_receive(p_family uuid, p_order jsonb)
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

  return jsonb_build_object('status', 'saved', 'id', v_id,
    'feed', public.money_amazon_order_feed(v_id, (p_order ->> 'received_at')::timestamptz, p_order ->> 'subject'));
end;
$function$;

revoke execute on function public.money_amazon_order_receive(uuid, jsonb) from public, anon, authenticated;

-- 3. 「記録を作成する」で入れる品目（アプリが呼ぶ） ------------------------------------------
--   返り値 [{ receipt_name, name, quantity, unit_price, amount, category_id }]（注文メールの並び順。送料などは最後の1行）
--   - 値引き（合計が品目の和より安いぶん。ポイントで払った分も）は、品目の価格の比で配る。端数は小数部の大きい品目から1円ずつ
--     （0113 の割り振りと同じ配り方。品目の和が合計になる）。個数で割り切れなければ1個として扱う
--   - 合計が品目の和より高いぶんは「送料など」の1行（カテゴリはいちばん金額の大きい品目と同じ）
--   - 品名・カテゴリは、同じ品名（メールの表記 = money_items.receipt_name）の、いちばん新しい品目のもの。無ければ注文のときに決めたもの

create or replace function public.money_feed_order_lines(p_feed uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  f public.money_feed;
  o public.money_amazon_orders;
  v_base integer;
  v_paid integer;
  v_fee integer;
  v_lines jsonb;
  v_top uuid;
begin
  select * into f from public.money_feed where id = p_feed and family_id = public.current_family_id();
  if not found or f.amazon_order_id is null then
    return '[]'::jsonb;
  end if;
  select * into o from public.money_amazon_orders where id = f.amazon_order_id and family_id = f.family_id;
  if not found then
    return '[]'::jsonb;
  end if;
  select coalesce(sum(amount), 0) into v_base from public.money_amazon_lines where order_id = o.id;
  if v_base <= 0 then
    return '[]'::jsonb;
  end if;
  v_fee := greatest(o.total - v_base, 0);
  v_paid := o.total - v_fee;

  with shares as (
    select l.position, l.quantity, l.receipt_name,
           coalesce((select i.category_id from public.money_items i
                      where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.category_id is not null
                        and exists (select 1 from public.money_categories c where c.id = i.category_id and c.archived_at is null)
                      order by i.created_at desc limit 1),
                    (select c.id from public.money_categories c where c.id = l.category_id and c.archived_at is null)) as category_id,
           coalesce(nullif((select i.name from public.money_items i
                             where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.name <> ''
                             order by i.created_at desc limit 1), ''), l.name) as name,
           l.amount,
           (l.amount::bigint * v_paid) / v_base as floor_share,
           (l.amount::bigint * v_paid) % v_base as remainder
      from public.money_amazon_lines l
     where l.order_id = o.id
  ), ranked as (
    select s.*,
           row_number() over (order by s.remainder desc, s.position) as rk,
           v_paid - sum(s.floor_share) over () as leftover
      from shares s
  ), priced as (
    select r.*, (r.floor_share + case when r.rk <= r.leftover then 1 else 0 end)::integer as share
      from ranked r
  )
  select jsonb_agg(jsonb_build_object(
           'receipt_name', p.receipt_name,
           'name', p.name,
           'quantity', case when p.quantity > 1 and p.share % p.quantity = 0 then p.quantity else 1 end,
           'unit_price', case when p.quantity > 1 and p.share % p.quantity = 0 then p.share / p.quantity else p.share end,
           'amount', p.share,
           'category_id', p.category_id) order by p.position),
         (array_agg(p.category_id order by p.amount desc, p.position))[1]
    into v_lines, v_top
    from priced p;

  if v_fee > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'receipt_name', null, 'name', '送料など', 'quantity', 1, 'unit_price', v_fee, 'amount', v_fee, 'category_id', v_top));
  end if;
  return coalesce(v_lines, '[]'::jsonb);
end;
$function$;

revoke execute on function public.money_feed_order_lines(uuid) from public, anon;
grant execute on function public.money_feed_order_lines(uuid) to authenticated;

-- 4. 突き合わせ（0116 から。注文メールの明細は、取り込みのルール・自動の記録との照合を使わない） -------------

create or replace function public.money_feed_process(p_feed uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f public.money_feed;
  s public.money_feed_settings;
  v_wallets uuid[];
  v_requester text;
  v_pairs uuid[];
  g public.money_feed;
  v_out public.money_feed;
  v_in public.money_feed;
  v_cands uuid[];
  r public.money_feed_rules;
  v_record uuid;
  v_kind text;
begin
  select * into f from public.money_feed where id = p_feed for update;
  if not found or f.status not in ('pending') or f.direction is null then
    return coalesce(f.status, 'missing');
  end if;
  select * into s from public.money_feed_settings where family_id = f.family_id;
  if not found then
    insert into public.money_feed_settings (family_id) values (f.family_id) returning * into s;
  end if;

  if f.wallet_id is null then
    select array_agg(id) into v_wallets from public.money_wallets
     where family_id = f.family_id and archived_at is null and feed_name = f.account_name
       and (holder_zaim_email is null or f.to_email is null or lower(holder_zaim_email) = lower(f.to_email));
    if coalesce(array_length(v_wallets, 1), 0) > 1 then
      v_requester := public.money_feed_requester(f.description);
      if v_requester is not null then
        select array_agg(id) into v_wallets from public.money_wallets
         where id = any (v_wallets)
           and regexp_replace(normalize(coalesce(holder_kana, ''), NFKC), '\s+', ' ', 'g') = v_requester;
      end if;
    end if;
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      select array_agg(distinct fr.wallet_id) into v_wallets from public.money_feed_rules fr
       join public.money_wallets w on w.id = fr.wallet_id
       where fr.family_id = f.family_id and fr.match = 'key' and fr.wallet_id is not null
         and w.feed_name = f.account_name
         and (fr.direction is null or fr.direction = f.direction)
         and fr.pattern = public.money_feed_key(f.description);
    end if;
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      return 'pending';
    end if;
    f.wallet_id := v_wallets[1];
    update public.money_feed set wallet_id = f.wallet_id where id = f.id;
  end if;

  -- 振替の組み合わせは Zaim の明細どうしだけ（カードの利用通知は組にしない。docs/kakei.md §9.6）
  select array_agg(id) into v_pairs from public.money_feed
   where family_id = f.family_id and id <> f.id and status in ('pending', 'confirm') and pair_id is null
     and f.source = 'zaim_mail' and source = 'zaim_mail'
     and direction is not null and direction <> f.direction and amount = f.amount
     and wallet_id is not null and wallet_id <> f.wallet_id
     and abs(occurred_on - f.occurred_on) <= s.pair_days;
  if coalesce(array_length(v_pairs, 1), 0) = 1 then
    select * into g from public.money_feed where id = v_pairs[1] for update;
    if f.direction = 'out' then v_out := f; v_in := g; else v_out := g; v_in := f; end if;
    update public.money_feed set pair_id = g.id where id = f.id;
    update public.money_feed set pair_id = f.id where id = g.id;

    select array_agg(rec.id) into v_cands from public.money_records rec
     where rec.family_id = f.family_id and rec.feed_id is null and rec.month is null
       and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
       and abs(rec.occurred_on - v_out.occurred_on) <= s.manual_days
       and public.money_record_amount(rec.id) = f.amount
       and ((rec.kind = 'transfer' and rec.wallet_id = v_out.wallet_id and rec.to_wallet_id = v_in.wallet_id)
            or (rec.kind = 'expense' and rec.wallet_id = v_out.wallet_id)
            or (rec.kind = 'income' and rec.wallet_id = v_in.wallet_id));
    if v_cands is not null and not (f.skip_manual or g.skip_manual) then
      update public.money_feed set status = 'confirm', candidate_record_ids = v_cands where id in (f.id, g.id);
      return 'confirm';
    end if;

    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id)
    values (f.family_id, 'transfer', v_out.occurred_on, v_out.wallet_id, v_in.wallet_id, '', v_out.id)
    returning id into v_record;
    insert into public.money_items (family_id, record_id, amount) values (f.family_id, v_record, f.amount);
    update public.money_feed set status = 'created', record_id = v_record where id in (f.id, g.id);
    return 'created';
  end if;
  if coalesce(array_length(v_pairs, 1), 0) > 1 then
    update public.money_feed set candidate_record_ids = '{}' where id = f.id;
    return 'pending';
  end if;

  -- 注文メールの明細は、取り込みのルール・自動の記録との照合を使わない（品目つきで記録するため。docs/kakei.md §9.10）
  select * into r from public.money_feed_rules fr
   where fr.family_id = f.family_id and f.amazon_order_id is null
     and (fr.wallet_id is null or fr.wallet_id = f.wallet_id)
     and (fr.direction is null or fr.direction = f.direction)
     and (fr.amount_min is null or f.amount >= fr.amount_min)
     and (fr.amount_max is null or f.amount <= fr.amount_max)
     and case fr.match
           when 'key' then fr.pattern = public.money_feed_key(f.description)
           else fr.pattern = '' or position(normalize(fr.pattern, NFKC) in normalize(f.description, NFKC)) > 0
         end
   order by fr.position, fr.created_at
   limit 1;
  if found then
    update public.money_feed set rule_id = r.id where id = f.id;
    if r.action = 'ignore' then
      update public.money_feed set status = 'ignored' where id = f.id;
      return 'ignored';
    end if;
    if r.action in ('link_recurring', 'adjust_only') then
      select array_agg(rec.id order by abs(rec.occurred_on - f.occurred_on)) into v_cands
        from public.money_records rec
        left join public.money_wallets card on card.id = rec.to_wallet_id
       where rec.family_id = f.family_id and rec.month is not null and rec.feed_id is null
         and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
         and abs(rec.occurred_on - f.occurred_on) <= s.estimate_days
         and case r.action
               when 'link_recurring' then rec.recurring_id = r.recurring_id
                 and (rec.wallet_id = f.wallet_id or rec.to_wallet_id = f.wallet_id)
               else rec.kind = 'transfer' and rec.recurring_id is null and rec.wallet_id = f.wallet_id
                 and card.type = 'card'
             end;
      if r.action = 'adjust_only' and coalesce(array_length(v_cands, 1), 0) > 1 then
        select array_agg(id) into v_cands from unnest(v_cands) as c(id)
         where public.money_record_amount(c.id) = f.amount;
      end if;
      if coalesce(array_length(v_cands, 1), 0) >= 1 and (r.action = 'link_recurring' or array_length(v_cands, 1) = 1) then
        perform public.money_feed_link(f.id, v_cands[1]);
        return 'linked';
      end if;
      if r.action = 'adjust_only' and v_cands is null then
        update public.money_feed set status = 'ignored' where id = f.id;
        return 'ignored';
      end if;
      update public.money_feed set candidate_record_ids = coalesce(v_cands, '{}') where id = f.id;
      return 'pending';
    end if;
  end if;

  if r.id is null and f.amazon_order_id is null then
    select array_agg(rec.id) into v_cands from public.money_records rec
     where rec.family_id = f.family_id and rec.month is not null and rec.feed_id is null
       and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
       and abs(rec.occurred_on - f.occurred_on) <= s.estimate_days
       and public.money_record_amount(rec.id) = f.amount
       and case f.direction
             when 'out' then rec.wallet_id = f.wallet_id and rec.kind in ('expense', 'transfer')
             else (rec.kind = 'income' and rec.wallet_id = f.wallet_id) or (rec.kind = 'transfer' and rec.to_wallet_id = f.wallet_id)
           end;
    if coalesce(array_length(v_cands, 1), 0) = 1 then
      perform public.money_feed_link(f.id, v_cands[1]);
      return 'linked';
    end if;
  end if;

  v_kind := case f.direction when 'out' then 'expense' else 'income' end;
  select array_agg(rec.id) into v_cands from public.money_records rec
   where rec.family_id = f.family_id and rec.feed_id is null and rec.month is null
     and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
     and abs(rec.occurred_on - f.occurred_on) <= s.manual_days
     and public.money_record_amount(rec.id) = f.amount
     and ((rec.kind = v_kind and rec.wallet_id = f.wallet_id)
          or (rec.kind = 'transfer' and f.direction = 'out' and rec.wallet_id = f.wallet_id)
          or (rec.kind = 'transfer' and f.direction = 'in' and rec.to_wallet_id = f.wallet_id));
  if v_cands is not null and not f.skip_manual then
    -- カードの利用通知で、当たった手入力がレシートから入れた記録1つだけ（前後1日）なら、確かめずに結ぶ（docs/kakei.md §9.6.5 の B）
    if f.source = 'card_mail' and array_length(v_cands, 1) = 1
       and exists (select 1 from public.money_records rec
                    where rec.id = v_cands[1] and rec.receipt_store is not null
                      and abs(rec.occurred_on - f.occurred_on) <= 1) then
      update public.money_records set feed_id = coalesce(feed_id, f.id) where id = v_cands[1];
      update public.money_feed set status = 'linked', record_id = v_cands[1], candidate_record_ids = '{}' where id = f.id;
      return 'linked';
    end if;
    update public.money_feed set status = 'confirm', candidate_record_ids = v_cands where id = f.id;
    return 'confirm';
  end if;

  if r.id is not null and r.action in ('record', 'transfer') then
    if r.action = 'record' then
      insert into public.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id)
      values (f.family_id, r.record_kind, f.occurred_on, f.wallet_id, btrim(r.store), f.id)
      returning id into v_record;
      insert into public.money_items (family_id, record_id, amount, category_id)
      values (f.family_id, v_record, f.amount, r.category_id);
    else
      insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id)
      values (f.family_id, 'transfer', f.occurred_on,
              case f.direction when 'out' then f.wallet_id else r.to_wallet_id end,
              case f.direction when 'out' then r.to_wallet_id else f.wallet_id end, '', f.id)
      returning id into v_record;
      insert into public.money_items (family_id, record_id, amount) values (f.family_id, v_record, f.amount);
    end if;
    update public.money_feed set status = 'created', record_id = v_record where id = f.id;
    return 'created';
  end if;

  return 'pending';
end;
$function$;

-- 5. Apps Script との同期（0117 から。注文メールも、注文ごとの明細の状態でラベルを決める） -----------------
--   未確認の明細があれば「未確認」、全部片づけば「済」（明細の無い注文、今までに覚えた注文も「済」）。注文メールは（初めは）ゴミ箱へ移さない

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
     set label = coalesce(nullif(a ->> 'label', ''), m.label),
         trashed_at = case when (a ->> 'trashed')::boolean then coalesce(m.trashed_at, now()) else m.trashed_at end
    from jsonb_array_elements(coalesce(p_applied, '[]'::jsonb)) as a
   where m.family_id = p_family and m.message_id = a ->> 'id';

  update public.money_feed_tokens set last_sync_at = now() where family_id = p_family;

  select coalesce(jsonb_agg(i.id), '[]'::jsonb) into v_missing
    from unnest(coalesce(p_ids, '{}'::text[])) as i (id)
   where not exists (select 1 from public.money_feed_mails m where m.family_id = p_family and m.message_id = i.id);

  with states as (
    select m.message_id, m.label as applied, m.outcome, f.n, f.unreadable, f.open
      from public.money_feed_mails m
      left join lateral (
        select count(*) as n,
               bool_or(x.status = 'unreadable') as unreadable,
               bool_or(x.status in ('pending', 'confirm')) as open
          from public.money_feed x
         where m.outcome in ('feed', 'order') and x.family_id = p_family
           and (x.source_id = m.message_id or x.source_id like m.message_id || '#%')
      ) f on true
     where m.family_id = p_family and m.trashed_at is null
  ), labels as (
    select message_id, applied,
           case
             when outcome in ('feed', 'order') and unreadable then 'unreadable'
             when outcome in ('feed', 'order') and open then 'open'
             when outcome in ('feed', 'order') then 'done'
             when outcome = 'unreadable' then 'unreadable'
             else 'skipped'
           end as label,
           (outcome = 'skipped' or (outcome = 'feed' and n > 0 and not unreadable and not open)) as trash
      from states
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', message_id, 'label', label, 'trash', trash)), '[]'::jsonb)
    into v_changes
    from (select * from labels where label is distinct from applied or trash limit 100) as c;

  return jsonb_build_object('missing', v_missing, 'changes', v_changes);
end;
$function$;

revoke execute on function public.money_feed_mail_sync(uuid, text[], jsonb) from public, anon, authenticated;

-- 6. 切り替えの片づけ ------------------------------------------------------------------

-- 未確認に残る Amazon のカードの利用通知は「記録しない」にする（注文メールの明細と二重になる）。
-- 割り振り（amazon_order_id・amazon_line_ids）も外す（amazon_order_id があるのは注文メールの明細だけにする）
update public.money_feed
   set status = 'ignored', resolved_at = now(), candidate_record_ids = '{}'
 where source = 'card_mail' and status in ('pending', 'confirm', 'unreadable')
   and normalize(coalesce(account_name, ''), NFKC) ~* 'amazon';

update public.money_feed
   set amazon_order_id = null, amazon_line_ids = '{}', amazon_with_adjust = false
 where amazon_order_id is not null or amazon_line_ids <> '{}';

-- 口座の対応: 「三井住友カード（Amazon）」を、前にその口座名で結んでいた出金元に結び直す（0118 で外した。注文メールの明細の出金元）
update public.money_wallets w
   set feed_name = '三井住友カード（Amazon）'
 where w.archived_at is null
   and w.id = (select f.wallet_id from public.money_feed f
                where f.family_id = w.family_id and f.account_name = '三井住友カード（Amazon）' and f.wallet_id is not null
                order by f.received_at desc limit 1)
   and not exists (select 1 from public.money_wallets x
                    where x.family_id = w.family_id and x.feed_name = '三井住友カード（Amazon）');

-- まだ記録していない注文を明細にする（覚えている注文は、取り込みの開始より後のものだけ）。
-- 利用通知に割り振って記録した注文と、同じ品名の品目がある記録（注文日より後）がある注文は作らない
select public.money_amazon_order_feed(
         o.id,
         (select m.received_at from public.money_feed_mails m where m.family_id = o.family_id and m.message_id = o.source_id),
         null)
  from public.money_amazon_orders o
 where not exists (select 1 from public.money_amazon_lines l where l.order_id = o.id and l.feed_id is not null)
   and not exists (select 1 from public.money_amazon_lines l
                     join public.money_items i on i.family_id = l.family_id and i.receipt_name = l.receipt_name
                     join public.money_records r on r.id = i.record_id
                    where l.order_id = o.id and r.occurred_on >= o.ordered_on)
 order by o.ordered_on, o.created_at;
