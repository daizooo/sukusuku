-- かぞく手帳: 固定収入・固定費のルールに有効期間を足す（docs/kakei.md §3.3）
--
-- 育休・復帰・時短のように、期間で額や有無が変わる収入・支出を、ルールを消さずに登録できるようにする
-- （例: 育児休業給付金 〜2027/8、時短後の給与 2027/9〜）。
--   - money_recurring に start_month・end_month（その月の1日。null は無期限）を足す。
--     期間は「どの月の分か」（記録の month。入金・引き落としのある月）で決める
--   - 自動で記録を作る make_money_recurring_records は、期間の外の月を作らない
--   - 見込みの額を出す money_recurring_estimate は、期間の始まりより前の記録を使わない
--     （時短後の給与の見込みが、出産前の給与の記録から出ないように）。このルールが作った記録は期間に関係なく使う
--   - それ以外は 0089 と同じ。削除は含まない
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは新しい列を読まないだけで、期間の無いルールは今までどおり動く

alter table public.money_recurring
  add column if not exists start_month date,
  add column if not exists end_month date;

alter table public.money_recurring
  add constraint money_recurring_period_check check (
    (start_month is null or extract(day from start_month) = 1)
    and (end_month is null or extract(day from end_month) = 1)
    and (start_month is null or end_month is null or start_month <= end_month)
  );

-- 1. money_recurring_estimate（0089 に、期間の始まりより前の記録を使わない条件を足した）
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
       and (p_rule.start_month is null or record.occurred_on >= p_rule.start_month or record.recurring_id = p_rule.id)
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

-- 2. make_money_recurring_records（0089 に、期間の外の月を作らない条件を足した）
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
      -- 期間の外の月は作らない（docs/kakei.md §3.3）。
      continue when v_rule.start_month is not null and v_month < v_rule.start_month;
      continue when v_rule.end_month is not null and v_month > v_rule.end_month;
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
