-- かぞく手帳: 取り込んだ明細を「記録にする」ときも、お店を登録できるようにする（docs/kakei.md §9.6.3）
--
-- 未確認の「記録にする」のお店を、記録の入力と同じお店の選択（登録したお店から選ぶ／打った名前を
-- 「この記録だけに使う」か「お店に登録して使う」）にした。登録を選んだら、save_money_record と同じく
-- お店の設定に入れる（使わなくしていれば、また使えるようにする）。
--   - money_feed_resolve の record の動きに、引数 register_store を足した。ほかは 0092 と同じ。削除は含まない

create or replace function public.money_feed_resolve(p_feed uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- 「お店に登録して使う」を選んだときだけ、お店の設定に登録する（save_money_record と同じ。docs/kakei.md §3.5）
    if coalesce((p_args ->> 'register_store')::boolean, false) and btrim(coalesce(p_args ->> 'store', '')) <> '' then
      insert into public.money_stores (family_id, name)
      values (v_family, btrim(p_args ->> 'store'))
      on conflict (family_id, name) do update set archived_at = null;
    end if;
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
$function$;
