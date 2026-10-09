-- かぞく手帳: カードの引き落とし月を「締め日の月 + n か月」で決められるようにする（docs/kakei.md §3.4）
--
-- pay_month_offset: null は従来どおり（締め日のあとに来る最初の引き落とし日）。
-- 1 は翌月、2 は翌々月（例: 月末締めの翌々月2日払い）。
-- 列を足して、カード代金をつくる関数を作り直す（0066 の関数に pay_month_offset の分岐を足しただけ。削除は含まない）。

alter table public.money_wallets
  add column if not exists pay_month_offset smallint
    check (pay_month_offset is null or pay_month_offset between 1 and 3);

comment on column public.money_wallets.pay_month_offset is
  'カードの引き落とし月が、締め日の月の何か月後か（1〜3）。null は締め日のあとに来る最初の引き落とし日。docs/kakei.md §3.4。';

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
      v_on := public.money_shift_business_day(public.money_day_of_month(v_month, v_rule.day), v_rule.holiday);
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
  '毎月の記録のルールとカード代金から、その日までに来た記録を作る（pg_cron から毎朝）。docs/kakei.md §3.3・§3.4。';

revoke execute on function public.make_money_recurring_records(date) from public, anon, authenticated;
