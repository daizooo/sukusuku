-- かぞく手帳: カード会社の利用通知メールを取り込む（docs/kakei.md §9.6）
--
-- 三井住友カード・楽天カードの利用通知メールを、Zaim の入出金と同じ明細（money_feed）に入れる。
--   - source に 'card_mail' を足す（1. は制約を作り直すので、SQL Editor で流す）
--   - store_hint: 利用先に当たるお店の候補（Edge Function が入れる。覚えた利用先 → ローマ字 → AI）。未確認の「記録にする」に入れておく
--   - money_feed_receive: source・store_hint を受け取る（同じメールかは source ごとに見る）
--   - money_feed_process: 振替の組み合わせは Zaim の明細どうしだけ（カードの利用が銀行の入金と組にならないように）
--   - それ以外（覚えたルールで自動の記録・手入力との確認・自動の記録との照合）は Zaim の明細と同じ
--   - money_feed は family_sync の対象のまま（列を足すだけ）
--
-- 適用の順序: 2.〜4. を先に適用し（MCP）、1. を SQL Editor で流してから、Edge Function と Apps Script を出す。
--   1. の前にカードのメールが届いても、受け取りに失敗するだけで、Apps Script が次の回にまた送る

-- 1. source に card_mail を足す（制約を作り直す。削除を含むので SQL Editor で流す）
alter table public.money_feed drop constraint if exists money_feed_source_check;
alter table public.money_feed
  add constraint money_feed_source_check check (source in ('zaim_mail', 'card_mail'));

-- 2. 利用先に当たるお店の候補
alter table public.money_feed add column if not exists store_hint text;

-- 3. money_feed_receive（0091 に source・store_hint を足した）
create or replace function public.money_feed_receive(p_family uuid, p_feed jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_status text;
  v_start timestamptz;
  v_source text := coalesce(p_feed ->> 'source', 'zaim_mail');
begin
  select start_at into v_start from public.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_feed ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into public.money_feed (family_id, source, source_id, received_at, to_email, subject, raw_line,
                                 direction, occurred_on, amount, account_name, description, store_hint, status)
  values (p_family, v_source, p_feed ->> 'source_id', (p_feed ->> 'received_at')::timestamptz,
          nullif(p_feed ->> 'to_email', ''), coalesce(p_feed ->> 'subject', ''), coalesce(p_feed ->> 'raw_line', ''),
          p_feed ->> 'direction', (p_feed ->> 'occurred_on')::date, (p_feed ->> 'amount')::integer,
          p_feed ->> 'account_name', coalesce(p_feed ->> 'description', ''), nullif(btrim(p_feed ->> 'store_hint'), ''),
          case when p_feed ->> 'direction' is null then 'unreadable' else 'pending' end)
  on conflict (family_id, source, source_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id, status into v_id, v_status from public.money_feed
     where family_id = p_family and source = v_source and source_id = p_feed ->> 'source_id';
    return jsonb_build_object('id', v_id, 'status', v_status, 'duplicate', true);
  end if;

  v_status := public.money_feed_process(v_id);
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$function$;

-- 4. money_feed_process（0093 の、振替の組み合わせを Zaim の明細どうしに限った）
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

  select * into r from public.money_feed_rules fr
   where fr.family_id = f.family_id
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

  if r.id is null then
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
