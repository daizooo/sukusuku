-- かぞく手帳: 取り込んだ明細を、画面から片づける・覚える（docs/kakei.md §9.5.5・§9.5.6.1）
--
--   money_feed_resolve(明細, 動き, 引数)  1件を片づける。家族の人が呼ぶ（自分の家族の明細だけ）
--     wallet    { wallet_id, remember }        口座を選ぶ。remember なら出金元に Zaim の口座名を入れ、次から自動で決める。選んだあと突き合わせ直す
--     link      { record_id, learn }           既にある記録と結ぶ。見込みの記録なら額を明細の額にして確定。振替の組なら2つとも結ぶ
--     replace   { record_id }                  手入力の支出・収入を、振替の組の振替に置き換える（記録を消さずに直す。品目が1つの記録だけ）
--     separate  {}                             手入力とは別の取引にする。振替の組なら振替を作り、単独なら「未確認」に戻す
--     record    { kind, category_id, store, learn }  支出／収入の記録を作る
--     transfer  { to_wallet_id, learn }        振替を作る（出金なら 口座 → 相手、入金なら 相手 → 口座）
--     ignore    { learn }                      記録しない
--   learn: 「次から同じ内容は自動で」。口座・向き・内容の決まった部分を条件にした取り込みのルールを、一覧のいちばん下に足す
--
--   money_feed_reprocess()  口座の対応・ルールを直したあとに、家族の「未確認」を突き合わせ直す
--
-- 行を消す文は無い（置き換えも記録を直すだけ）。

-- 「別の取引」を選んだ明細は、突き合わせ直しても手入力との確認に戻さない
alter table public.money_feed add column if not exists skip_manual boolean not null default false;
comment on column public.money_feed.skip_manual is '手入力との確認で「別の取引」を選んだ。突き合わせ直しても確認に戻さない。§9.5.5';

