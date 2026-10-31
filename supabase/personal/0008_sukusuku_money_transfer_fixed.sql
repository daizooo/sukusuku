-- かぞく手帳: 振替の自動記録も、確定（入れた額）で作れるようにする（docs/kakei.md §3.3。2026-10-31）
--
-- 今までは、振替は額を入れたルール（amount_mode = 'fixed'）でもいつも見込みの記録を作っていた。
-- 支出・収入と同じく、確定（'fixed'）は確定の記録、見込み（'estimate'）は過去の記録から見込んだ見込みの記録にする。
-- 変えるのは make_money_recurring_records の v_estimate の1行だけ（ほかは 0001 のまま）。
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。何度流しても同じ。

create or replace function sukusuku.make_money_recurring_records(p_today date DEFAULT ((now() AT TIME ZONE 'Asia/Tokyo'::text))::date) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  c_catch_up constant integer := 7;
  v_rule sukusuku.money_recurring;
  v_card sukusuku.money_wallets;
  v_month date;
  v_on date;
  v_amount integer;
  v_estimate boolean;
  v_record uuid;
  v_pay date;
  v_close date;
  v_prev_close date;
  v_prev_prev_close date;
  v_count integer := 0;
begin
  -- 固定費・給料など
  for v_rule in
    select rule.* from sukusuku.money_recurring as rule
     where rule.archived_at is null
       and rule.makes_record
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
      -- ◯年ごと（車検・2年ごとの火災保険など）は、開始月の年から数えて間隔の年だけ作る（docs/kakei.md §3.3）。
      continue when v_rule.interval_years is not null
                and (extract(year from v_month)::integer - extract(year from v_rule.start_month)::integer) % v_rule.interval_years <> 0;
      v_on := sukusuku.money_shift_business_day(
        sukusuku.money_rule_date(v_month, v_rule.day, v_rule.week_of_month, v_rule.weekday), v_rule.holiday);
      continue when v_on > p_today or v_on < p_today - c_catch_up;
      -- ルールを作る前に来た分は作らない（人がもう入れているはず）。
      continue when v_on < (v_rule.created_at at time zone 'Asia/Tokyo')::date;
      -- 人が手で入れた記録（ルールで作ったものでない記録）が、その月に同じ小分類であれば作らない（二重にならないように。2026-10-24）。
      -- 振替は小分類を持たないので対象外。ルール自身が作った記録は recurring_id で別に重なりを防いでいる（on conflict）。
      continue when v_rule.kind <> 'transfer'
                and exists (
                  select 1
                    from sukusuku.money_records as manual
                    join sukusuku.money_items as item on item.record_id = manual.id
                   where manual.family_id = v_rule.family_id
                     and manual.kind = v_rule.kind
                     and manual.recurring_id is null
                     and item.category_id = v_rule.category_id
                     and manual.occurred_on >= v_month
                     and manual.occurred_on < (v_month + interval '1 month')::date);

      -- 確定（amount_mode = 'fixed'）は確定、見込み（'estimate'）は見込みで作る。収入も同じ（児童手当のように額が決まっているものは確定。
      -- 2026-10-21。0124 で収入をいつも見込みにしたのを戻す）。振替も同じ（2026-10-31。それまでは額を入れたルールでもいつも見込みだった）。
      v_estimate := v_rule.amount_mode = 'estimate';
      v_amount := case when v_rule.amount_mode = 'estimate' then sukusuku.money_recurring_estimate(v_rule, v_month, v_on) else v_rule.amount end;

      insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store,
                                        is_estimate, recurring_id, month)
      values (v_rule.family_id, v_rule.kind, v_on, v_rule.wallet_id,
              case when v_rule.kind = 'transfer' then v_rule.to_wallet_id end,
              case when v_rule.kind = 'transfer' then '' else btrim(v_rule.store) end,
              v_estimate, v_rule.id, v_month)
      on conflict (recurring_id, month) where recurring_id is not null do nothing
      returning id into v_record;

      if v_record is not null then
        insert into sukusuku.money_items (family_id, record_id, amount, category_id, name)
        values (v_rule.family_id, v_record, v_amount,
                case when v_rule.kind <> 'transfer' then v_rule.category_id end,
                btrim(v_rule.name));
        v_count := v_count + 1;
      end if;

      update sukusuku.money_recurring set made_through = v_month where id = v_rule.id;
      v_rule.made_through := v_month;
    end loop;
  end loop;

  -- カード代金（引き落とし口座 → カードの振替）
  for v_card in
    select wallet.* from sukusuku.money_wallets as wallet
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
      v_pay := sukusuku.money_day_of_month(v_month, v_card.pay_day);
      v_on := sukusuku.money_shift_business_day(v_pay, 'next');
      continue when v_on > p_today or v_on < p_today - c_catch_up;

      -- 引き落とし日の前の、いちばん近い締め日までの1か月分（前回の締め日の翌日〜今回の締め日）
      if v_card.pay_month_offset is not null then
        -- 引き落とし月を「締め日の月 + n か月」と決めているカード（月末締めの翌々月払いなど）
        v_close := sukusuku.money_day_of_month((v_month - make_interval(months => v_card.pay_month_offset))::date, v_card.close_day);
      else
        v_close := sukusuku.money_day_of_month(v_month, v_card.close_day);
        if v_close >= v_pay then
          v_close := sukusuku.money_day_of_month((v_month - interval '1 month')::date, v_card.close_day);
        end if;
      end if;
      v_prev_close := sukusuku.money_day_of_month((date_trunc('month', v_close) - interval '1 month')::date, v_card.close_day);
      v_prev_prev_close := sukusuku.money_day_of_month((date_trunc('month', v_close) - interval '2 months')::date, v_card.close_day);

      -- 「翌月分に回す」記録（card_next_period）は、日付の期間の次の期間で数える（docs/kakei.md §3.4）。
      select coalesce(sum(case when record.kind = 'income' then -item.amount else item.amount end), 0)::integer
        into v_amount
        from sukusuku.money_records as record
        join sukusuku.money_items as item on item.record_id = record.id
       where record.family_id = v_card.family_id
         and record.wallet_id = v_card.id
         and record.kind in ('expense', 'income')
         and ((not record.card_next_period and record.occurred_on > v_prev_close and record.occurred_on <= v_close)
           or (record.card_next_period and record.occurred_on > v_prev_prev_close and record.occurred_on <= v_prev_close));

      if v_amount > 0 then
        insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store,
                                          is_estimate, month)
        values (v_card.family_id, 'transfer', v_on, v_card.pay_wallet_id, v_card.id, '', true, v_month)
        returning id into v_record;
        insert into sukusuku.money_items (family_id, record_id, amount)
        values (v_card.family_id, v_record, v_amount);
        v_count := v_count + 1;
      end if;

      update sukusuku.money_wallets set card_made_through = v_month where id = v_card.id;
      v_card.card_made_through := v_month;
    end loop;
  end loop;

  return v_count;
end;
$$;
