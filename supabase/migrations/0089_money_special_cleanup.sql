-- かぞく手帳: 家計の後片付け（docs/kakei.md §0.6 の 2b）
--
-- 特別費はカテゴリ（大分類「特別費」）に収納した（0086。docs/kakei.md §0.2）。別枠の仕組みを消す。
--   - 列: money_items.special_item_id・special_plan_id、money_recurring.special_item_id
--   - 表: special_plans、special_items、money_settings（0087。使わないことにした）
--   - 関数: save_money_record・make_money_recurring_records・money_recurring_estimate・money_bootstrap から外す
--
-- 削除（drop）を含むので、Supabase の MCP ではなく SQL Editor で流す（CLAUDE.md）。
-- 適用の順序: アプリ（PWA・mobile。この列・表を読まない版）を出し、
--            設定の「固定費」「固定収入」に特別費・賞与の予定を登録し終えてから。
--
-- 1. 関数から外す（列・表を消す前に。消してからだと関数が壊れる）
-- 2. 列を消す（それに付く制約・索引も一緒に消える）
-- 3. 表を消す（変更台帳 family_sync に付けた trigger も一緒に消える）

-- 1-1. save_money_record（0069 から special_item_id・special_plan_id を外した）
create or replace function public.save_money_record(p_record jsonb, p_items jsonb)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_family uuid := public.current_family_id();
  v_id uuid := nullif(p_record ->> 'id', '')::uuid;
  v_store text := btrim(coalesce(p_record ->> 'store', ''));
  v_estimate boolean := coalesce((p_record ->> 'is_estimate')::boolean, false);
  v_register boolean := coalesce((p_record ->> 'register_store')::boolean, false);