-- money_feed_process（0091）に skip_manual を足す
create or replace function public.money_feed_process(p_feed uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
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

  -- 1. 口座を決める（§9.5.3）
  if f.wallet_id is null then
    -- 宛先と口座名
    select array_agg(id) into v_wallets from public.money_wallets
     where family_id = f.family_id and archived_at is null and feed_name = f.account_name
       and (holder_zaim_email is null or f.to_email is null or lower(holder_zaim_email) = lower(f.to_email));
    -- 2つ以上なら、依頼人名と名義
    if coalesce(array_length(v_wallets, 1), 0) > 1 then
      v_requester := public.money_feed_requester(f.description);
      if v_requester is not null then
        select array_agg(id) into v_wallets from public.money_wallets
         where id = any (v_wallets)
           and regexp_replace(normalize(coalesce(holder_kana, ''), NFKC), '\s+', ' ', 'g') = v_requester;
      end if;
    end if;
    -- 覚えたルールで口座が決まっているもの
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      select array_agg(distinct fr.wallet_id) into v_wallets from public.money_feed_rules fr
       join public.money_wallets w on w.id = fr.wallet_id
       where fr.family_id = f.family_id and fr.match = 'key' and fr.wallet_id is not null
         and w.feed_name = f.account_name
         and (fr.direction is null or fr.direction = f.direction)
         and fr.pattern = public.money_feed_key(f.description);
    end if;
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      return 'pending';  -- 口座を選んでもらう
    end if;
    f.wallet_id := v_wallets[1];
    update public.money_feed set wallet_id = f.wallet_id where id = f.id;
  end if;

  -- 2. 振替の組み合わせ（§9.5.4 の1）。先に届いた片方が手入力との確認に入っていても組む
  select array_agg(id) into v_pairs from public.money_feed
   where family_id = f.family_id and id <> f.id and status in ('pending', 'confirm') and pair_id is null
     and direction is not null and direction <> f.direction and amount = f.amount
     and wallet_id is not null and wallet_id <> f.wallet_id
     and abs(occurred_on - f.occurred_on) <= s.pair_days;
  if coalesce(array_length(v_pairs, 1), 0) = 1 then
    select * into g from public.money_feed where id = v_pairs[1] for update;
    if f.direction = 'out' then v_out := f; v_in := g; else v_out := g; v_in := f; end if;
    update public.money_feed set pair_id = g.id where id = f.id;
    update public.money_feed set pair_id = f.id where id = g.id;

    -- 手入力との確認（§9.5.5）: 同じ組の振替、出金側の支出、入金側の収入
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
    return 'pending';  -- 相手が2つ以上: 確認に回す
  end if;

  -- 3. 取り込みのルール（§9.5.6）
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
      -- カード代金が2枚以上: 額が同じもの
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

  -- 4. 自動で作った記録との照合（§9.5.4 の3）: 額が同じものが1つだけ
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

  -- 5. 手入力との確認（§9.5.4 の4）
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

  -- ルールで作る動き（手入力が無いと分かってから作る）
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

  -- 6. 未確認
  return 'pending';
end;
$$;

-- 覚えたルールを足す（同じ条件の覚えたルールがあれば置き換える）
create or replace function public.money_feed_learn(
  p_feed public.money_feed,
  p_action text,
  p_record_kind text default null,
  p_category uuid default null,
  p_store text default '',
  p_to_wallet uuid default null,
  p_recurring uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := public.money_feed_key(p_feed.description);
  v_existing uuid;
begin
  if p_feed.wallet_id is null then
    return;
  end if;
  select id into v_existing from public.money_feed_rules
   where family_id = p_feed.family_id and learned and match = 'key' and pattern = v_key
     and wallet_id = p_feed.wallet_id and direction = p_feed.direction
   limit 1;
  if v_existing is not null then
    update public.money_feed_rules
       set action = p_action, record_kind = p_record_kind, category_id = p_category, store = coalesce(p_store, ''),
           to_wallet_id = p_to_wallet, recurring_id = p_recurring
     where id = v_existing;
    return;
  end if;
  insert into public.money_feed_rules (family_id, position, name, wallet_id, direction, match, pattern,
                                       action, record_kind, category_id, store, to_wallet_id, recurring_id, learned)
  values (p_feed.family_id,
          coalesce((select max(position) + 1 from public.money_feed_rules where family_id = p_feed.family_id), 0),
          v_key, p_feed.wallet_id, p_feed.direction, 'key', v_key,
          p_action, p_record_kind, p_category, coalesce(p_store, ''), p_to_wallet, p_recurring, true);
end;
$$;

revoke execute on function public.money_feed_learn(public.money_feed, text, text, uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.money_feed_resolve(p_feed uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.money_feed;
  g public.money_feed;
  rec public.money_records;
  v_family uuid := public.current_family_id();
  v_out public.money_feed;
  v_in public.money_feed;
  v_record uuid;
  v_wallet uuid;
  v_learn boolean := coalesce((p_args ->> 'learn')::boolean, false);
  v_status text;
begin
  select * into f from public.money_feed where id = p_feed for update;
  if not found or f.family_id is distinct from v_family then
    raise exception 'not found';
  end if;
  if f.pair_id is not null then
    select * into g from public.money_feed where id = f.pair_id for update;
    if f.direction = 'out' then v_out := f; v_in := g; else v_out := g; v_in := f; end if;
  end if;

  if p_action = 'wallet' then
    v_wallet := (p_args ->> 'wallet_id')::uuid;
    if not exists (select 1 from public.money_wallets where id = v_wallet and family_id = v_family) then
      raise exception 'wallet not found';
    end if;
    if coalesce((p_args ->> 'remember')::boolean, false) and f.account_name is not null then
      -- 同じ口座名を持つほかの出金元からは外す（宛先が同じか、どちらかが未設定のもの）
      update public.money_wallets set feed_name = null
       where family_id = v_family and id <> v_wallet and feed_name = f.account_name
         and (holder_zaim_email is null or f.to_email is null or lower(holder_zaim_email) = lower(f.to_email));
      update public.money_wallets
         set feed_name = f.account_name,
             holder_zaim_email = coalesce(holder_zaim_email, f.to_email)
       where id = v_wallet;
    end if;
    update public.money_feed set wallet_id = v_wallet, status = 'pending', candidate_record_ids = '{}' where id = f.id;
    return public.money_feed_process(f.id);
  end if;

  if f.direction is null or f.wallet_id is null then
    if p_action <> 'ignore' then
      raise exception 'wallet required';
    end if;
  end if;

  if p_action = 'link' then
    select * into rec from public.money_records where id = (p_args ->> 'record_id')::uuid and family_id = v_family;
    if not found then
      raise exception 'record not found';
    end if;
    if rec.is_estimate then
      perform public.money_feed_link(f.id, rec.id);
    else
      update public.money_records set feed_id = coalesce(feed_id, f.id) where id = rec.id;
      update public.money_feed set status = 'linked', record_id = rec.id, candidate_record_ids = '{}' where id = f.id;
    end if;
    if g.id is not null then
      if rec.kind = 'transfer' then
        update public.money_feed set status = 'linked', record_id = rec.id, candidate_record_ids = '{}' where id = g.id;
      else
        -- 振替を支出・収入で入れていた記録を残す: もう片方は単独の明細として突き合わせ直す
        update public.money_feed set pair_id = null where id in (f.id, g.id);
        update public.money_feed set status = 'pending', candidate_record_ids = '{}' where id = g.id;
        perform public.money_feed_process(g.id);
      end if;
    end if;
    if v_learn then
      if rec.recurring_id is not null then
        perform public.money_feed_learn(f, 'link_recurring', p_recurring => rec.recurring_id);
      elsif rec.month is not null and rec.kind = 'transfer' then
        perform public.money_feed_learn(f, 'adjust_only');
      end if;
    end if;
    v_status := 'linked';

  elsif p_action = 'replace' then
    if g.id is null then
      raise exception 'pair required';
    end if;
    select * into rec from public.money_records where id = (p_args ->> 'record_id')::uuid and family_id = v_family;
    if not found or (select count(*) from public.money_items where record_id = rec.id) <> 1 then
      raise exception 'record not replaceable';
    end if;
    update public.money_records
       set kind = 'transfer', occurred_on = v_out.occurred_on, wallet_id = v_out.wallet_id, to_wallet_id = v_in.wallet_id,
           store = '', feed_id = v_out.id, is_estimate = false
     where id = rec.id;
    update public.money_items set amount = f.amount, category_id = null, category_name = '' where record_id = rec.id;
    update public.money_feed set status = 'linked', record_id = rec.id, candidate_record_ids = '{}' where id in (f.id, g.id);
    v_status := 'linked';

  elsif p_action = 'separate' then
    if g.id is not null then
      insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id, created_by)
      values (v_family, 'transfer', v_out.occurred_on, v_out.wallet_id, v_in.wallet_id, '', v_out.id, auth.uid())
      returning id into v_record;
      insert into public.money_items (family_id, record_id, amount) values (v_family, v_record, f.amount);
      update public.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id in (f.id, g.id);
      v_status := 'created';
    else
      update public.money_feed set status = 'pending', candidate_record_ids = '{}', skip_manual = true where id = f.id;
      return 'pending';
    end if;

  elsif p_action = 'record' then
    insert into public.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id, created_by)
    values (v_family, case f.direction when 'out' then 'expense' else 'income' end, f.occurred_on, f.wallet_id,
            btrim(coalesce(p_args ->> 'store', '')), f.id, auth.uid())
    returning id into v_record;
    insert into public.money_items (family_id, record_id, amount, category_id)
    values (v_family, v_record, f.amount, (p_args ->> 'category_id')::uuid);
    update public.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id = f.id;
    if v_learn then
      perform public.money_feed_learn(f, 'record',
        p_record_kind => case f.direction when 'out' then 'expense' else 'income' end,
        p_category => (p_args ->> 'category_id')::uuid, p_store => btrim(coalesce(p_args ->> 'store', '')));
    end if;
    v_status := 'created';

  elsif p_action = 'transfer' then
    v_wallet := (p_args ->> 'to_wallet_id')::uuid;
    if not exists (select 1 from public.money_wallets where id = v_wallet and family_id = v_family) or v_wallet = f.wallet_id then
      raise exception 'wallet not found';
    end if;
    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id, created_by)
    values (v_family, 'transfer', f.occurred_on,
            case f.direction when 'out' then f.wallet_id else v_wallet end,
            case f.direction when 'out' then v_wallet else f.wallet_id end, '', f.id, auth.uid())
    returning id into v_record;
    insert into public.money_items (family_id, record_id, amount) values (v_family, v_record, f.amount);
    update public.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id = f.id;
    if v_learn then
      perform public.money_feed_learn(f, 'transfer', p_to_wallet => v_wallet);
    end if;
    v_status := 'created';

  elsif p_action = 'ignore' then
    update public.money_feed set status = 'ignored', candidate_record_ids = '{}' where id = f.id;
    if v_learn and f.direction is not null then
      perform public.money_feed_learn(f, 'ignore');
    end if;
    v_status := 'ignored';

  else
    raise exception 'unknown action %', p_action;
  end if;

  update public.money_feed set resolved_by = auth.uid(), resolved_at = now() where id in (f.id, g.id);
  return v_status;
end;
$$;

revoke execute on function public.money_feed_resolve(uuid, text, jsonb) from public, anon;
grant execute on function public.money_feed_resolve(uuid, text, jsonb) to authenticated;

-- 口座の対応・ルールを直したあと、家族の「未確認」を突き合わせ直す（届いた順に）
create or replace function public.money_feed_reprocess()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid := public.current_family_id();
  v_id uuid;
  v_count integer := 0;
begin
  if v_family is null then
    raise exception 'not in a family';
  end if;
  for v_id in
    select id from public.money_feed
     where family_id = v_family and status = 'pending' and pair_id is null
     order by received_at
  loop
    if public.money_feed_process(v_id) <> 'pending' then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.money_feed_reprocess() from public, anon;
grant execute on function public.money_feed_reprocess() to authenticated;
