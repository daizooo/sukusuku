-- かぞく手帳: 毎月の記録のルールの日取りに「第◯◯曜日」を足す（docs/kakei.md §0.3・§3.3）
--
-- 賞与などの振込日を、「毎月◯日」だけでなく「第2金曜日」「最終金曜日」のように決められるようにする。
--   - money_recurring に week_of_month（1〜4＝第1〜第4、5＝最終）と weekday（0＝日〜6＝土）を足す。両方入れるか、両方 null
--   - 入っているときは day を使わない（day は not null のままなので、1 を入れておく）
--   - 日付は money_rule_date が出す。休日のときの動かし方（holiday）は、そのあとに今までどおり当てる
--   - 日付を出していた2つの関数（自動で記録を作る make_money_recurring_records と、見込みの額を出す
--     money_recurring_estimate）を、money_rule_date を使うように作り直す（それ以外は 0080・0066 と同じ。削除は含まない）
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは新しい列を読まないだけで、day のルールは今までどおり動く（曜日のルールは古いアプリでは作れない）

alter table public.money_recurring
  add column if not exists week_of_month smallint check (week_of_month is null or week_of_month between 1 and 5),
  add column if not exists weekday smallint check (weekday is null or weekday between 0 and 6);

alter table public.money_recurring
  add constraint money_recurring_weekday_pair_check check ((week_of_month is null) = (weekday is null));

comment on column public.money_recurring.week_of_month is
  '第何週か（1〜4＝第1〜第4、5＝最終）。weekday とセット。入っているときは day を使わない。docs/kakei.md §0.3。';
comment on column public.money_recurring.weekday is
  '曜日（0＝日〜6＝土）。week_of_month とセット。';

-- ============================================================
-- 1. 月と日取りから、その月の日付を出す
-- ============================================================
create or replace function public.money_rule_date(p_month date, p_day integer, p_week integer, p_weekday integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_week is null or p_weekday is null then public.money_day_of_month(p_month, p_day)
    -- 最終◯曜日: 月末から、その曜日まで戻る
    when p_week >= 5 then
      (bounds.last_day - ((extract(dow from bounds.last_day)::integer - p_weekday + 7) % 7))::date
    -- 第n◯曜日: 月初から、最初のその曜日まで進み、(n-1)週ぶん足す（第4までは月をまたがない）
    else
      (bounds.first_day + ((p_weekday - extract(dow from bounds.first_day)::integer + 7) % 7) + (p_week - 1) * 7)::date
  end
  from (
    select date_trunc('month', p_month)::date as first_day,
           (date_trunc('month', p_month) + interval '1 month - 1 day')::date as last_day
  ) as bounds;
$$;

comment on function public.money_rule_date(date, integer, integer, integer) is
  '毎月の記録のルールの、その月の日付。week_of_month・weekday があれば「第n◯曜日／最終◯曜日」、無ければ day（末日は31）。docs/kakei.md §0.3。';

-- ============================================================
-- 2. 見込みの額（0066 と同じ。前年同月の日付の出し方だけ money_rule_date にした）
-- ============================================================
create or replace function public.money_recurring_estimate(p_rule public.money_recurring, p_month date, p_on date)
returns integer
language plpgsql
stable
set search_path = ''
as $$
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
       and (case
              when p_rule.category_id is not null then item.category_id = p_rule.category_id
              when p_rule.special_item_id is not null then item.special_item_id = p_rule.special_item_id
              else true
            end)
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
$$;

-- ============================================================
-- 3. 自動で記録を作る（0080 と同じ。ルールの日付の出し方だけ money_rule_date にした）
-- ============================================================
create or replace function public.make_money_recurring_records(
  p_today date default (now() at time zone 'Asia/Tokyo')::date
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
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
       and (rule.kind = 'transfer' or rule.category_id is not null or rule.special_item_id is not null)
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
        insert into public.money_items (family_id, record_id, amount, category_id, special_item_id, name)
        values (v_rule.family_id, v_record, v_amount,
                case when v_rule.kind <> 'transfer' then v_rule.category_id end,
                case when v_rule.kind <> 'transfer' then v_rule.special_item_id end,
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
$$;

comment on function public.make_money_recurring_records(date) is
  '毎月の記録のルールとカード代金から、その日までに来た記録を作る（pg_cron から毎朝）。ルールの日取りは day か「第n◯曜日」。docs/kakei.md §3.3・§3.4・§0.3。';

revoke execute on function public.make_money_recurring_records(date) from public, anon, authenticated;