begin
  if v_family is null then
    raise exception 'no family';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a record needs at least one item';
  end if;

  if v_id is null then
    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, created_by, is_estimate)
    values (
      v_family,
      p_record ->> 'kind',
      (p_record ->> 'occurred_on')::date,
      nullif(p_record ->> 'wallet_id', '')::uuid,
      nullif(p_record ->> 'to_wallet_id', '')::uuid,
      coalesce(p_record ->> 'store', ''),
      (select auth.uid()),
      v_estimate
    )
    returning id into v_id;
  else
    update public.money_records
      set kind = p_record ->> 'kind',
          occurred_on = (p_record ->> 'occurred_on')::date,
          wallet_id = nullif(p_record ->> 'wallet_id', '')::uuid,
          to_wallet_id = nullif(p_record ->> 'to_wallet_id', '')::uuid,
          store = coalesce(p_record ->> 'store', ''),
          is_estimate = v_estimate
      where id = v_id;
    if not found then
      raise exception 'record not found';
    end if;
    delete from public.money_items where record_id = v_id;
  end if;

  -- 「お店に登録して使う」を選んだときだけ、お店の設定に登録する（使わなくしていれば、また使えるようにする）。
  if v_store <> '' and v_register then
    insert into public.money_stores (family_id, name)
    values (v_family, v_store)
    on conflict (family_id, name) do update set archived_at = null;
  end if;

  insert into public.money_items (
    family_id, record_id, amount, category_id,
    quantity, unit_price, name, memo, position
  )
  select
    v_family,
    v_id,
    (item ->> 'amount')::integer,
    nullif(item ->> 'category_id', '')::uuid,
    coalesce((item ->> 'quantity')::integer, 1),
    (item ->> 'unit_price')::integer,
    coalesce(item ->> 'name', ''),
    coalesce(item ->> 'memo', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as entries (item, ordinality);

  return v_id;
end;
$function$;

-- 1-2. money_recurring_estimate（0088 から special_item_id の分岐を外した）
create or replace function public.money_recurring_estimate(p_rule public.money_recurring, p_month date, p_on date)
returns integer
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_last_year date := public.money_shift_business_day(
    public.money_rule_date((p_month - interval '1 year')::date, p_rule.day, p_rule.week_of_month, p_rule.weekday), p_rule.holiday);
  v_amount integer;
begin
  with matched as (
    select record.occurred_on, sum(item.amount)::integer as amount
      from public.money_records as record
      join public.money_items as item on item.record_id = record.id
     where record.family_id = p_rule.family_id
       and record.kind = p_rule.kind
       and not record.is_estimate
       and record.wallet_id = p_rule.wallet_id
       and (p_rule.kind <> 'transfer' or record.to_wallet_id = p_rule.to_wallet_id)
       and btrim(record.store) = btrim(p_rule.store)
       and (p_rule.category_id is null or item.category_id = p_rule.category_id)
       and record.occurred_on >= least(v_last_year - 10, (p_on - interval '1 year')::date)
       and record.occurred_on < p_on
     group by record.id, record.occurred_on
  )
  select coalesce(
    (select amount from matched
      where abs(occurred_on - v_last_year) <= 10
      order by abs(occurred_on - v_last_year), occurred_on desc
      limit 1),
    (select round(avg(amount))::integer from (
       select amount from matched
        where occurred_on >= (p_on - interval '1 year')::date
        order by occurred_on desc
        limit 3) as recent)
  ) into v_amount;
  return coalesce(v_amount, p_rule.amount);
end;
$function$;

-- 1-3. make_money_recurring_records（0088 から special_item_id を外した）
create or replace function public.make_money_recurring_records(p_today date default ((now() at time zone 'Asia/Tokyo'))::date)
returns integer
language plpgsql
set search_path to ''
as $function$
declare
  c_catch_up constant integer := 7;
  v_rule public.money_recurring;
  v_card public.money_wallets;
  v_month date;
  v_on date;
  v_amount integer;
  v_estimate boolean;
  v_record uuid;
  v_pay date;
  v_close date;
  v_prev_close date;
  v_count integer := 0;
begin
  -- 固定費・給料など
  for v_rule in
    select rule.* from public.money_recurring as rule
     where rule.archived_at is null
       and rule.wallet_id is not null
       and (rule.kind <> 'transfer' or rule.to_wallet_id is not null)
       and (rule.kind = 'transfer' or rule.category_id is not null)
     order by rule.family_id, rule.position
       for update
  loop
    for v_month in
      select generate_series(date_trunc('month', p_today) - interval '1 month',
                             date_trunc('month', p_today) + interval '1 month',
                             interval '1 month')::date
    loop
      continue when v_rule.made_through is not null and v_month <= v_rule.made_through;
      continue when v_rule.months is not null and not (extract(month from v_month)::smallint = any (v_rule.months));
      v_on := public.money_shift_business_day(
        public.money_rule_date(v_month, v_rule.day, v_rule.week_of_month, v_rule.weekday), v_rule.holiday);
      continue when v_on > p_today or v_on < p_today - c_catch_up;
      -- ルールを作る前に来た分は作らない（人がもう入れているはず）。
      continue when v_on < (v_rule.created_at at time zone 'Asia/Tokyo')::date;

      v_estimate := v_rule.amount_mode = 'estimate';
      v_amount := case when v_estimate then public.money_recurring_estimate(v_rule, v_month, v_on) else v_rule.amount end;

      insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store,
                                        is_estimate, recurring_id, month)
      values (v_rule.family_id, v_rule.kind, v_on, v_rule.wallet_id,
              case when v_rule.kind = 'transfer' then v_rule.to_wallet_id end,
              case when v_rule.kind = 'transfer' then '' else btrim(v_rule.store) end,
              v_estimate, v_rule.id, v_month)
      on conflict (recurring_id, month) where recurring_id is not null do nothing
      returning id into v_record;

      if v_record is not null then
        insert into public.money_items (family_id, record_id, amount, category_id, name)
        values (v_rule.family_id, v_record, v_amount,
                case when v_rule.kind <> 'transfer' then v_rule.category_id end,
                btrim(v_rule.name));
        v_count := v_count + 1;
      end if;

      update public.money_recurring set made_through = v_month where id = v_rule.id;
      v_rule.made_through := v_month;
    end loop;
  end loop;

  -- カード代金（引き落とし口座 → カードの振替）
  for v_card in
    select wallet.* from public.money_wallets as wallet
     where wallet.type = 'card'
       and wallet.archived_at is null
       and wallet.close_day is not null
       and wallet.pay_day is not null
       and wallet.pay_wallet_id is not null
     order by wallet.family_id, wallet.position
       for update
  loop
    for v_month in
      select generate_series(date_trunc('month', p_today) - interval '1 month',
                             date_trunc('month', p_today) + interval '1 month',
                             interval '1 month')::date
    loop
      continue when v_card.card_made_through is not null and v_month <= v_card.card_made_through;
      v_pay := public.money_day_of_month(v_month, v_card.pay_day);
      v_on := public.money_shift_business_day(v_pay, 'next');
      continue when v_on > p_today or v_on < p_today - c_catch_up;

      -- 引き落とし日の前の、いちばん近い締め日までの1か月分（前回の締め日の翌日〜今回の締め日）
      if v_card.pay_month_offset is not null then
        -- 引き落とし月を「締め日の月 + n か月」と決めているカード（月末締めの翌々月払いなど）
        v_close := public.money_day_of_month((v_month - make_interval(months => v_card.pay_month_offset))::date, v_card.close_day);
      else
        v_close := public.money_day_of_month(v_month, v_card.close_day);
        if v_close >= v_pay then
          v_close := public.money_day_of_month((v_month - interval '1 month')::date, v_card.close_day);
        end if;
      end if;
      v_prev_close := public.money_day_of_month((date_trunc('month', v_close) - interval '1 month')::date, v_card.close_day);

      select coalesce(sum(case when record.kind = 'income' then -item.amount else item.amount end), 0)::integer
        into v_amount
        from public.money_records as record
        join public.money_items as item on item.record_id = record.id
       where record.family_id = v_card.family_id
         and record.wallet_id = v_card.id
         and record.kind in ('expense', 'income')
         and record.occurred_on > v_prev_close
         and record.occurred_on <= v_close;

      if v_amount > 0 then
        insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store,
                                          is_estimate, month)
        values (v_card.family_id, 'transfer', v_on, v_card.pay_wallet_id, v_card.id, '', true, v_month)
        returning id into v_record;
        insert into public.money_items (family_id, record_id, amount)
        values (v_card.family_id, v_record, v_amount);
        v_count := v_count + 1;
      end if;

      update public.money_wallets set card_made_through = v_month where id = v_card.id;
      v_card.card_made_through := v_month;
    end loop;
  end loop;

  return v_count;
end;
$function$;

-- 1-4. money_bootstrap（0087 から special_items・special_plans・settings を外した）
create or replace function public.money_bootstrap(p_family_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                     from public.money_categories c where c.family_id = p_family_id),
    'budgets', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
                  from public.money_budgets b where b.family_id = p_family_id),
    'wallets', (select coalesce(jsonb_agg(to_jsonb(w) order by w.position), '[]'::jsonb)
                  from public.money_wallets w where w.family_id = p_family_id),
    'stores', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
                 from public.money_stores s where s.family_id = p_family_id),
    'recurring', (select coalesce(jsonb_agg(to_jsonb(r) order by r.position), '[]'::jsonb)
                    from public.money_recurring r where r.family_id = p_family_id),
    'balances', (select coalesce(jsonb_agg(to_jsonb(wb)), '[]'::jsonb)
                   from public.money_wallet_balances wb where wb.family_id = p_family_id),
    'records', (
      select coalesce(jsonb_agg(
               to_jsonb(rec) || jsonb_build_object('money_items', coalesce(
                 (select jsonb_agg(to_jsonb(it) order by it.position)
                    from public.money_items it where it.record_id = rec.id),
                 '[]'::jsonb))
               order by rec.occurred_on, rec.created_at, rec.id), '[]'::jsonb)
        from public.money_records rec where rec.family_id = p_family_id),
    'securities', (select coalesce(jsonb_agg(to_jsonb(se) order by se.position), '[]'::jsonb)
                     from public.money_securities se where se.family_id = p_family_id),
    'holdings', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
                   from public.money_holdings h where h.family_id = p_family_id),
    'latest_values', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
                        from public.money_latest_holding_values(p_family_id) v)
  );
$function$;

-- 2. 列を消す（money_items_category_or_special_check・money_recurring_category_or_special_check・外部キー・索引も一緒に消える）
alter table public.money_items drop column if exists special_plan_id;
alter table public.money_items drop column if exists special_item_id;
alter table public.money_recurring drop column if exists special_item_id;

-- 3. 表を消す（special_plans は special_items を参照するので先に）
drop table if exists public.special_plans;
drop table if exists public.special_items;
drop table if exists public.money_settings;
