-- 統合プロジェクト Persol の sukusuku スキーマに、すくすくの表・関数・トリガー・RLS を作る。
-- 生成: supabase/personal/build-schema.sh（supabase/migrations 0001〜0143 を再生して書き出し、
--       旧プロジェクトの本番DBと定義が一致することを確かめたもの）。手で直さず、作り直すときはスクリプトで。
-- このファイルは sukusuku スキーマの外（public / denken3 / fittrack）に何も作らない。
-- auth.users へのトリガー・cron・Realtime は 0002_sukusuku_platform.sql。

--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: sukusuku; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS sukusuku;


--
-- Name: attach_family_sync(regclass, text); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.attach_family_sync(p_table regclass, p_resolver text DEFAULT 'select family_id from %rows%'::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'sukusuku'
    AS $$
begin
  execute format(
    'create or replace trigger family_sync_ins after insert on %s
       referencing new table as new_rows for each statement
       execute function sukusuku.touch_family_sync(%L)',
    p_table, p_resolver);
  execute format(
    'create or replace trigger family_sync_upd after update on %s
       referencing old table as old_rows new table as new_rows for each statement
       execute function sukusuku.touch_family_sync(%L)',
    p_table, p_resolver);
  execute format(
    'create or replace trigger family_sync_gone after ' || 'dele' || 'te on %s
       referencing old table as old_rows for each statement
       execute function sukusuku.touch_family_sync(%L)',
    p_table, p_resolver);
end;
$$;


--
-- Name: contracts_set_notify_after(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.contracts_set_notify_after() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sukusuku'
    AS $$
begin
  if tg_op = 'INSERT' or new.renews_on is distinct from old.renews_on then
    new.notify_after := (now() at time zone 'Asia/Tokyo')::date;
  end if;
  return new;
end;
$$;


--
-- Name: create_member_invite(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.create_member_invite(p_member_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  member_row sukusuku.family_members;
  new_code text;
begin
  if auth.uid() is null then
    raise exception '招待コードを出すにはログインが必要です';
  end if;

  select * into member_row from sukusuku.family_members where id = p_member_id;
  if not found
     or member_row.family_id is distinct from sukusuku.current_family_id()
     or not sukusuku.is_family_guardian() then
    raise exception '招待コードを出せるのは、自分の家族の保護者だけです';
  end if;
  if member_row.user_id is not null then
    raise exception 'この人にはすでにアカウントがあります';
  end if;

  update sukusuku.member_invites
     set expires_at = now()
   where member_id = p_member_id and used_at is null and expires_at > now();

  -- 12文字の16進（48bit）。使い切りで7日で切れるので、総当たりは現実的でない
  new_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into sukusuku.member_invites (member_id, code_hash, expires_at, created_by)
  values (
    p_member_id,
    encode(sha256(convert_to(new_code, 'UTF8')), 'hex'),
    now() + interval '7 days',
    auth.uid()
  );
  return new_code;
end;
$$;


--
-- Name: create_my_family(text); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.create_my_family(p_role text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  new_family uuid := gen_random_uuid();
  child_member uuid;
  my_family uuid;
begin
  if auth.uid() is null then
    raise exception '家族を作るにはログインが必要です';
  end if;
  if p_role not in ('papa', 'mama') then
    raise exception '役割が正しくありません';
  end if;

  select family_id into my_family from sukusuku.users where id = auth.uid();
  if not found then
    raise exception 'アカウントの情報が見つかりません';
  end if;
  if my_family is not null then
    raise exception 'すでに家族に参加しています';
  end if;

  insert into sukusuku.families (id) values (new_family);

  insert into sukusuku.family_members
    (family_id, user_id, relation, is_guardian, display_name, color, sort_order)
  values
    (new_family, case when p_role = 'papa' then auth.uid() end, 'husband', true, 'パパ', 'blue', 1),
    (new_family, case when p_role = 'mama' then auth.uid() end, 'wife', true, 'ママ', 'pink', 2);

  insert into sukusuku.family_members
    (family_id, relation, is_guardian, display_name, color, sort_order)
  values (new_family, 'child', false, 'こども', 'emerald', 3)
  returning id into child_member;

  insert into sukusuku.children (family_id, member_id) values (new_family, child_member);

  update sukusuku.users set family_id = new_family where id = auth.uid();
  return new_family;
end;
$$;


--
-- Name: current_family_id(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.current_family_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  select family_id from sukusuku.users where id = auth.uid();
$$;


--
-- Name: family_birth_date(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.family_birth_date(p_family_id uuid) RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  select m.birth_date
    from sukusuku.family_members m
   where m.family_id = p_family_id
     and m.relation = 'child'
     and m.birth_date is not null
   order by m.sort_order
   limit 1;
$$;


--
-- Name: family_sync_missing(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.family_sync_missing() RETURNS SETOF text
    LANGUAGE sql STABLE
    SET search_path TO 'sukusuku'
    AS $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'sukusuku'
    and c.relkind = 'r'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'family_id' and not a.attisdropped
    )
    and c.relname <> all (array[
      'family_sync', 'users', 'push_subscriptions', 'member_invites',
      'stock_expiry_deliveries', 'temperature_reminder_deliveries', 'money_feed_tokens',
      'contract_deliveries'
    ])
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid and t.tgname = 'family_sync_ins' and not t.tgisinternal
    )
  order by 1;
$$;


--
-- Name: guard_family_member_columns(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.guard_family_member_columns() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
begin
  if auth.uid() is null or current_setting('sukusuku.member_link', true) = 'on' then
    return new;
  end if;
  if new.family_id <> old.family_id or new.user_id is distinct from old.user_id then
    raise exception 'family_members: family_id / user_id はアプリから変更できません';
  end if;
  if (new.relation <> old.relation or new.is_guardian <> old.is_guardian)
     and not sukusuku.is_family_guardian() then
    raise exception 'family_members: 続柄・保護者の設定は保護者だけが変更できます';
  end if;
  return new;
end;
$$;


--
-- Name: handle_new_auth_user(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
begin
  insert into sukusuku.users (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;


--
-- Name: increment_push_failure(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.increment_push_failure(p_subscription_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  update sukusuku.push_subscriptions
     set failure_count = failure_count + 1
   where id = p_subscription_id;
$$;


--
-- Name: is_family_guardian(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.is_family_guardian() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  select exists (
    select 1 from sukusuku.family_members
     where user_id = auth.uid() and is_guardian
       and family_id = sukusuku.current_family_id()
  );
$$;


--
-- Name: jp_base_holiday_name(date); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.jp_base_holiday_name(p_date date) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when m = 1 and d = 1 then '元日'
    when m = 2 and d = 11 then '建国記念の日'
    when m = 2 and d = 23 then '天皇誕生日'
    when m = 4 and d = 29 then '昭和の日'
    when m = 5 and d = 3 then '憲法記念日'
    when m = 5 and d = 4 then 'みどりの日'
    when m = 5 and d = 5 then 'こどもの日'
    when m = 8 and d = 11 then '山の日'
    when m = 11 and d = 3 then '文化の日'
    when m = 11 and d = 23 then '勤労感謝の日'
    when dow = 1 and m = 1 and nth = 2 then '成人の日'
    when dow = 1 and m = 7 and nth = 3 then '海の日'
    when dow = 1 and m = 9 and nth = 3 then '敬老の日'
    when dow = 1 and m = 10 and nth = 2 then 'スポーツの日'
    when m = 3 and d = floor(20.8431 + 0.242194 * (y - 1980) - floor((y - 1980) / 4.0)) then '春分の日'
    when m = 9 and d = floor(23.2488 + 0.242194 * (y - 1980) - floor((y - 1980) / 4.0)) then '秋分の日'
  end
  from (
    select extract(year from p_date)::integer as y,
           extract(month from p_date)::integer as m,
           extract(day from p_date)::integer as d,
           extract(dow from p_date)::integer as dow,
           (extract(day from p_date)::integer + 6) / 7 as nth
  ) as parts;
$$;


--
-- Name: jp_holiday_name(date); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.jp_holiday_name(p_date date) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  v_name text := sukusuku.jp_base_holiday_name(p_date);
  v_day date;
begin
  if v_name is not null then
    return v_name;
  end if;
  -- 国民の休日。前後を祝日に挟まれた平日（日曜は振替休日のもとになるので除く）。
  if extract(dow from p_date) <> 0
     and sukusuku.jp_base_holiday_name(p_date - 1) is not null
     and sukusuku.jp_base_holiday_name(p_date + 1) is not null then
    return '国民の休日';
  end if;
  -- 振替休日。日曜と重なった祝日から、続く休みを越えた最初の日。
  v_day := p_date - 1;
  while sukusuku.jp_base_holiday_name(v_day) is not null
        or (extract(dow from v_day) <> 0
            and sukusuku.jp_base_holiday_name(v_day - 1) is not null
            and sukusuku.jp_base_holiday_name(v_day + 1) is not null) loop
    if extract(dow from v_day) = 0 and sukusuku.jp_base_holiday_name(v_day) is not null then
      return '振替休日';
    end if;
    v_day := v_day - 1;
  end loop;
  return null;
end;
$$;


--
-- Name: lottery_delete_my_test_data(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.lottery_delete_my_test_data() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  me uuid := auth.uid();
  removed integer;
begin
  if me is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  delete from sukusuku.lottery_coupons where owner_id = me and is_test;
  with gone as (
    delete from sukusuku.subsidy_draws where drawn_by = me and is_test returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;


--
-- Name: lottery_monthly_allowance(uuid, timestamp with time zone); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.lottery_monthly_allowance(p_user uuid, p_at timestamp with time zone) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  select 2 + case when exists (
    select 1 from sukusuku.family_members fm
     where fm.user_id = p_user
       and fm.birth_date is not null
       and extract(month from fm.birth_date) = extract(month from timezone('Asia/Tokyo', p_at))
  ) then 1 else 0 end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: lottery_coupons; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.lottery_coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    kind text NOT NULL,
    cycle integer,
    slot integer,
    source_draw_id uuid,
    obtained_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    used_at timestamp with time zone,
    used_draw_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    CONSTRAINT lottery_coupons_expiry CHECK (((kind = ANY (ARRAY['push'::text, 'rate_up'::text, 'trip'::text])) = (expires_at IS NULL))),
    CONSTRAINT lottery_coupons_kind_check CHECK ((kind = ANY (ARRAY['push'::text, 'rate_up'::text, 'snack'::text, 'movie'::text, 'cafe'::text, 'picnic'::text, 'trip'::text]))),
    CONSTRAINT lottery_coupons_slot_check CHECK (((slot >= 1) AND (slot <= 6))),
    CONSTRAINT lottery_coupons_slot_cycle CHECK (((slot IS NULL) OR (cycle IS NOT NULL))),
    CONSTRAINT lottery_coupons_slot_kind CHECK (((slot IS NULL) OR (kind =
CASE slot
    WHEN 1 THEN 'snack'::text
    WHEN 2 THEN 'movie'::text
    WHEN 3 THEN 'cafe'::text
    WHEN 4 THEN 'picnic'::text
    ELSE 'rate_up'::text
END)))
);


--
-- Name: lottery_open_box(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.lottery_open_box(p_draw_id uuid) RETURNS SETOF sukusuku.lottery_coupons
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  me uuid := auth.uid();
  draw sukusuku.subsidy_draws;
  cur_cycle integer;
  picked integer;
  collected integer;
  created sukusuku.lottery_coupons;
  trip sukusuku.lottery_coupons;
begin
  if me is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  select * into draw from sukusuku.subsidy_draws where id = p_draw_id and drawn_by = me and rate = 100;
  if not found then
    raise exception '100%%のくじではありません' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('lottery_box:' || me::text));
  if exists (select 1 from sukusuku.lottery_coupons where source_draw_id = p_draw_id and slot is not null) then
    raise exception 'この箱はもう開けています' using errcode = 'check_violation';
  end if;
  select 1 + count(*) into cur_cycle
  from sukusuku.lottery_coupons where owner_id = me and is_test = draw.is_test and kind = 'trip';
  select s into picked
  from generate_series(1, 6) s
  where s not in (
    select slot from sukusuku.lottery_coupons
     where owner_id = me and is_test = draw.is_test and cycle = cur_cycle and slot is not null
  )
  order by random()
  limit 1;
  insert into sukusuku.lottery_coupons (family_id, owner_id, kind, cycle, slot, source_draw_id, expires_at, is_test)
  values (
    draw.family_id, me,
    case picked when 1 then 'snack' when 2 then 'movie' when 3 then 'cafe' when 4 then 'picnic' else 'rate_up' end,
    cur_cycle, picked, p_draw_id, case when picked >= 5 then null else now() + interval '1 month' end,
    draw.is_test
  )
  returning * into created;
  return next created;
  select count(*) into collected
  from sukusuku.lottery_coupons
  where owner_id = me and is_test = draw.is_test and cycle = cur_cycle and slot is not null;
  if collected >= 6 then
    insert into sukusuku.lottery_coupons (family_id, owner_id, kind, cycle, source_draw_id, is_test)
    values (draw.family_id, me, 'trip', cur_cycle, p_draw_id, draw.is_test)
    returning * into trip;
    return next trip;
  end if;
  return;
end;
$$;


--
-- Name: lottery_use_coupon(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.lottery_use_coupon(p_coupon_id uuid) RETURNS sukusuku.lottery_coupons
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  me uuid := auth.uid();
  result sukusuku.lottery_coupons;
begin
  if me is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  update sukusuku.lottery_coupons
     set used_at = now()
   where id = p_coupon_id
     and owner_id = me
     and kind in ('snack', 'movie', 'cafe', 'picnic', 'trip')
     and used_at is null
     and (expires_at is null or expires_at > now())
  returning * into result;
  if not found then
    raise exception 'この券は使えません' using errcode = 'check_violation';
  end if;
  return result;
end;
$$;


--
-- Name: subsidy_draws; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.subsidy_draws (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    drawn_by uuid,
    item_name text DEFAULT ''::text NOT NULL,
    price integer NOT NULL,
    ball text NOT NULL,
    rate integer NOT NULL,
    rate_up_used boolean DEFAULT false NOT NULL,
    push_coupon_id uuid,
    subsidy integer NOT NULL,
    drawn_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test boolean DEFAULT false NOT NULL,
    CONSTRAINT subsidy_draws_ball_check CHECK ((ball = ANY (ARRAY['white'::text, 'blue'::text, 'red'::text, 'gold'::text]))),
    CONSTRAINT subsidy_draws_ball_rate CHECK ((((ball = 'white'::text) AND (rate = ANY (ARRAY[25, 50, 75]))) OR ((ball = 'blue'::text) AND (rate = ANY (ARRAY[50, 75]))) OR ((ball = 'red'::text) AND (rate = ANY (ARRAY[75, 100]))) OR ((ball = 'gold'::text) AND (rate = 100)))),
    CONSTRAINT subsidy_draws_price_check CHECK (((price >= 500) AND (price <= 3000))),
    CONSTRAINT subsidy_draws_rate_check CHECK ((rate = ANY (ARRAY[25, 50, 75, 100]))),
    CONSTRAINT subsidy_draws_rate_up_range CHECK (((NOT rate_up_used) OR (rate = ANY (ARRAY[50, 75])))),
    CONSTRAINT subsidy_draws_subsidy_matches_rate CHECK ((subsidy =
CASE
    WHEN (rate = 100) THEN price
    ELSE ((((price * rate) + 5000) / 10000) * 100)
END))
);


--
-- Name: lottery_use_rate_up(uuid, uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.lottery_use_rate_up(p_draw_id uuid, p_coupon_id uuid) RETURNS sukusuku.subsidy_draws
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  me uuid := auth.uid();
  draw sukusuku.subsidy_draws;
  new_rate integer;
begin
  if me is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  select * into draw from sukusuku.subsidy_draws
   where id = p_draw_id and drawn_by = me and not rate_up_used and rate in (25, 50)
     and drawn_at > now() - interval '1 day'
   for update;
  if not found then
    raise exception 'この結果には補助率アップ券を使えません' using errcode = 'check_violation';
  end if;
  perform 1 from sukusuku.lottery_coupons
   where id = p_coupon_id and owner_id = me and is_test = draw.is_test and kind = 'rate_up' and used_at is null
   for update;
  if not found then
    raise exception '補助率アップ券が使えません' using errcode = 'check_violation';
  end if;
  new_rate := draw.rate + 25;
  update sukusuku.lottery_coupons set used_at = now(), used_draw_id = p_draw_id where id = p_coupon_id;
  update sukusuku.subsidy_draws
     set rate = new_rate,
         rate_up_used = true,
         subsidy = ((price * new_rate + 5000) / 10000) * 100
   where id = p_draw_id
  returning * into draw;
  return draw;
end;
$$;


--
-- Name: make_money_recurring_records(date); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.make_money_recurring_records(p_today date DEFAULT ((now() AT TIME ZONE 'Asia/Tokyo'::text))::date) RETURNS integer
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
      -- 2026-10-21。0124 で収入をいつも見込みにしたのを戻す）。振替は額を入れたルールでもいつも見込み（ほぼ毎月額を変えるため）。
      v_estimate := v_rule.amount_mode = 'estimate' or v_rule.kind = 'transfer';
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


--
-- Name: money_amazon_order_feed(uuid, timestamp with time zone, text); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_amazon_order_feed(p_order uuid, p_received_at timestamp with time zone, p_subject text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  o sukusuku.money_amazon_orders;
  f sukusuku.money_feed;
  v_id uuid;
  v_status text;
  v_store text;
  v_names text;
  v_nos text;
  v_total integer;
  v_source_id text;
begin
  select * into o from sukusuku.money_amazon_orders where id = p_order;
  if not found then
    return null;
  end if;
  -- この注文がすでに明細になっていれば、そのまま（注文番号ごとだった前の明細も）
  select status into v_status from sukusuku.money_feed where family_id = o.family_id and amazon_order_id = o.id limit 1;
  if found then
    return v_status;
  end if;

  -- 同じメールの明細（メールのID）
  select * into f from sukusuku.money_feed
   where family_id = o.family_id and source = 'amazon_order' and source_id = o.source_id
   for update;

  if f.id is not null and f.status in ('pending', 'confirm') then
    -- 未確認の明細に足し込む。額・品目の名前・注文番号をそのメールの全注文で作り直し、突き合わせをやり直す
    select sum(oo.total)::integer, string_agg(oo.order_no, ' / ' order by oo.created_at, oo.order_no)
      into v_total, v_nos
      from sukusuku.money_amazon_orders oo
     where oo.family_id = o.family_id and oo.source_id = o.source_id
       and not exists (select 1 from sukusuku.money_feed x where x.amazon_order_id = oo.id and x.id <> f.id);
    select string_agg(l.name, '・' order by oo.created_at, oo.order_no, l.position) into v_names
      from sukusuku.money_amazon_orders oo
      join sukusuku.money_amazon_lines l on l.order_id = oo.id
     where oo.family_id = o.family_id and oo.source_id = o.source_id
       and not exists (select 1 from sukusuku.money_feed x where x.amazon_order_id = oo.id and x.id <> f.id);
    update sukusuku.money_feed
       set amount = v_total, description = left(coalesce(v_names, ''), 200), raw_line = left('注文番号 ' || v_nos, 500),
           candidate_record_ids = '{}', status = 'pending'
     where id = f.id;
    return sukusuku.money_feed_process(f.id);
  end if;

  -- 新しい明細。同じメールの明細がすでに片づいていれば、この注文だけの明細にする
  v_source_id := case when f.id is not null then o.source_id || '#' || o.order_no else o.source_id end;
  v_total := o.total;
  v_nos := o.order_no;

  -- お店: 登録したお店のうち Amazon の名前のもの、無ければ「Amazon」
  select s.name into v_store from sukusuku.money_stores s
   where s.family_id = o.family_id and s.archived_at is null and normalize(s.name, NFKC) ~* '(amazon|アマゾン)'
   order by length(s.name), s.name
   limit 1;
  -- 未確認の一覧に出す品目の名前（利用先の代わり）
  select string_agg(l.name, '・' order by l.position) into v_names
    from sukusuku.money_amazon_lines l where l.order_id = o.id;

  insert into sukusuku.money_feed (family_id, source, source_id, received_at, subject, raw_line,
                                 direction, occurred_on, amount, account_name, description, store_hint, amazon_order_id, status)
  values (o.family_id, 'amazon_order', v_source_id, coalesce(p_received_at, o.created_at),
          left(coalesce(nullif(p_subject, ''), 'Amazon の注文'), 500), left('注文番号 ' || v_nos, 500),
          'out', o.ordered_on, v_total, '三井住友カード（Amazon）', left(coalesce(v_names, ''), 200),
          coalesce(v_store, 'Amazon'), o.id, 'pending')
  on conflict (family_id, source, source_id) do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicate';
  end if;
  return sukusuku.money_feed_process(v_id);
end;
$$;


--
-- Name: money_amazon_order_receive(uuid, jsonb); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_amazon_order_receive(p_family uuid, p_order jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_id uuid;
  v_start timestamptz;
  v_ship uuid;
begin
  select start_at into v_start from sukusuku.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_order ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into sukusuku.money_amazon_orders (family_id, order_no, source_id, ordered_on, total, adjust)
  values (p_family, p_order ->> 'order_no', p_order ->> 'source_id', (p_order ->> 'ordered_on')::date,
          (p_order ->> 'total')::integer, coalesce((p_order ->> 'adjust')::integer, 0))
  on conflict (family_id, order_no) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into sukusuku.money_amazon_lines (family_id, order_id, position, receipt_name, name, quantity, unit_price, amount, category_id)
  select p_family, v_id, (entries.ordinality - 1)::integer,
         entries.item ->> 'receipt_name', coalesce(entries.item ->> 'name', ''),
         coalesce((entries.item ->> 'quantity')::integer, 1), (entries.item ->> 'unit_price')::integer,
         (entries.item ->> 'amount')::integer,
         (select c.id from sukusuku.money_categories c
           where c.family_id = p_family and c.id = nullif(entries.item ->> 'category_id', '')::uuid)
    from jsonb_array_elements(p_order -> 'lines') with ordinality as entries (item, ordinality);

  -- この注文を待っている荷物（発送メールが先に届いたもの）の明細を作る
  for v_ship in
    select distinct x.shipment_id
      from sukusuku.money_amazon_shipment_lines x
      join sukusuku.money_amazon_shipments s on s.id = x.shipment_id
     where x.family_id = p_family and x.order_no = p_order ->> 'order_no' and s.feed_id is null
  loop
    perform sukusuku.money_amazon_shipment_feed(v_ship);
  end loop;

  return jsonb_build_object('status', 'saved', 'id', v_id);
end;
$$;


--
-- Name: money_amazon_shipment_feed(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_amazon_shipment_feed(p_shipment uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  s sukusuku.money_amazon_shipments;
  sl sukusuku.money_amazon_shipment_lines;
  o sukusuku.money_amazon_orders;
  v_line uuid;
  v_waiting boolean := false;
  v_base integer;
  v_full boolean;
  v_rest integer;
  v_count integer;
  v_picks integer[];
  v_total integer;
  v_names text;
  v_nos text;
  v_first uuid;
  v_store text;
  v_id uuid;
begin
  select * into s from sukusuku.money_amazon_shipments where id = p_shipment for update;
  if not found then
    return null;
  end if;
  if s.feed_id is not null then
    return (select status from sukusuku.money_feed where id = s.feed_id);
  end if;

  -- 品目を注文と結ぶ
  for sl in
    select * from sukusuku.money_amazon_shipment_lines where shipment_id = s.id and line_id is null order by position
  loop
    select l.id into v_line
      from sukusuku.money_amazon_lines l
      join sukusuku.money_amazon_orders oo on oo.id = l.order_id
     where oo.family_id = s.family_id and oo.order_no = sl.order_no and l.receipt_name = sl.receipt_name
       and l.quantity - coalesce((select sum(x.quantity) from sukusuku.money_amazon_shipment_lines x where x.line_id = l.id), 0) >= sl.quantity
     order by l.position
     limit 1;
    if v_line is null then
      select min(l.id::text)::uuid into v_line
        from sukusuku.money_amazon_lines l
        join sukusuku.money_amazon_orders oo on oo.id = l.order_id
       where oo.family_id = s.family_id and oo.order_no = sl.order_no
         and l.quantity - coalesce((select sum(x.quantity) from sukusuku.money_amazon_shipment_lines x where x.line_id = l.id), 0) >= sl.quantity
      having count(*) = 1;
    end if;
    if v_line is null then
      v_waiting := true;
    else
      update sukusuku.money_amazon_shipment_lines set line_id = v_line where id = sl.id;
    end if;
  end loop;
  if v_waiting then
    return 'waiting';
  end if;

  -- 前の作りで記録した・確認中の注文なら作らない
  if exists (
    select 1
      from sukusuku.money_amazon_shipment_lines x
      join sukusuku.money_amazon_lines l on l.id = x.line_id
      join sukusuku.money_amazon_orders oo on oo.id = l.order_id
      join sukusuku.money_feed f on f.family_id = oo.family_id and f.source = 'amazon_order' and f.status <> 'ignored'
                              and (f.amazon_order_id = oo.id or (position('#' in f.source_id) = 0 and f.source_id = oo.source_id))
     where x.shipment_id = s.id
       and not exists (select 1 from sukusuku.money_amazon_shipments z where z.feed_id = f.id)
  ) then
    return 'recorded';
  end if;

  -- 額（注文ごと）: 品目は値引き前の額。値引きは、品目に当てはめられれば（定期おトク便の 5%・10%）その品目に乗せる。
  -- 注文の全部の個数が発送された荷物で、注文の合計に足りない（余る）ぶんを、その荷物のいちばん大きい品目に乗せる
  -- （当てはめられない値引き・ポイント・送料など。注文の荷物の額の和 = 注文の合計）
  for o in
    select distinct oo.*
      from sukusuku.money_amazon_shipment_lines x
      join sukusuku.money_amazon_lines l on l.id = x.line_id
      join sukusuku.money_amazon_orders oo on oo.id = l.order_id
     where x.shipment_id = s.id
  loop
    select sum(l.amount)::integer,
           sum(l.quantity) = (select coalesce(sum(x.quantity), 0)
                                from sukusuku.money_amazon_shipment_lines x
                                join sukusuku.money_amazon_lines l2 on l2.id = x.line_id
                               where l2.order_id = o.id),
           count(*)
      into v_base, v_full, v_count
      from sukusuku.money_amazon_lines l
     where l.order_id = o.id;

    -- 値引き（品目の和 − 合計）を、品目ごとに「なし・5%・10%」（1個あたり四捨五入 × 個数）で説明できる組み合わせ。1通りだけなら使う
    v_picks := null;
    if v_base - o.total > 0 and v_count <= 12 then
      with recursive ls as (
        select row_number() over (order by l.position, l.id) as n, l.unit_price, l.quantity
          from sukusuku.money_amazon_lines l
         where l.order_id = o.id
      ),
      walk (n, total, picks) as (
        select 0::bigint, 0, array[]::integer[]
        union all
        select w.n + 1, w.total + d.unit_off * ls.quantity, w.picks || d.unit_off
          from walk w
          join ls on ls.n = w.n + 1
          cross join lateral (select distinct round(ls.unit_price * r.pct / 100.0)::integer as unit_off
                                from (values (0), (5), (10)) as r (pct)) d
         where w.total + d.unit_off * ls.quantity <= v_base - o.total
      )
      select case when count(distinct picks) = 1 then min(picks) end
        into v_picks
        from walk
       where n = v_count and total = v_base - o.total;
    end if;

    update sukusuku.money_amazon_shipment_lines x
       set amount = (l.unit_price - coalesce(v_picks[p.n::integer], 0)) * x.quantity
      from sukusuku.money_amazon_lines l
      join (select row_number() over (order by l3.position, l3.id) as n, l3.id
              from sukusuku.money_amazon_lines l3
             where l3.order_id = o.id) p on p.id = l.id
     where l.id = x.line_id and x.shipment_id = s.id and l.order_id = o.id;

    if v_full then
      select o.total - coalesce(sum(x.amount), 0) into v_rest
        from sukusuku.money_amazon_shipment_lines x
        join sukusuku.money_amazon_lines l on l.id = x.line_id
       where l.order_id = o.id;
      if v_rest <> 0 then
        update sukusuku.money_amazon_shipment_lines
           set amount = greatest(amount + v_rest, 0)
         where id = (select x.id
                       from sukusuku.money_amazon_shipment_lines x
                       join sukusuku.money_amazon_lines l on l.id = x.line_id
                      where x.shipment_id = s.id and l.order_id = o.id
                      order by x.amount desc, x.position
                      limit 1);
      end if;
    end if;
  end loop;

  select coalesce(sum(x.amount), 0)::integer,
         string_agg(l.name, '・' order by x.position),
         (array_agg(l.order_id order by x.position))[1]
    into v_total, v_names, v_first
    from sukusuku.money_amazon_shipment_lines x
    join sukusuku.money_amazon_lines l on l.id = x.line_id
   where x.shipment_id = s.id;
  if v_total <= 0 then
    return 'skipped';
  end if;
  select string_agg(distinct x.order_no, ' / ') into v_nos
    from sukusuku.money_amazon_shipment_lines x where x.shipment_id = s.id;

  -- お店: 登録したお店のうち Amazon の名前のもの、無ければ「Amazon」
  select st.name into v_store from sukusuku.money_stores st
   where st.family_id = s.family_id and st.archived_at is null and normalize(st.name, NFKC) ~* '(amazon|アマゾン)'
   order by length(st.name), st.name
   limit 1;

  insert into sukusuku.money_feed (family_id, source, source_id, received_at, subject, raw_line,
                                 direction, occurred_on, amount, account_name, description, store_hint, amazon_order_id, status)
  values (s.family_id, 'amazon_order', s.source_id, s.received_at,
          left(coalesce(nullif(s.subject, ''), 'Amazon の発送'), 500), left('注文番号 ' || coalesce(v_nos, ''), 500),
          'out', s.shipped_on, v_total, '三井住友カード（Amazon）', left(coalesce(v_names, ''), 200),
          coalesce(v_store, 'Amazon'), v_first, 'pending')
  on conflict (family_id, source, source_id) do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicate';
  end if;
  update sukusuku.money_amazon_shipments set feed_id = v_id where id = s.id;
  return sukusuku.money_feed_process(v_id);
end;
$$;


--
-- Name: money_amazon_shipment_receive(uuid, jsonb); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_amazon_shipment_receive(p_family uuid, p_shipment jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_id uuid;
  v_start timestamptz;
begin
  select start_at into v_start from sukusuku.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_shipment ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into sukusuku.money_amazon_shipments (family_id, source_id, received_at, shipped_on, subject)
  values (p_family, p_shipment ->> 'source_id', (p_shipment ->> 'received_at')::timestamptz,
          (p_shipment ->> 'shipped_on')::date, left(coalesce(p_shipment ->> 'subject', ''), 500))
  on conflict (family_id, source_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into sukusuku.money_amazon_shipment_lines (family_id, shipment_id, position, order_no, receipt_name, quantity)
  select p_family, v_id, (entries.ordinality - 1)::integer,
         entries.item ->> 'order_no', entries.item ->> 'receipt_name',
         least(9999, greatest(1, coalesce((entries.item ->> 'quantity')::integer, 1)))
    from jsonb_array_elements(p_shipment -> 'lines') with ordinality as entries (item, ordinality);

  return jsonb_build_object('status', 'saved', 'id', v_id, 'feed', sukusuku.money_amazon_shipment_feed(v_id));
end;
$$;


--
-- Name: money_bootstrap(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_bootstrap(p_family_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'sukusuku'
    AS $$
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                     from sukusuku.money_categories c where c.family_id = p_family_id),
    'budgets', '[]'::jsonb,
    'wallets', (select coalesce(jsonb_agg(to_jsonb(w) order by w.position), '[]'::jsonb)
                  from sukusuku.money_wallets w where w.family_id = p_family_id),
    'stores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.position, s.name), '[]'::jsonb)
                 from sukusuku.money_stores s where s.family_id = p_family_id),
    'recurring', (select coalesce(jsonb_agg(to_jsonb(r) order by r.position), '[]'::jsonb)
                    from sukusuku.money_recurring r where r.family_id = p_family_id),
    'balances', (select coalesce(jsonb_agg(to_jsonb(wb)), '[]'::jsonb)
                   from sukusuku.money_wallet_balances wb where wb.family_id = p_family_id),
    'records', (
      select coalesce(jsonb_agg(
               to_jsonb(rec) || jsonb_build_object('money_items', coalesce(
                 (select jsonb_agg(to_jsonb(it) order by it.position)
                    from sukusuku.money_items it where it.record_id = rec.id),
                 '[]'::jsonb))
               order by rec.occurred_on, rec.created_at, rec.id), '[]'::jsonb)
        from sukusuku.money_records rec where rec.family_id = p_family_id),
    'securities', (select coalesce(jsonb_agg(to_jsonb(se) order by se.position), '[]'::jsonb)
                     from sukusuku.money_securities se where se.family_id = p_family_id),
    'holdings', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
                   from sukusuku.money_holdings h where h.family_id = p_family_id),
    'latest_values', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
                        from sukusuku.money_latest_holding_values(p_family_id) v),
    'months', (select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb)
                 from sukusuku.money_months m where m.family_id = p_family_id),
    'budget_lines', '[]'::jsonb,
    'ratio_targets', (select coalesce(jsonb_agg(to_jsonb(rt)), '[]'::jsonb)
                        from sukusuku.money_ratio_targets rt where rt.family_id = p_family_id)
  );
$$;


--
-- Name: money_categories_keep_name(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_categories_keep_name() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  update sukusuku.money_items
     set category_name = old.name
   where category_id = old.id
     and family_id = old.family_id;
  return old;
end;
$$;


--
-- Name: money_day_of_month(date, integer); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_day_of_month(p_month date, p_day integer) RETURNS date
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select (date_trunc('month', p_month)::date
          + (least(p_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer) - 1))::date;
$$;


--
-- Name: money_feed_fill(uuid, uuid, text, date, integer); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_fill(p_feed uuid, p_wallet uuid, p_direction text, p_occurred_on date, p_amount integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  f sukusuku.money_feed;
  v_family uuid := sukusuku.current_family_id();
begin
  select * into f from sukusuku.money_feed where id = p_feed for update;
  if not found or f.family_id is distinct from v_family then
    raise exception 'not found';
  end if;
  if f.status <> 'unreadable' then
    raise exception 'not unreadable';
  end if;
  if p_direction not in ('in', 'out') or p_amount is null or p_amount <= 0 or p_occurred_on is null then
    raise exception 'invalid';
  end if;
  if not exists (select 1 from sukusuku.money_wallets where id = p_wallet and family_id = v_family) then
    raise exception 'wallet not found';
  end if;
  update sukusuku.money_feed
     set wallet_id = p_wallet, direction = p_direction, occurred_on = p_occurred_on, amount = p_amount,
         status = 'pending', resolved_by = auth.uid(), resolved_at = now()
   where id = f.id;
  return sukusuku.money_feed_process(f.id);
end;
$$;


--
-- Name: money_feed_issue_token(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_issue_token() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku', 'extensions'
    AS $$
declare
  v_family uuid := sukusuku.current_family_id();
  v_token text;
begin
  if v_family is null then
    raise exception 'not in a family';
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into sukusuku.money_feed_tokens (family_id, token_hash)
  values (v_family, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  on conflict (family_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
  insert into sukusuku.money_feed_settings (family_id) values (v_family) on conflict (family_id) do nothing;
  return v_token;
end;
$$;


--
-- Name: money_feed_key(text); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_key(p_description text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'sukusuku'
    AS $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(normalize(coalesce(p_description, ''), NFKC), '\(依頼人名:[^()]*\)', '', 'g'),
        '管理番号:\S*', '', 'g'),
      '[0-9]+', '', 'g'),
    '\s+', ' ', 'g'));
$$;


--
-- Name: money_feed_last_sync(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_last_sync() RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  select last_sync_at from sukusuku.money_feed_tokens where family_id = sukusuku.current_family_id();
$$;


--
-- Name: money_feed; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_feed (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    source text DEFAULT 'zaim_mail'::text NOT NULL,
    source_id text NOT NULL,
    received_at timestamp with time zone NOT NULL,
    to_email text,
    subject text DEFAULT ''::text NOT NULL,
    raw_line text DEFAULT ''::text NOT NULL,
    direction text,
    occurred_on date,
    amount integer,
    account_name text,
    description text DEFAULT ''::text NOT NULL,
    wallet_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    pair_id uuid,
    record_id uuid,
    rule_id uuid,
    candidate_record_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    skip_manual boolean DEFAULT false NOT NULL,
    store_hint text,
    amazon_order_id uuid,
    amazon_line_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    amazon_with_adjust boolean DEFAULT false NOT NULL,
    CONSTRAINT money_feed_amount_check CHECK (((amount IS NULL) OR (amount > 0))),
    CONSTRAINT money_feed_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
    CONSTRAINT money_feed_source_check CHECK ((source = ANY (ARRAY['zaim_mail'::text, 'card_mail'::text, 'amazon_order'::text]))),
    CONSTRAINT money_feed_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirm'::text, 'linked'::text, 'created'::text, 'ignored'::text, 'unreadable'::text])))
);


--
-- Name: money_feed_learn(sukusuku.money_feed, text, text, uuid, text, uuid, uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_learn(p_feed sukusuku.money_feed, p_action text, p_record_kind text DEFAULT NULL::text, p_category uuid DEFAULT NULL::uuid, p_store text DEFAULT ''::text, p_to_wallet uuid DEFAULT NULL::uuid, p_recurring uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_key text := sukusuku.money_feed_key(p_feed.description);
  v_existing uuid;
begin
  if p_feed.wallet_id is null then
    return;
  end if;
  select id into v_existing from sukusuku.money_feed_rules
   where family_id = p_feed.family_id and learned and match = 'key' and pattern = v_key
     and wallet_id = p_feed.wallet_id and direction = p_feed.direction
   limit 1;
  if v_existing is not null then
    update sukusuku.money_feed_rules
       set action = p_action, record_kind = p_record_kind, category_id = p_category, store = coalesce(p_store, ''),
           to_wallet_id = p_to_wallet, recurring_id = p_recurring
     where id = v_existing;
    return;
  end if;
  insert into sukusuku.money_feed_rules (family_id, position, name, wallet_id, direction, match, pattern,
                                       action, record_kind, category_id, store, to_wallet_id, recurring_id, learned)
  values (p_feed.family_id,
          coalesce((select max(position) + 1 from sukusuku.money_feed_rules where family_id = p_feed.family_id), 0),
          v_key, p_feed.wallet_id, p_feed.direction, 'key', v_key,
          p_action, p_record_kind, p_category, coalesce(p_store, ''), p_to_wallet, p_recurring, true);
end;
$$;


--
-- Name: money_feed_link(uuid, uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_link(p_feed uuid, p_record uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  f sukusuku.money_feed;
begin
  select * into f from sukusuku.money_feed where id = p_feed;
  update sukusuku.money_items set amount = f.amount
   where record_id = p_record
     and (select count(*) from sukusuku.money_items where record_id = p_record) = 1;
  update sukusuku.money_records set feed_id = coalesce(feed_id, f.id), is_estimate = false where id = p_record;
  update sukusuku.money_feed set status = 'linked', record_id = p_record, candidate_record_ids = '{}' where id = f.id;
end;
$$;


--
-- Name: money_feed_mail_record(uuid, jsonb); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_mail_record(p_family uuid, p_mails jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  insert into sukusuku.money_feed_mails (family_id, message_id, received_at, outcome)
  select p_family, m ->> 'message_id', (m ->> 'received_at')::timestamptz, m ->> 'outcome'
    from jsonb_array_elements(p_mails) as m
  on conflict (family_id, message_id) do update set outcome = excluded.outcome
   where sukusuku.money_feed_mails.outcome is distinct from excluded.outcome;
$$;


--
-- Name: money_feed_mail_sync(uuid, text[], jsonb); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_mail_sync(p_family uuid, p_ids text[], p_applied jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_missing jsonb;
  v_changes jsonb;
begin
  update sukusuku.money_feed_mails m
     set tag = case when a ->> 'label' in ('olive_credit', 'olive_debit', 'amazon', 'skipped') then a ->> 'label' else m.tag end,
         label = case when a ->> 'label' in ('open', 'done', 'unreadable') then a ->> 'label' else m.label end,
         trashed_at = case when (a ->> 'trashed')::boolean then coalesce(m.trashed_at, now()) else m.trashed_at end
    from jsonb_array_elements(coalesce(p_applied, '[]'::jsonb)) as a
   where m.family_id = p_family and m.message_id = a ->> 'id';

  update sukusuku.money_feed_tokens set last_sync_at = now() where family_id = p_family;

  select coalesce(jsonb_agg(i.id), '[]'::jsonb) into v_missing
    from unnest(coalesce(p_ids, '{}'::text[])) as i (id)
   where not exists (select 1 from sukusuku.money_feed_mails m where m.family_id = p_family and m.message_id = i.id);

  with states as (
    -- そのメールから作った明細（利用通知・発送メール・前の作りの注文メール）
    select m.message_id, m.tag as applied, m.outcome, f.n, f.debit, f.card, f.open
      from sukusuku.money_feed_mails m
      left join lateral (
        select count(*) as n,
               bool_or(position('デビット' in coalesce(x.account_name, '')) > 0) as debit,
               bool_or(x.source = 'card_mail') as card,
               bool_or(x.status in ('pending', 'confirm', 'unreadable')) as open
          from sukusuku.money_feed x
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
             when exists (select 1 from sukusuku.money_amazon_shipments s where s.family_id = p_family and s.source_id = st.message_id) then
               case when st.n > 0 then not st.open else not exists (select 1
                             from sukusuku.money_amazon_shipments s
                             join sukusuku.money_amazon_shipment_lines x on x.shipment_id = s.id
                            where s.family_id = p_family and s.source_id = st.message_id and x.line_id is null) end
             -- 注文メール（前の作りで、このメールから作った明細は見ない。「記録しない」にしたものは荷物の明細として出直すため）: 注文が全部片づいた
             else exists (select 1 from sukusuku.money_amazon_orders o where o.family_id = p_family and o.source_id = st.message_id)
                  and not exists (
                    select 1
                      from sukusuku.money_amazon_orders o
                     where o.family_id = p_family and o.source_id = st.message_id
                       -- 前の作り（注文ごと・メールごと）で記録した注文は片づいている
                       and not exists (select 1 from sukusuku.money_feed f
                                        where f.family_id = p_family and f.source = 'amazon_order'
                                          and f.status in ('linked', 'created')
                                          and not exists (select 1 from sukusuku.money_amazon_shipments z where z.feed_id = f.id)
                                          and (f.amazon_order_id = o.id or f.source_id = o.source_id or f.source_id like o.source_id || '#%'))
                       and (
                         -- まだ発送していない個数がある
                         (select coalesce(sum(l.quantity), 0) from sukusuku.money_amazon_lines l where l.order_id = o.id)
                           > (select coalesce(sum(x.quantity), 0)
                                from sukusuku.money_amazon_shipment_lines x
                                join sukusuku.money_amazon_lines l on l.id = x.line_id
                               where l.order_id = o.id)
                         -- 荷物の明細がまだ片づいていない
                         or exists (select 1
                                      from sukusuku.money_amazon_shipment_lines x
                                      join sukusuku.money_amazon_lines l on l.id = x.line_id
                                      join sukusuku.money_amazon_shipments s on s.id = x.shipment_id
                                      join sukusuku.money_feed f on f.id = s.feed_id
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
$$;


--
-- Name: money_feed_order_lines(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_order_lines(p_feed uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  f sukusuku.money_feed;
  v_result jsonb;
begin
  select * into f from sukusuku.money_feed where id = p_feed and family_id = sukusuku.current_family_id();
  if not found then
    return null;
  end if;

  if exists (select 1 from sukusuku.money_amazon_shipments s where s.feed_id = f.id) then
    select jsonb_build_object(
             'total', coalesce(sum(x.amount), 0),
             'lines', coalesce(jsonb_agg(jsonb_build_object(
                        'receipt_name', l.receipt_name,
                        'name', coalesce(nullif((select i.name from sukusuku.money_items i
                                                  where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.name <> ''
                                                  order by i.created_at desc limit 1), ''), l.name),
                        'quantity', x.quantity,
                        'unit_price', l.unit_price,
                        -- この品目に乗る値引き（マイナスは送料など）。アプリは品目の下に「値引き」の行を足す
                        'discount', l.unit_price * x.quantity - x.amount,
                        'category_id', coalesce(
                          (select i.category_id from sukusuku.money_items i
                            where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.category_id is not null
                              and exists (select 1 from sukusuku.money_categories c where c.id = i.category_id and c.archived_at is null)
                            order by i.created_at desc limit 1),
                          (select c.id from sukusuku.money_categories c where c.id = l.category_id and c.archived_at is null)))
                      order by x.position), '[]'::jsonb))
      into v_result
      from sukusuku.money_amazon_shipments s
      join sukusuku.money_amazon_shipment_lines x on x.shipment_id = s.id
      join sukusuku.money_amazon_lines l on l.id = x.line_id
     where s.feed_id = f.id;
    return v_result;
  end if;

  with fo as (
    select o.*
      from sukusuku.money_amazon_orders o
     where o.family_id = f.family_id
       and (o.id = f.amazon_order_id
            or (position('#' in f.source_id) = 0
                and o.source_id = f.source_id
                and not exists (select 1 from sukusuku.money_feed x where x.amazon_order_id = o.id and x.id <> f.id)))
  )
  select jsonb_build_object(
           'total', (select sum(fo.total) from fo),
           'lines', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'receipt_name', l.receipt_name,
                      'name', coalesce(nullif((select i.name from sukusuku.money_items i
                                                where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.name <> ''
                                                order by i.created_at desc limit 1), ''), l.name),
                      'quantity', l.quantity,
                      'unit_price', l.unit_price,
                      'category_id', coalesce(
                        (select i.category_id from sukusuku.money_items i
                          where i.family_id = l.family_id and i.receipt_name = l.receipt_name and i.category_id is not null
                            and exists (select 1 from sukusuku.money_categories c where c.id = i.category_id and c.archived_at is null)
                          order by i.created_at desc limit 1),
                        (select c.id from sukusuku.money_categories c where c.id = l.category_id and c.archived_at is null)))
                    order by fo.created_at, fo.order_no, l.position)
               from fo
               join sukusuku.money_amazon_lines l on l.order_id = fo.id), '[]'::jsonb))
    into v_result
   where exists (select 1 from fo);
  return v_result;
end;
$$;


--
-- Name: money_feed_process(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_process(p_feed uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  f sukusuku.money_feed;
  s sukusuku.money_feed_settings;
  v_wallets uuid[];
  v_requester text;
  v_pairs uuid[];
  g sukusuku.money_feed;
  v_out sukusuku.money_feed;
  v_in sukusuku.money_feed;
  v_cands uuid[];
  r sukusuku.money_feed_rules;
  v_record uuid;
  v_kind text;
begin
  select * into f from sukusuku.money_feed where id = p_feed for update;
  if not found or f.status not in ('pending') or f.direction is null then
    return coalesce(f.status, 'missing');
  end if;
  select * into s from sukusuku.money_feed_settings where family_id = f.family_id;
  if not found then
    insert into sukusuku.money_feed_settings (family_id) values (f.family_id) returning * into s;
  end if;

  if f.wallet_id is null then
    select array_agg(id) into v_wallets from sukusuku.money_wallets
     where family_id = f.family_id and archived_at is null and feed_name = f.account_name
       and (holder_zaim_email is null or f.to_email is null or lower(holder_zaim_email) = lower(f.to_email));
    if coalesce(array_length(v_wallets, 1), 0) > 1 then
      v_requester := sukusuku.money_feed_requester(f.description);
      if v_requester is not null then
        select array_agg(id) into v_wallets from sukusuku.money_wallets
         where id = any (v_wallets)
           and regexp_replace(normalize(coalesce(holder_kana, ''), NFKC), '\s+', ' ', 'g') = v_requester;
      end if;
    end if;
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      select array_agg(distinct fr.wallet_id) into v_wallets from sukusuku.money_feed_rules fr
       join sukusuku.money_wallets w on w.id = fr.wallet_id
       where fr.family_id = f.family_id and fr.match = 'key' and fr.wallet_id is not null
         and w.feed_name = f.account_name
         and (fr.direction is null or fr.direction = f.direction)
         and fr.pattern = sukusuku.money_feed_key(f.description);
    end if;
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      return 'pending';
    end if;
    f.wallet_id := v_wallets[1];
    update sukusuku.money_feed set wallet_id = f.wallet_id where id = f.id;
  end if;

  -- 振替の組み合わせは Zaim の明細どうしだけ（カードの利用通知は組にしない。docs/kakei.md §9.6）
  select array_agg(id) into v_pairs from sukusuku.money_feed
   where family_id = f.family_id and id <> f.id and status in ('pending', 'confirm') and pair_id is null
     and f.source = 'zaim_mail' and source = 'zaim_mail'
     and direction is not null and direction <> f.direction and amount = f.amount
     and wallet_id is not null and wallet_id <> f.wallet_id
     and abs(occurred_on - f.occurred_on) <= s.pair_days;
  if coalesce(array_length(v_pairs, 1), 0) = 1 then
    select * into g from sukusuku.money_feed where id = v_pairs[1] for update;
    if f.direction = 'out' then v_out := f; v_in := g; else v_out := g; v_in := f; end if;
    update sukusuku.money_feed set pair_id = g.id where id = f.id;
    update sukusuku.money_feed set pair_id = f.id where id = g.id;

    select array_agg(rec.id) into v_cands from sukusuku.money_records rec
     where rec.family_id = f.family_id and rec.feed_id is null and rec.month is null
       and not exists (select 1 from sukusuku.money_feed x where x.record_id = rec.id)
       and abs(rec.occurred_on - v_out.occurred_on) <= s.manual_days
       and sukusuku.money_record_amount(rec.id) = f.amount
       and ((rec.kind = 'transfer' and rec.wallet_id = v_out.wallet_id and rec.to_wallet_id = v_in.wallet_id)
            or (rec.kind = 'expense' and rec.wallet_id = v_out.wallet_id)
            or (rec.kind = 'income' and rec.wallet_id = v_in.wallet_id));
    if v_cands is not null and not (f.skip_manual or g.skip_manual) then
      update sukusuku.money_feed set status = 'confirm', candidate_record_ids = v_cands where id in (f.id, g.id);
      return 'confirm';
    end if;

    insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id)
    values (f.family_id, 'transfer', v_out.occurred_on, v_out.wallet_id, v_in.wallet_id, '', v_out.id)
    returning id into v_record;
    insert into sukusuku.money_items (family_id, record_id, amount) values (f.family_id, v_record, f.amount);
    update sukusuku.money_feed set status = 'created', record_id = v_record where id in (f.id, g.id);
    return 'created';
  end if;
  if coalesce(array_length(v_pairs, 1), 0) > 1 then
    update sukusuku.money_feed set candidate_record_ids = '{}' where id = f.id;
    return 'pending';
  end if;

  -- 注文メールの明細は、取り込みのルール・自動の記録との照合を使わない（品目つきで記録するため。docs/kakei.md §9.10）
  select * into r from sukusuku.money_feed_rules fr
   where fr.family_id = f.family_id and f.amazon_order_id is null
     and (fr.wallet_id is null or fr.wallet_id = f.wallet_id)
     and (fr.direction is null or fr.direction = f.direction)
     and (fr.amount_min is null or f.amount >= fr.amount_min)
     and (fr.amount_max is null or f.amount <= fr.amount_max)
     and case fr.match
           when 'key' then fr.pattern = sukusuku.money_feed_key(f.description)
           else fr.pattern = '' or position(normalize(fr.pattern, NFKC) in normalize(f.description, NFKC)) > 0
         end
   order by fr.position, fr.created_at
   limit 1;
  if found then
    update sukusuku.money_feed set rule_id = r.id where id = f.id;
    if r.action = 'ignore' then
      update sukusuku.money_feed set status = 'ignored' where id = f.id;
      return 'ignored';
    end if;
    if r.action in ('link_recurring', 'adjust_only') then
      select array_agg(rec.id order by abs(rec.occurred_on - f.occurred_on)) into v_cands
        from sukusuku.money_records rec
        left join sukusuku.money_wallets card on card.id = rec.to_wallet_id
       where rec.family_id = f.family_id and rec.month is not null and rec.feed_id is null
         and not exists (select 1 from sukusuku.money_feed x where x.record_id = rec.id)
         and abs(rec.occurred_on - f.occurred_on) <= s.estimate_days
         and case r.action
               when 'link_recurring' then rec.recurring_id = r.recurring_id
                 and (rec.wallet_id = f.wallet_id or rec.to_wallet_id = f.wallet_id)
               else rec.kind = 'transfer' and rec.recurring_id is null and rec.wallet_id = f.wallet_id
                 and card.type = 'card'
             end;
      if r.action = 'adjust_only' and coalesce(array_length(v_cands, 1), 0) > 1 then
        select array_agg(id) into v_cands from unnest(v_cands) as c(id)
         where sukusuku.money_record_amount(c.id) = f.amount;
      end if;
      if coalesce(array_length(v_cands, 1), 0) >= 1 and (r.action = 'link_recurring' or array_length(v_cands, 1) = 1) then
        perform sukusuku.money_feed_link(f.id, v_cands[1]);
        return 'linked';
      end if;
      if r.action = 'adjust_only' and v_cands is null then
        update sukusuku.money_feed set status = 'ignored' where id = f.id;
        return 'ignored';
      end if;
      update sukusuku.money_feed set candidate_record_ids = coalesce(v_cands, '{}') where id = f.id;
      return 'pending';
    end if;
  end if;

  if r.id is null and f.amazon_order_id is null then
    select array_agg(rec.id) into v_cands from sukusuku.money_records rec
     where rec.family_id = f.family_id and rec.month is not null and rec.feed_id is null
       and not exists (select 1 from sukusuku.money_feed x where x.record_id = rec.id)
       and abs(rec.occurred_on - f.occurred_on) <= s.estimate_days
       and sukusuku.money_record_amount(rec.id) = f.amount
       and case f.direction
             when 'out' then rec.wallet_id = f.wallet_id and rec.kind in ('expense', 'transfer')
             else (rec.kind = 'income' and rec.wallet_id = f.wallet_id) or (rec.kind = 'transfer' and rec.to_wallet_id = f.wallet_id)
           end;
    if coalesce(array_length(v_cands, 1), 0) = 1 then
      perform sukusuku.money_feed_link(f.id, v_cands[1]);
      return 'linked';
    end if;
  end if;

  v_kind := case f.direction when 'out' then 'expense' else 'income' end;
  select array_agg(rec.id) into v_cands from sukusuku.money_records rec
   where rec.family_id = f.family_id and rec.feed_id is null and rec.month is null
     and not exists (select 1 from sukusuku.money_feed x where x.record_id = rec.id)
     and abs(rec.occurred_on - f.occurred_on) <= s.manual_days
     and sukusuku.money_record_amount(rec.id) = f.amount
     and ((rec.kind = v_kind and rec.wallet_id = f.wallet_id)
          or (rec.kind = 'transfer' and f.direction = 'out' and rec.wallet_id = f.wallet_id)
          or (rec.kind = 'transfer' and f.direction = 'in' and rec.to_wallet_id = f.wallet_id));
  if v_cands is not null and not f.skip_manual then
    -- カードの利用通知で、当たった手入力がレシートから入れた記録1つだけ（前後1日）なら、確かめずに結ぶ（docs/kakei.md §9.6.5 の B）
    if f.source = 'card_mail' and array_length(v_cands, 1) = 1
       and exists (select 1 from sukusuku.money_records rec
                    where rec.id = v_cands[1] and rec.receipt_store is not null
                      and abs(rec.occurred_on - f.occurred_on) <= 1) then
      update sukusuku.money_records set feed_id = coalesce(feed_id, f.id) where id = v_cands[1];
      update sukusuku.money_feed set status = 'linked', record_id = v_cands[1], candidate_record_ids = '{}' where id = f.id;
      return 'linked';
    end if;
    update sukusuku.money_feed set status = 'confirm', candidate_record_ids = v_cands where id = f.id;
    return 'confirm';
  end if;

  if r.id is not null and r.action in ('record', 'transfer') then
    if r.action = 'record' then
      insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id)
      values (f.family_id, r.record_kind, f.occurred_on, f.wallet_id, btrim(r.store), f.id)
      returning id into v_record;
      insert into sukusuku.money_items (family_id, record_id, amount, category_id)
      values (f.family_id, v_record, f.amount, r.category_id);
    else
      insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id)
      values (f.family_id, 'transfer', f.occurred_on,
              case f.direction when 'out' then f.wallet_id else r.to_wallet_id end,
              case f.direction when 'out' then r.to_wallet_id else f.wallet_id end, '', f.id)
      returning id into v_record;
      insert into sukusuku.money_items (family_id, record_id, amount) values (f.family_id, v_record, f.amount);
    end if;
    update sukusuku.money_feed set status = 'created', record_id = v_record where id = f.id;
    return 'created';
  end if;

  return 'pending';
end;
$$;


--
-- Name: money_feed_receive(uuid, jsonb); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_receive(p_family uuid, p_feed jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_id uuid;
  v_status text;
  v_start timestamptz;
  v_source text := coalesce(p_feed ->> 'source', 'zaim_mail');
begin
  select start_at into v_start from sukusuku.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_feed ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into sukusuku.money_feed (family_id, source, source_id, received_at, to_email, subject, raw_line,
                                 direction, occurred_on, amount, account_name, description, store_hint,
                                 amazon_order_id, amazon_line_ids, amazon_with_adjust, status)
  values (p_family, v_source, p_feed ->> 'source_id', (p_feed ->> 'received_at')::timestamptz,
          nullif(p_feed ->> 'to_email', ''), coalesce(p_feed ->> 'subject', ''), coalesce(p_feed ->> 'raw_line', ''),
          p_feed ->> 'direction', (p_feed ->> 'occurred_on')::date, (p_feed ->> 'amount')::integer,
          p_feed ->> 'account_name', coalesce(p_feed ->> 'description', ''), nullif(btrim(p_feed ->> 'store_hint'), ''),
          nullif(p_feed ->> 'amazon_order_id', '')::uuid,
          coalesce(array(select x::uuid from jsonb_array_elements_text(p_feed -> 'amazon_line_ids') as t(x)), '{}'::uuid[]),
          coalesce((p_feed ->> 'amazon_with_adjust')::boolean, false),
          case when p_feed ->> 'direction' is null then 'unreadable' else 'pending' end)
  on conflict (family_id, source, source_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id, status into v_id, v_status from sukusuku.money_feed
     where family_id = p_family and source = v_source and source_id = p_feed ->> 'source_id';
    return jsonb_build_object('id', v_id, 'status', v_status, 'duplicate', true);
  end if;

  v_status := sukusuku.money_feed_process(v_id);
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;


--
-- Name: money_feed_reprocess(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_reprocess() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_family uuid := sukusuku.current_family_id();
  v_id uuid;
  v_count integer := 0;
begin
  if v_family is null then
    raise exception 'not in a family';
  end if;
  for v_id in
    select id from sukusuku.money_feed
     where family_id = v_family and status = 'pending' and pair_id is null
     order by received_at
  loop
    if sukusuku.money_feed_process(v_id) <> 'pending' then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;


--
-- Name: money_feed_requester(text); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_requester(p_description text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'sukusuku'
    AS $_$
  select nullif(btrim(regexp_replace(
    substring(normalize(coalesce(p_description, ''), NFKC) from '依頼人名:\s*([^:()]*?)\s*(?:振込予定日|\)|$)'),
    '\s+', ' ', 'g')), '');
$_$;


--
-- Name: money_feed_resolve(uuid, text, jsonb); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_feed_resolve(p_feed uuid, p_action text, p_args jsonb DEFAULT '{}'::jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  f sukusuku.money_feed;
  g sukusuku.money_feed;
  rec sukusuku.money_records;
  v_family uuid := sukusuku.current_family_id();
  v_out sukusuku.money_feed;
  v_in sukusuku.money_feed;
  v_record uuid;
  v_wallet uuid;
  v_learn boolean := coalesce((p_args ->> 'learn')::boolean, false);
  v_status text;
begin
  select * into f from sukusuku.money_feed where id = p_feed for update;
  if not found or f.family_id is distinct from v_family then
    raise exception 'not found';
  end if;
  if f.pair_id is not null then
    select * into g from sukusuku.money_feed where id = f.pair_id for update;
    if f.direction = 'out' then v_out := f; v_in := g; else v_out := g; v_in := f; end if;
  end if;

  if p_action = 'wallet' then
    v_wallet := (p_args ->> 'wallet_id')::uuid;
    if not exists (select 1 from sukusuku.money_wallets where id = v_wallet and family_id = v_family) then
      raise exception 'wallet not found';
    end if;
    if coalesce((p_args ->> 'remember')::boolean, false) and f.account_name is not null then
      update sukusuku.money_wallets set feed_name = null
       where family_id = v_family and id <> v_wallet and feed_name = f.account_name
         and (holder_zaim_email is null or f.to_email is null or lower(holder_zaim_email) = lower(f.to_email));
      update sukusuku.money_wallets
         set feed_name = f.account_name,
             holder_zaim_email = coalesce(holder_zaim_email, f.to_email)
       where id = v_wallet;
    end if;
    update sukusuku.money_feed set wallet_id = v_wallet, status = 'pending', candidate_record_ids = '{}' where id = f.id;
    return sukusuku.money_feed_process(f.id);
  end if;

  if f.direction is null or f.wallet_id is null then
    if p_action <> 'ignore' then
      raise exception 'wallet required';
    end if;
  end if;

  if p_action = 'link' then
    select * into rec from sukusuku.money_records where id = (p_args ->> 'record_id')::uuid and family_id = v_family;
    if not found then
      raise exception 'record not found';
    end if;
    if rec.is_estimate then
      perform sukusuku.money_feed_link(f.id, rec.id);
    else
      update sukusuku.money_records set feed_id = coalesce(feed_id, f.id) where id = rec.id;
      update sukusuku.money_feed set status = 'linked', record_id = rec.id, candidate_record_ids = '{}' where id = f.id;
    end if;
    if g.id is not null then
      if rec.kind = 'transfer' then
        update sukusuku.money_feed set status = 'linked', record_id = rec.id, candidate_record_ids = '{}' where id = g.id;
      else
        update sukusuku.money_feed set pair_id = null where id in (f.id, g.id);
        update sukusuku.money_feed set status = 'pending', candidate_record_ids = '{}' where id = g.id;
        perform sukusuku.money_feed_process(g.id);
      end if;
    end if;
    if v_learn then
      if rec.recurring_id is not null then
        perform sukusuku.money_feed_learn(f, 'link_recurring', p_recurring => rec.recurring_id);
      elsif rec.month is not null and rec.kind = 'transfer' then
        perform sukusuku.money_feed_learn(f, 'adjust_only');
      end if;
    end if;
    v_status := 'linked';

  elsif p_action = 'replace' then
    if g.id is null then
      raise exception 'pair required';
    end if;
    select * into rec from sukusuku.money_records where id = (p_args ->> 'record_id')::uuid and family_id = v_family;
    if not found or (select count(*) from sukusuku.money_items where record_id = rec.id) <> 1 then
      raise exception 'record not replaceable';
    end if;
    update sukusuku.money_records
       set kind = 'transfer', occurred_on = v_out.occurred_on, wallet_id = v_out.wallet_id, to_wallet_id = v_in.wallet_id,
           store = '', feed_id = v_out.id, is_estimate = false
     where id = rec.id;
    update sukusuku.money_items set amount = f.amount, category_id = null, category_name = '' where record_id = rec.id;
    update sukusuku.money_feed set status = 'linked', record_id = rec.id, candidate_record_ids = '{}' where id in (f.id, g.id);
    v_status := 'linked';

  elsif p_action = 'separate' then
    if g.id is not null then
      insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id, created_by)
      values (v_family, 'transfer', v_out.occurred_on, v_out.wallet_id, v_in.wallet_id, '', v_out.id, auth.uid())
      returning id into v_record;
      insert into sukusuku.money_items (family_id, record_id, amount) values (v_family, v_record, f.amount);
      update sukusuku.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id in (f.id, g.id);
      v_status := 'created';
    else
      update sukusuku.money_feed set status = 'pending', candidate_record_ids = '{}', skip_manual = true where id = f.id;
      return 'pending';
    end if;

  elsif p_action = 'record' then
    insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id, created_by)
    values (v_family, case f.direction when 'out' then 'expense' else 'income' end, f.occurred_on, f.wallet_id,
            btrim(coalesce(p_args ->> 'store', '')), f.id, auth.uid())
    returning id into v_record;
    insert into sukusuku.money_items (family_id, record_id, amount, category_id)
    values (v_family, v_record, f.amount, (p_args ->> 'category_id')::uuid);
    -- 「お店に登録して使う」を選んだときだけ、お店の設定に登録する（save_money_record と同じ。docs/kakei.md §3.5）
    if coalesce((p_args ->> 'register_store')::boolean, false) and btrim(coalesce(p_args ->> 'store', '')) <> '' then
      insert into sukusuku.money_stores (family_id, name)
      values (v_family, btrim(p_args ->> 'store'))
      on conflict (family_id, name) do update set archived_at = null;
    end if;
    update sukusuku.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id = f.id;
    if v_learn then
      perform sukusuku.money_feed_learn(f, 'record',
        p_record_kind => case f.direction when 'out' then 'expense' else 'income' end,
        p_category => (p_args ->> 'category_id')::uuid, p_store => btrim(coalesce(p_args ->> 'store', '')));
    end if;
    v_status := 'created';

  elsif p_action = 'transfer' then
    v_wallet := (p_args ->> 'to_wallet_id')::uuid;
    if not exists (select 1 from sukusuku.money_wallets where id = v_wallet and family_id = v_family) or v_wallet = f.wallet_id then
      raise exception 'wallet not found';
    end if;
    insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id, created_by)
    values (v_family, 'transfer', f.occurred_on,
            case f.direction when 'out' then f.wallet_id else v_wallet end,
            case f.direction when 'out' then v_wallet else f.wallet_id end, '', f.id, auth.uid())
    returning id into v_record;
    insert into sukusuku.money_items (family_id, record_id, amount) values (v_family, v_record, f.amount);
    update sukusuku.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id = f.id;
    if v_learn then
      perform sukusuku.money_feed_learn(f, 'transfer', p_to_wallet => v_wallet);
    end if;
    v_status := 'created';

  elsif p_action = 'ignore' then
    update sukusuku.money_feed set status = 'ignored', candidate_record_ids = '{}' where id = f.id;
    if v_learn and f.direction is not null then
      perform sukusuku.money_feed_learn(f, 'ignore');
    end if;
    v_status := 'ignored';

  else
    raise exception 'unknown action %', p_action;
  end if;

  update sukusuku.money_feed set resolved_by = auth.uid(), resolved_at = now() where id in (f.id, g.id);
  return v_status;
end;
$$;


--
-- Name: money_holdings_refresh_today(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_holdings_refresh_today() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if new.archived_at is null then
    perform sukusuku.refresh_money_holding_values(v_today, v_today, new.id);
  else
    -- 使わなくした（売った）保有は、その日から評価額 0 とする（前の日の行は残す）。
    insert into sukusuku.money_holding_values (family_id, holding_id, value_on, quantity, price, fx, value, cost)
    values (new.family_id, new.id, v_today, 0, 0, 1, 0, null)
    on conflict (holding_id, value_on) do update
       set quantity = 0, price = 0, fx = 1, value = 0, cost = null;
  end if;
  return new;
end;
$$;


--
-- Name: money_is_business_day(date); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_is_business_day(p_date date) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select extract(isodow from p_date) < 6
     and sukusuku.jp_holiday_name(p_date) is null
     and to_char(p_date, 'MM-DD') not in ('12-31', '01-01', '01-02', '01-03');
$$;


--
-- Name: money_items_check_record_total(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_items_check_record_total() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_record uuid := coalesce(new.record_id, old.record_id);
  v_total bigint;
begin
  select sum(amount) into v_total from sukusuku.money_items where record_id = v_record;
  if v_total is not null and v_total < 0 then
    raise exception 'the total of a record must not be negative';
  end if;
  return null;
end;
$$;


--
-- Name: money_holding_values; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_holding_values (
    family_id uuid NOT NULL,
    holding_id uuid NOT NULL,
    value_on date NOT NULL,
    quantity numeric NOT NULL,
    price numeric NOT NULL,
    fx numeric NOT NULL,
    value bigint NOT NULL,
    cost bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: money_latest_holding_values(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_latest_holding_values(p_family_id uuid) RETURNS SETOF sukusuku.money_holding_values
    LANGUAGE sql STABLE
    SET search_path TO 'sukusuku'
    AS $$
  select distinct on (holding_id) *
    from sukusuku.money_holding_values
   where family_id = p_family_id
     and value_on <= (now() at time zone 'Asia/Tokyo')::date
   order by holding_id, value_on desc;
$$;


--
-- Name: money_record_amount(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_record_amount(p_record uuid) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'sukusuku'
    AS $$
  select coalesce(sum(amount), 0)::integer from sukusuku.money_items where record_id = p_record;
$$;


--
-- Name: money_recurring; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_recurring (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    kind text DEFAULT 'expense'::text NOT NULL,
    day smallint NOT NULL,
    months smallint[],
    holiday text DEFAULT 'next'::text NOT NULL,
    amount_mode text DEFAULT 'estimate'::text NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    wallet_id uuid,
    to_wallet_id uuid,
    store text DEFAULT ''::text NOT NULL,
    category_id uuid,
    name text DEFAULT ''::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    made_through date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    week_of_month smallint,
    weekday smallint,
    start_month date,
    end_month date,
    makes_record boolean DEFAULT true NOT NULL,
    skipped_months text[] DEFAULT '{}'::text[] NOT NULL,
    interval_years smallint,
    day_known boolean DEFAULT true NOT NULL,
    deferred_until date,
    no_month boolean DEFAULT false NOT NULL,
    CONSTRAINT money_recurring_amount_check CHECK ((amount >= 0)),
    CONSTRAINT money_recurring_amount_mode_check CHECK ((amount_mode = ANY (ARRAY['fixed'::text, 'estimate'::text]))),
    CONSTRAINT money_recurring_day_check CHECK (((day >= 1) AND (day <= 31))),
    CONSTRAINT money_recurring_day_known_check CHECK ((day_known OR (NOT makes_record))),
    CONSTRAINT money_recurring_holiday_check CHECK ((holiday = ANY (ARRAY['next'::text, 'prev'::text, 'none'::text]))),
    CONSTRAINT money_recurring_interval_check CHECK (((interval_years IS NULL) OR (((interval_years >= 2) AND (interval_years <= 10)) AND (start_month IS NOT NULL)))),
    CONSTRAINT money_recurring_kind_check CHECK ((kind = ANY (ARRAY['expense'::text, 'income'::text, 'transfer'::text]))),
    CONSTRAINT money_recurring_months_check CHECK (((months IS NULL) OR ((cardinality(months) > 0) AND (months <@ ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint, (7)::smallint, (8)::smallint, (9)::smallint, (10)::smallint, (11)::smallint, (12)::smallint])))),
    CONSTRAINT money_recurring_no_month_check CHECK (((NOT no_month) OR ((months IS NULL) AND (NOT makes_record)))),
    CONSTRAINT money_recurring_period_check CHECK ((((start_month IS NULL) OR (EXTRACT(day FROM start_month) = (1)::numeric)) AND ((end_month IS NULL) OR (EXTRACT(day FROM end_month) = (1)::numeric)) AND ((start_month IS NULL) OR (end_month IS NULL) OR (start_month <= end_month)))),
    CONSTRAINT money_recurring_week_of_month_check CHECK (((week_of_month IS NULL) OR ((week_of_month >= 1) AND (week_of_month <= 5)))),
    CONSTRAINT money_recurring_weekday_check CHECK (((weekday IS NULL) OR ((weekday >= 0) AND (weekday <= 6)))),
    CONSTRAINT money_recurring_weekday_pair_check CHECK (((week_of_month IS NULL) = (weekday IS NULL)))
);


--
-- Name: money_recurring_estimate(sukusuku.money_recurring, date, date); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_recurring_estimate(p_rule sukusuku.money_recurring, p_month date, p_on date) RETURNS integer
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_last_year date := sukusuku.money_shift_business_day(
    sukusuku.money_rule_date((p_month - interval '1 year')::date, p_rule.day, p_rule.week_of_month, p_rule.weekday), p_rule.holiday);
  v_amount integer;
begin
  with matched as (
    select record.occurred_on, sum(item.amount)::integer as amount
      from sukusuku.money_records as record
      join sukusuku.money_items as item on item.record_id = record.id
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
$$;


--
-- Name: money_rule_date(date, integer, integer, integer); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_rule_date(p_month date, p_day integer, p_week integer, p_weekday integer) RETURNS date
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when p_week is null or p_weekday is null then sukusuku.money_day_of_month(p_month, p_day)
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


--
-- Name: money_shift_business_day(date, text); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_shift_business_day(p_date date, p_holiday text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  v_date date := p_date;
begin
  if p_holiday not in ('next', 'prev') then
    return v_date;
  end if;
  while not sukusuku.money_is_business_day(v_date) loop
    v_date := v_date + case when p_holiday = 'next' then 1 else -1 end;
  end loop;
  return v_date;
end;
$$;


--
-- Name: money_stores_set_position(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_stores_set_position() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sukusuku'
    AS $$
begin
  new.position := coalesce(
    (select max(s.position) + 1 from sukusuku.money_stores s where s.family_id = new.family_id),
    0
  );
  return new;
end;
$$;


--
-- Name: money_wallets_card_start(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.money_wallets_card_start() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_this_month date := date_trunc('month', v_today)::date;
begin
  if new.close_day is null or new.pay_day is null or new.pay_wallet_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.close_day is not null and old.pay_day is not null and old.pay_wallet_id is not null then
    return new;
  end if;
  new.card_made_through := case
    when sukusuku.money_shift_business_day(sukusuku.money_day_of_month(v_this_month, new.pay_day), 'next') < v_today
      then v_this_month
    else (v_this_month - interval '1 month')::date
  end;
  return new;
end;
$$;


--
-- Name: my_member_id(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.my_member_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  select id from sukusuku.family_members where user_id = auth.uid();
$$;


--
-- Name: push_subscription_family_id(uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.push_subscription_family_id(subscription uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
  select family_id from sukusuku.push_subscriptions where id = subscription;
$$;


--
-- Name: redeem_member_invite(text); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.redeem_member_invite(p_code text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  normalized text := lower(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  invite_row sukusuku.member_invites;
  member_row sukusuku.family_members;
  my_family uuid;
begin
  if auth.uid() is null then
    raise exception '参加するにはログインが必要です';
  end if;

  select family_id into my_family from sukusuku.users where id = auth.uid();
  if not found then
    raise exception 'アカウントの情報が見つかりません';
  end if;
  if my_family is not null then
    raise exception 'すでに家族に参加しています';
  end if;

  select * into invite_row
    from sukusuku.member_invites
   where code_hash = encode(sha256(convert_to(normalized, 'UTF8')), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then
    raise exception '招待コードが正しくないか、期限が切れています';
  end if;

  select * into member_row from sukusuku.family_members where id = invite_row.member_id for update;
  if not found or member_row.user_id is not null then
    raise exception '招待コードが正しくないか、期限が切れています';
  end if;

  update sukusuku.users set family_id = member_row.family_id where id = auth.uid();
  perform set_config('sukusuku.member_link', 'on', true);
  update sukusuku.family_members set user_id = auth.uid() where id = member_row.id;
  perform set_config('sukusuku.member_link', 'off', true);
  update sukusuku.member_invites set used_at = now() where id = invite_row.id;

  return member_row.family_id;
end;
$$;


--
-- Name: refresh_money_holding_values(date, date, uuid); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.refresh_money_holding_values(p_from date, p_to date, p_holding_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_count integer;
begin
  insert into sukusuku.money_holding_values as hv
    (family_id, holding_id, value_on, quantity, price, fx, value, cost)
  select h.family_id, h.id, d.day::date, h.quantity, p.price, coalesce(fx.rate, 1),
         round(h.quantity * p.price * coalesce(fx.rate, 1) / u.unit)::bigint,
         case when h.cost_price is null then null else round(h.quantity * h.cost_price / u.unit)::bigint end
    from sukusuku.money_holdings h
    join sukusuku.money_securities s on s.id = h.security_id
    cross join generate_series(p_from, p_to, interval '1 day') as d(day)
    cross join lateral (select case when s.kind = 'jp_fund' then 10000 else 1 end as unit) u
    cross join lateral (
      select case when s.kind = 'cash' then 1::numeric else (
        select sp.price from sukusuku.money_security_prices sp
         where sp.security_id = s.id and sp.price_on <= d.day::date
         order by sp.price_on desc limit 1
      ) end as price
    ) p
    left join lateral (
      select r.rate from sukusuku.money_fx_rates r
       where s.currency <> 'JPY' and r.currency = s.currency and r.rate_on <= d.day::date
       order by r.rate_on desc limit 1
    ) fx on true
   where h.archived_at is null
     and s.archived_at is null
     and (p_holding_id is null or h.id = p_holding_id)
     and p.price is not null
     and (s.currency = 'JPY' or fx.rate is not null)
  on conflict (holding_id, value_on) do update
     set quantity = excluded.quantity, price = excluded.price, fx = excluded.fx,
         value = excluded.value, cost = excluded.cost
   where hv.value_on = p_to;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: rename_member_in_tasks(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.rename_member_in_tasks() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
begin
  if new.display_name is distinct from old.display_name then
    update sukusuku.tasks
       set participants = array_replace(participants, old.display_name, new.display_name),
           owner = case when owner = old.display_name then new.display_name else owner end
     where family_id = new.family_id
       and (old.display_name = any (participants) or owner = old.display_name);
  end if;
  return new;
end;
$$;


--
-- Name: request_money_month_close(date); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.request_money_month_close(p_month date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_family uuid := sukusuku.current_family_id();
  v_members integer;
  v_pressed integer;
  v_started boolean := false;
begin
  if v_family is null or auth.uid() is null then
    raise exception 'not in a family';
  end if;
  if extract(day from p_month) <> 1 then
    raise exception 'month must be the first day';
  end if;

  insert into sukusuku.money_month_requests (family_id, month, user_id, requested_at)
  values (v_family, p_month, auth.uid(), now())
  on conflict (family_id, month, user_id) do update set requested_at = excluded.requested_at;

  select count(*) into v_members
    from sukusuku.family_members fm
   where fm.family_id = v_family and fm.user_id is not null and fm.is_guardian;

  select count(*) into v_pressed
    from sukusuku.money_month_requests r
   where r.family_id = v_family and r.month = p_month
     and r.requested_at is not null and r.requested_at >= now() - interval '5 minutes'
     and exists (select 1 from sukusuku.family_members fm
                  where fm.family_id = v_family and fm.user_id = r.user_id and fm.is_guardian);

  if v_pressed >= greatest(v_members, 1) then
    insert into sukusuku.money_months (family_id, month, close_started_at)
    values (v_family, p_month, now())
    on conflict (family_id, month) do update set close_started_at = now();
    -- 次に締めるときに、今回の合図を数えないよう空にする
    update sukusuku.money_month_requests
       set requested_at = null
     where family_id = v_family and month = p_month;
    v_started := true;
  end if;

  return jsonb_build_object('started', v_started, 'server_now', now());
end;
$$;


--
-- Name: save_money_record(jsonb, jsonb); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.save_money_record(p_record jsonb, p_items jsonb) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_family uuid := sukusuku.current_family_id();
  v_id uuid := nullif(p_record ->> 'id', '')::uuid;
  v_store text := btrim(coalesce(p_record ->> 'store', ''));
  v_estimate boolean := coalesce((p_record ->> 'is_estimate')::boolean, false);
  v_register boolean := coalesce((p_record ->> 'register_store')::boolean, false);
  v_receipt_store text := nullif(btrim(coalesce(p_record ->> 'receipt_store', '')), '');
begin
  if v_family is null then
    raise exception 'no family';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a record needs at least one item';
  end if;

  if v_id is null then
    insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, created_by, is_estimate, receipt_store)
    values (
      v_family,
      p_record ->> 'kind',
      (p_record ->> 'occurred_on')::date,
      nullif(p_record ->> 'wallet_id', '')::uuid,
      nullif(p_record ->> 'to_wallet_id', '')::uuid,
      coalesce(p_record ->> 'store', ''),
      (select auth.uid()),
      v_estimate,
      v_receipt_store
    )
    returning id into v_id;
  else
    -- 表記は、読み取りで入れた記録を直すときにも残す（送られてこなければ今のまま）。
    update sukusuku.money_records
      set kind = p_record ->> 'kind',
          occurred_on = (p_record ->> 'occurred_on')::date,
          wallet_id = nullif(p_record ->> 'wallet_id', '')::uuid,
          to_wallet_id = nullif(p_record ->> 'to_wallet_id', '')::uuid,
          store = coalesce(p_record ->> 'store', ''),
          is_estimate = v_estimate,
          receipt_store = coalesce(v_receipt_store, receipt_store)
      where id = v_id;
    if not found then
      raise exception 'record not found';
    end if;
    delete from sukusuku.money_items where record_id = v_id;
  end if;

  -- 「お店に登録して使う」を選んだときだけ、お店の設定に登録する（使わなくしていれば、また使えるようにする）。
  if v_store <> '' and v_register then
    insert into sukusuku.money_stores (family_id, name)
    values (v_family, v_store)
    on conflict (family_id, name) do update set archived_at = null;
  end if;

  insert into sukusuku.money_items (
    family_id, record_id, amount, category_id, category_name,
    quantity, unit_price, name, memo, position, receipt_name
  )
  select
    v_family,
    v_id,
    (item ->> 'amount')::integer,
    nullif(item ->> 'category_id', '')::uuid,
    -- 削除したカテゴリの名前。カテゴリを選んでいる品目では持たない。
    case when nullif(item ->> 'category_id', '') is null then coalesce(item ->> 'category_name', '') else '' end,
    coalesce((item ->> 'quantity')::integer, 1),
    (item ->> 'unit_price')::integer,
    coalesce(item ->> 'name', ''),
    coalesce(item ->> 'memo', ''),
    (ordinality - 1)::integer,
    nullif(btrim(coalesce(item ->> 'receipt_name', '')), '')
  from jsonb_array_elements(p_items) with ordinality as entries (item, ordinality);

  return v_id;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'sukusuku'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: subsidy_draws_after_insert(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.subsidy_draws_after_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
begin
  if new.push_coupon_id is not null then
    update sukusuku.lottery_coupons
       set used_at = new.drawn_at, used_draw_id = new.id
     where id = new.push_coupon_id;
  end if;
  if new.rate = 25 and new.drawn_by is not null then
    insert into sukusuku.lottery_coupons (family_id, owner_id, kind, source_draw_id, obtained_at, is_test)
    values (new.family_id, new.drawn_by, 'push', new.id, new.drawn_at, new.is_test);
  end if;
  return new;
end;
$$;


--
-- Name: subsidy_draws_before_insert(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.subsidy_draws_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  used integer;
begin
  new.drawn_at := now();
  new.rate_up_used := false;
  if not new.is_test then
    -- 同じ人の同時の複数回を並べて通さない。
    perform pg_advisory_xact_lock(hashtext('subsidy_draws:' || coalesce(new.drawn_by::text, '')));
    select count(*) into used
    from sukusuku.subsidy_draws
    where drawn_by is not distinct from new.drawn_by
      and not is_test
      and date_trunc('month', timezone('Asia/Tokyo', drawn_at)) = date_trunc('month', timezone('Asia/Tokyo', new.drawn_at));
    if used >= sukusuku.lottery_monthly_allowance(new.drawn_by, new.drawn_at) then
      raise exception '今月の補助くじの回数を使い切っています' using errcode = 'check_violation';
    end if;
  end if;
  if new.push_coupon_id is not null then
    perform 1 from sukusuku.lottery_coupons c
     where c.id = new.push_coupon_id
       and c.owner_id = new.drawn_by
       and c.is_test = new.is_test
       and c.kind = 'push'
       and c.used_at is null
       and (c.expires_at is null or c.expires_at > new.drawn_at)
     for update;
    if not found then
      raise exception 'ひと押し券が使えません' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: subsidy_draws_to_money(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.subsidy_draws_to_money() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
declare
  v_category uuid;
  v_wallet uuid;
  v_record uuid;
begin
  if new.is_test or new.rate >= 100 or new.subsidy <= 0 then
    return null;
  end if;

  select c.id into v_category
    from sukusuku.money_categories c
    join sukusuku.money_categories p on p.id = c.parent_id and p.family_id = c.family_id
   where c.family_id = new.family_id
     and p.name = 'その他'
     and c.name in ('お小遣い・補助', 'お小遣い')
   order by (c.name = 'お小遣い・補助') desc, c.position
   limit 1;
  if v_category is null then
    return null;
  end if;

  select w.id into v_wallet
    from sukusuku.money_wallets w
   where w.family_id = new.family_id and w.type = 'cash' and w.archived_at is null
   order by w.position
   limit 1;

  insert into sukusuku.money_records (family_id, kind, occurred_on, wallet_id, store, created_by, draw_id)
  values (
    new.family_id,
    'expense',
    (new.drawn_at at time zone 'Asia/Tokyo')::date,
    v_wallet,
    '福引チャンス',
    new.drawn_by,
    new.id
  )
  returning id into v_record;

  insert into sukusuku.money_items (family_id, record_id, amount, category_id, quantity, name, memo, position)
  values (
    new.family_id,
    v_record,
    new.subsidy,
    v_category,
    1,
    coalesce(nullif(btrim(new.item_name), ''), '福引の補助'),
    '福引チャンス 補助率' || new.rate || '%（税込' || new.price || '円）',
    0
  );
  return null;
end;
$$;


--
-- Name: subsidy_draws_to_money_update(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.subsidy_draws_to_money_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $$
begin
  update sukusuku.money_items i
     set amount = new.subsidy,
         memo = '福引チャンス 補助率' || new.rate || '%（税込' || new.price || '円）'
    from sukusuku.money_records r
   where r.draw_id = new.id
     and i.record_id = r.id
     and i.family_id = r.family_id
     and (select count(*) from sukusuku.money_items x where x.record_id = r.id) = 1;
  return null;
end;
$$;


--
-- Name: touch_family_sync(); Type: FUNCTION; Schema: sukusuku; Owner: -
--

CREATE FUNCTION sukusuku.touch_family_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'sukusuku'
    AS $_$
declare
  rows_name text;
  resolver text;
begin
  rows_name := case when tg_op in ('INSERT', 'UPDATE') then 'new_rows' else 'old_rows' end;
  resolver := replace(tg_argv[0], '%rows%', rows_name);
  execute format(
    $q$
    insert into sukusuku.family_sync (family_id, changed, updated_at)
    select f.fid,
           jsonb_build_object(%L, to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
           now()
    from (select distinct r.fid from (%s) as r(fid) where r.fid is not null) as f
    on conflict (family_id) do update
      set changed = sukusuku.family_sync.changed || excluded.changed,
          updated_at = excluded.updated_at
    $q$,
    tg_table_name,
    resolver
  );
  return null;
end;
$_$;


--
-- Name: care_logs; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.care_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    type text NOT NULL,
    amount text DEFAULT ''::text,
    logged_at timestamp with time zone DEFAULT now() NOT NULL,
    note text DEFAULT ''::text,
    created_by uuid,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT care_logs_type_check CHECK ((type = ANY (ARRAY['milk'::text, 'diaper'::text, 'sleep'::text, 'pumping'::text, 'temperature'::text, 'spitup'::text])))
);


--
-- Name: children; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.children (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    name text,
    birth_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    member_id uuid
);


--
-- Name: contract_deliveries; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.contract_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    notify_on date NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    CONSTRAINT contract_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: contract_fields; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.contract_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    label text NOT NULL,
    value text DEFAULT ''::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contract_fields_label_check CHECK ((label <> ''::text))
);


--
-- Name: contracts; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    created_by uuid,
    kind text NOT NULL,
    title text NOT NULL,
    company text DEFAULT ''::text NOT NULL,
    contractor_id uuid,
    started_on date,
    renews_on date,
    term_months integer,
    amount integer,
    amount_cycle text,
    notify_days integer[] DEFAULT '{30,7,1}'::integer[] NOT NULL,
    memo text DEFAULT ''::text NOT NULL,
    visible_member_ids uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notify_after date,
    CONSTRAINT contracts_amount_check CHECK (((amount IS NULL) OR (amount >= 0))),
    CONSTRAINT contracts_amount_cycle_check CHECK ((amount_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text, 'once'::text]))),
    CONSTRAINT contracts_amount_cycle_pair CHECK (((amount IS NULL) = (amount_cycle IS NULL))),
    CONSTRAINT contracts_kind_check CHECK ((kind = ANY (ARRAY['rent'::text, 'insurance'::text, 'subscription'::text, 'other'::text]))),
    CONSTRAINT contracts_term_months_check CHECK (((term_months IS NULL) OR (term_months > 0))),
    CONSTRAINT contracts_title_check CHECK ((title <> ''::text)),
    CONSTRAINT contracts_visible_member_ids_check CHECK ((cardinality(visible_member_ids) > 0))
);


--
-- Name: documents; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    title text NOT NULL,
    file_url text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: families; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.families (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    postal_code text DEFAULT ''::text NOT NULL,
    address text DEFAULT ''::text NOT NULL,
    home_phone text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stock_people smallint DEFAULT 3 NOT NULL,
    stock_days smallint DEFAULT 7 NOT NULL,
    stock_carry_days smallint DEFAULT 1 NOT NULL,
    CONSTRAINT families_stock_carry_days_check CHECK (((stock_carry_days >= 1) AND (stock_carry_days <= 7))),
    CONSTRAINT families_stock_days_check CHECK (((stock_days >= 1) AND (stock_days <= 60))),
    CONSTRAINT families_stock_people_check CHECK (((stock_people >= 1) AND (stock_people <= 20)))
);


--
-- Name: family_members; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.family_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    user_id uuid,
    relation text NOT NULL,
    is_guardian boolean DEFAULT false NOT NULL,
    display_name text NOT NULL,
    family_name text DEFAULT ''::text NOT NULL,
    given_name text DEFAULT ''::text NOT NULL,
    family_name_kana text DEFAULT ''::text NOT NULL,
    given_name_kana text DEFAULT ''::text NOT NULL,
    birth_date date,
    phone text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    workplace text DEFAULT ''::text NOT NULL,
    workplace_phone text DEFAULT ''::text NOT NULL,
    color text DEFAULT 'gray'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT family_members_color_check CHECK ((color = ANY (ARRAY['blue'::text, 'pink'::text, 'emerald'::text, 'gray'::text]))),
    CONSTRAINT family_members_display_name_not_blank CHECK ((btrim(display_name) <> ''::text)),
    CONSTRAINT family_members_relation_check CHECK ((relation = ANY (ARRAY['husband'::text, 'wife'::text, 'child'::text])))
);


--
-- Name: family_sync; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.family_sync (
    family_id uuid NOT NULL,
    changed jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feeding_reminder_deliveries; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.feeding_reminder_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    care_log_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    CONSTRAINT feeding_reminder_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: feeding_settings; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.feeding_settings (
    family_id uuid NOT NULL,
    interval_minutes integer DEFAULT 180 NOT NULL,
    notify_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feeding_settings_interval_minutes_check CHECK (((interval_minutes >= 30) AND (interval_minutes <= 480)))
);


--
-- Name: gifts; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.gifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    sender_name text NOT NULL,
    received_item text DEFAULT ''::text,
    received_date date,
    return_status text DEFAULT '未完了'::text NOT NULL,
    return_item text DEFAULT ''::text,
    note text DEFAULT ''::text,
    CONSTRAINT gifts_return_status_check CHECK ((return_status = ANY (ARRAY['未完了'::text, '済'::text, '不要'::text])))
);


--
-- Name: growth_records; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.growth_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    child_id uuid NOT NULL,
    recorded_date date DEFAULT CURRENT_DATE NOT NULL,
    month_age integer,
    height numeric(6,2),
    weight numeric(6,2)
);


--
-- Name: list_groups; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.list_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    list_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: list_items; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.list_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    list_id uuid NOT NULL,
    group_id uuid,
    title text NOT NULL,
    is_done boolean DEFAULT false NOT NULL,
    done_at timestamp with time zone,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lists; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    name text NOT NULL,
    group_label text DEFAULT 'グループ'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    created_by uuid,
    is_private boolean DEFAULT false NOT NULL
);


--
-- Name: member_invites; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.member_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: money_amazon_lines; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_amazon_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    order_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    receipt_name text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price integer NOT NULL,
    amount integer NOT NULL,
    category_id uuid,
    feed_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_amazon_lines_amount_check CHECK ((amount >= 0)),
    CONSTRAINT money_amazon_lines_quantity_check CHECK (((quantity >= 1) AND (quantity <= 9999))),
    CONSTRAINT money_amazon_lines_unit_price_check CHECK ((unit_price >= 0))
);


--
-- Name: money_amazon_orders; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_amazon_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    order_no text NOT NULL,
    source_id text NOT NULL,
    ordered_on date NOT NULL,
    total integer NOT NULL,
    adjust integer DEFAULT 0 NOT NULL,
    adjust_feed_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    discount_used integer DEFAULT 0 NOT NULL,
    CONSTRAINT money_amazon_orders_discount_used_check CHECK ((discount_used >= 0)),
    CONSTRAINT money_amazon_orders_total_check CHECK ((total > 0))
);


--
-- Name: money_amazon_shipment_lines; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_amazon_shipment_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    shipment_id uuid NOT NULL,
    "position" integer NOT NULL,
    order_no text NOT NULL,
    receipt_name text NOT NULL,
    quantity integer NOT NULL,
    line_id uuid,
    amount integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_amazon_shipment_lines_amount_check CHECK ((amount >= 0)),
    CONSTRAINT money_amazon_shipment_lines_quantity_check CHECK (((quantity >= 1) AND (quantity <= 9999)))
);


--
-- Name: money_amazon_shipments; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_amazon_shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    source_id text NOT NULL,
    received_at timestamp with time zone NOT NULL,
    shipped_on date NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    feed_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: money_categories; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    kind text DEFAULT 'living'::text NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    icon text,
    icon_color text,
    budget_group text,
    temporary boolean DEFAULT false NOT NULL,
    CONSTRAINT money_categories_budget_group_check CHECK (((budget_group IS NULL) OR (budget_group = ANY (ARRAY['variable'::text, 'reserve'::text, 'fixed'::text, 'estimate'::text])))),
    CONSTRAINT money_categories_icon_check CHECK (((icon IS NULL) OR (char_length(icon) <= 40))),
    CONSTRAINT money_categories_icon_color_check CHECK (((icon_color IS NULL) OR (icon_color ~ '^#[0-9a-f]{6}$'::text))),
    CONSTRAINT money_categories_kind_check CHECK ((kind = ANY (ARRAY['living'::text, 'income'::text])))
);


--
-- Name: money_feed_mails; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_feed_mails (
    family_id uuid NOT NULL,
    message_id text NOT NULL,
    received_at timestamp with time zone NOT NULL,
    outcome text NOT NULL,
    label text,
    trashed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tag text,
    CONSTRAINT money_feed_mails_label_check CHECK ((label = ANY (ARRAY['open'::text, 'done'::text, 'skipped'::text, 'unreadable'::text]))),
    CONSTRAINT money_feed_mails_outcome_check CHECK ((outcome = ANY (ARRAY['feed'::text, 'order'::text, 'skipped'::text, 'unreadable'::text, 'before_start'::text]))),
    CONSTRAINT money_feed_mails_tag_check CHECK ((tag = ANY (ARRAY['olive_credit'::text, 'olive_debit'::text, 'amazon'::text, 'skipped'::text])))
);


--
-- Name: money_feed_rules; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_feed_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    wallet_id uuid,
    direction text,
    match text DEFAULT 'contains'::text NOT NULL,
    pattern text DEFAULT ''::text NOT NULL,
    amount_min integer,
    amount_max integer,
    action text NOT NULL,
    record_kind text,
    category_id uuid,
    store text DEFAULT ''::text NOT NULL,
    to_wallet_id uuid,
    recurring_id uuid,
    learned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_feed_rules_action_check CHECK ((action = ANY (ARRAY['record'::text, 'transfer'::text, 'link_recurring'::text, 'adjust_only'::text, 'ignore'::text]))),
    CONSTRAINT money_feed_rules_action_fields_check CHECK ((((action = 'record'::text) AND (record_kind IS NOT NULL)) OR ((action = 'transfer'::text) AND (to_wallet_id IS NOT NULL)) OR ((action = 'link_recurring'::text) AND (recurring_id IS NOT NULL)) OR (action = ANY (ARRAY['adjust_only'::text, 'ignore'::text])))),
    CONSTRAINT money_feed_rules_amount_max_check CHECK (((amount_max IS NULL) OR (amount_max >= 0))),
    CONSTRAINT money_feed_rules_amount_min_check CHECK (((amount_min IS NULL) OR (amount_min >= 0))),
    CONSTRAINT money_feed_rules_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
    CONSTRAINT money_feed_rules_match_check CHECK ((match = ANY (ARRAY['contains'::text, 'key'::text]))),
    CONSTRAINT money_feed_rules_record_kind_check CHECK ((record_kind = ANY (ARRAY['expense'::text, 'income'::text])))
);


--
-- Name: money_feed_settings; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_feed_settings (
    family_id uuid NOT NULL,
    start_at timestamp with time zone DEFAULT now() NOT NULL,
    pair_days integer DEFAULT 3 NOT NULL,
    estimate_days integer DEFAULT 5 NOT NULL,
    manual_days integer DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_feed_settings_estimate_days_check CHECK (((estimate_days >= 0) AND (estimate_days <= 14))),
    CONSTRAINT money_feed_settings_manual_days_check CHECK (((manual_days >= 0) AND (manual_days <= 14))),
    CONSTRAINT money_feed_settings_pair_days_check CHECK (((pair_days >= 0) AND (pair_days <= 14)))
);


--
-- Name: money_feed_tokens; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_feed_tokens (
    family_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    last_sync_at timestamp with time zone
);


--
-- Name: money_fx_rates; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_fx_rates (
    currency text NOT NULL,
    rate_on date NOT NULL,
    rate numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_fx_rates_currency_check CHECK ((currency = 'USD'::text)),
    CONSTRAINT money_fx_rates_rate_check CHECK ((rate > (0)::numeric))
);


--
-- Name: money_holdings; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_holdings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    wallet_id uuid NOT NULL,
    security_id uuid NOT NULL,
    account text DEFAULT 'tokutei'::text NOT NULL,
    quantity numeric DEFAULT 0 NOT NULL,
    cost_price numeric,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_holdings_account_check CHECK ((account = ANY (ARRAY['nisa'::text, 'nisa_tsumitate'::text, 'tokutei'::text, 'ippan'::text]))),
    CONSTRAINT money_holdings_cost_price_check CHECK (((cost_price IS NULL) OR (cost_price >= (0)::numeric))),
    CONSTRAINT money_holdings_quantity_check CHECK ((quantity >= (0)::numeric))
);


--
-- Name: money_items; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    record_id uuid NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    category_id uuid,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price integer,
    name text DEFAULT ''::text NOT NULL,
    memo text DEFAULT ''::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category_name text DEFAULT ''::text NOT NULL,
    receipt_name text,
    CONSTRAINT money_items_quantity_check CHECK (((quantity >= 1) AND (quantity <= 9999)))
);


--
-- Name: money_month_requests; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_month_requests (
    family_id uuid NOT NULL,
    month date NOT NULL,
    user_id uuid NOT NULL,
    requested_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_month_requests_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric))
);


--
-- Name: money_month_wallet_checks; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_month_wallet_checks (
    family_id uuid NOT NULL,
    month date NOT NULL,
    wallet_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_month_wallet_checks_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric))
);


--
-- Name: money_months; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_months (
    family_id uuid NOT NULL,
    month date NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    close_started_at timestamp with time zone,
    CONSTRAINT money_months_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric))
);


--
-- Name: money_ratio_targets; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_ratio_targets (
    family_id uuid NOT NULL,
    budget_group text NOT NULL,
    percent smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_ratio_targets_budget_group_check CHECK ((budget_group = ANY (ARRAY['variable'::text, 'reserve'::text, 'fixed'::text]))),
    CONSTRAINT money_ratio_targets_percent_check CHECK (((percent >= 0) AND (percent <= 100)))
);


--
-- Name: money_receipt_scans; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_receipt_scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    created_by uuid,
    images integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_receipt_scans_images_check CHECK ((images >= 1))
);


--
-- Name: money_records; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    kind text DEFAULT 'expense'::text NOT NULL,
    occurred_on date NOT NULL,
    wallet_id uuid,
    to_wallet_id uuid,
    store text DEFAULT ''::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_estimate boolean DEFAULT false NOT NULL,
    recurring_id uuid,
    month date,
    feed_id uuid,
    receipt_store text,
    draw_id uuid,
    card_next_period boolean DEFAULT false NOT NULL,
    checked_at timestamp with time zone,
    CONSTRAINT money_records_kind_check CHECK ((kind = ANY (ARRAY['expense'::text, 'income'::text, 'transfer'::text])))
);


--
-- Name: money_securities; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_securities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    code text,
    fund_code text,
    currency text DEFAULT 'JPY'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_securities_code_check CHECK (((kind = 'cash'::text) OR (code IS NOT NULL))),
    CONSTRAINT money_securities_currency_check CHECK ((currency = ANY (ARRAY['JPY'::text, 'USD'::text]))),
    CONSTRAINT money_securities_fund_code_check CHECK (((kind <> 'jp_fund'::text) OR (fund_code IS NOT NULL))),
    CONSTRAINT money_securities_kind_check CHECK ((kind = ANY (ARRAY['us_stock'::text, 'jp_fund'::text, 'cash'::text])))
);


--
-- Name: money_security_prices; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_security_prices (
    family_id uuid NOT NULL,
    security_id uuid NOT NULL,
    price_on date NOT NULL,
    price numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT money_security_prices_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: money_stores; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_stores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    name text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT money_stores_name_check CHECK ((char_length(btrim(name)) > 0))
);


--
-- Name: money_wallet_balances; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_wallet_balances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    wallet_id uuid NOT NULL,
    balance_on date NOT NULL,
    amount integer NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    show_in_history boolean DEFAULT true NOT NULL,
    adjustment integer DEFAULT 0 NOT NULL
);


--
-- Name: money_wallets; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.money_wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'cash'::text NOT NULL,
    is_saving boolean DEFAULT false NOT NULL,
    saving_target integer,
    "position" integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    close_day smallint,
    pay_day smallint,
    pay_wallet_id uuid,
    card_made_through date,
    icon_color text,
    pay_month_offset smallint,
    feed_name text,
    holder_name text,
    holder_zaim_email text,
    holder_kana text,
    CONSTRAINT money_wallets_close_day_check CHECK (((close_day IS NULL) OR ((close_day >= 1) AND (close_day <= 31)))),
    CONSTRAINT money_wallets_icon_color_check CHECK (((icon_color IS NULL) OR (icon_color ~ '^#[0-9a-f]{6}$'::text))),
    CONSTRAINT money_wallets_pay_day_check CHECK (((pay_day IS NULL) OR ((pay_day >= 1) AND (pay_day <= 31)))),
    CONSTRAINT money_wallets_pay_month_offset_check CHECK (((pay_month_offset IS NULL) OR ((pay_month_offset >= 1) AND (pay_month_offset <= 3)))),
    CONSTRAINT money_wallets_saving_target_check CHECK (((saving_target IS NULL) OR (saving_target >= 0))),
    CONSTRAINT money_wallets_type_check CHECK ((type = ANY (ARRAY['card'::text, 'cash'::text, 'bank'::text, 'prepaid'::text, 'qr'::text, 'securities'::text])))
);


--
-- Name: next_feeding_schedule; Type: VIEW; Schema: sukusuku; Owner: -
--

CREATE VIEW sukusuku.next_feeding_schedule WITH (security_invoker='on') AS
 SELECT latest.family_id,
    latest.care_log_id,
    latest.last_fed_at,
    COALESCE(s.interval_minutes, 180) AS interval_minutes,
    (latest.last_fed_at + make_interval(mins => COALESCE(s.interval_minutes, 180))) AS due_at
   FROM (( SELECT DISTINCT ON (c.family_id) c.family_id,
            c.id AS care_log_id,
            c.logged_at AS last_fed_at
           FROM sukusuku.care_logs c
          WHERE (c.type = 'milk'::text)
          ORDER BY c.family_id, c.logged_at DESC) latest
     LEFT JOIN sukusuku.feeding_settings s ON ((s.family_id = latest.family_id)))
  WHERE COALESCE(s.notify_enabled, true);


--
-- Name: nurseries; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.nurseries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT '未見学'::text NOT NULL,
    phone text DEFAULT ''::text,
    memo text DEFAULT ''::text,
    checklist jsonb DEFAULT '{}'::jsonb NOT NULL,
    address text DEFAULT ''::text,
    visit_date date,
    visit_time text,
    CONSTRAINT nurseries_status_check CHECK ((status = ANY (ARRAY['未見学'::text, '見学予約済'::text, '見学済'::text])))
);


--
-- Name: nursing_alarms; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.nursing_alarms (
    subscription_id uuid NOT NULL,
    user_id uuid NOT NULL,
    side text NOT NULL,
    baseline_at timestamp with time zone NOT NULL,
    interval_minutes integer NOT NULL,
    notified_step integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stopped_at timestamp with time zone,
    CONSTRAINT nursing_alarms_interval_minutes_check CHECK (((interval_minutes >= 1) AND (interval_minutes <= 60))),
    CONSTRAINT nursing_alarms_notified_step_check CHECK ((notified_step >= 0)),
    CONSTRAINT nursing_alarms_side_check CHECK ((side = ANY (ARRAY['left'::text, 'right'::text, 'burp'::text])))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text DEFAULT ''::text NOT NULL,
    auth text DEFAULT ''::text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_success_at timestamp with time zone,
    failure_count integer DEFAULT 0 NOT NULL,
    kind text DEFAULT 'webpush'::text NOT NULL,
    feeding_quiet_start smallint,
    feeding_quiet_end smallint,
    wake_alarm_enabled boolean DEFAULT false NOT NULL,
    wake_quiet_start smallint,
    wake_quiet_end smallint,
    wake_synced_trigger_at timestamp with time zone,
    wake_synced_due_at timestamp with time zone,
    CONSTRAINT push_subscriptions_feeding_quiet_check CHECK ((((feeding_quiet_start IS NULL) AND (feeding_quiet_end IS NULL)) OR (((feeding_quiet_start >= 0) AND (feeding_quiet_start <= 1439)) AND ((feeding_quiet_end >= 0) AND (feeding_quiet_end <= 1439))))),
    CONSTRAINT push_subscriptions_kind_check CHECK ((kind = ANY (ARRAY['webpush'::text, 'fcm'::text]))),
    CONSTRAINT push_subscriptions_wake_quiet_check CHECK ((((wake_quiet_start IS NULL) AND (wake_quiet_end IS NULL)) OR (((wake_quiet_start >= 0) AND (wake_quiet_start <= 1439)) AND ((wake_quiet_end >= 0) AND (wake_quiet_end <= 1439)))))
);


--
-- Name: reminder_deliveries; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.reminder_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    CONSTRAINT reminder_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: stock_expiry_deliveries; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.stock_expiry_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    notify_on date NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    CONSTRAINT stock_expiry_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: stock_items; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.stock_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    name text NOT NULL,
    quantity numeric DEFAULT 0 NOT NULL,
    unit text DEFAULT ''::text NOT NULL,
    expires_on date,
    expires_month_only boolean DEFAULT false NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    target_id uuid,
    amount_per_unit numeric DEFAULT 1 NOT NULL,
    storage text DEFAULT 'home'::text NOT NULL,
    inspected_on date,
    inspect_interval_months smallint,
    CONSTRAINT stock_items_amount_per_unit_check CHECK ((amount_per_unit > (0)::numeric)),
    CONSTRAINT stock_items_inspect_interval_months_check CHECK (((inspect_interval_months IS NULL) OR ((inspect_interval_months >= 1) AND (inspect_interval_months <= 60)))),
    CONSTRAINT stock_items_month_only_check CHECK (((NOT expires_month_only) OR (expires_on IS NOT NULL))),
    CONSTRAINT stock_items_quantity_check CHECK ((quantity >= (0)::numeric)),
    CONSTRAINT stock_items_storage_check CHECK ((storage = ANY (ARRAY['home'::text, 'carry'::text])))
);


--
-- Name: stock_targets; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.stock_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    name text NOT NULL,
    quantity numeric DEFAULT 0 NOT NULL,
    per_person_day boolean DEFAULT true NOT NULL,
    unit text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    carry boolean DEFAULT false NOT NULL,
    CONSTRAINT stock_targets_quantity_check CHECK ((quantity >= (0)::numeric))
);


--
-- Name: tasks; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    title text NOT NULL,
    category text DEFAULT '手続き'::text NOT NULL,
    days_after_birth integer DEFAULT 0 NOT NULL,
    timing_memo text DEFAULT ''::text,
    place text DEFAULT ''::text,
    belongings text DEFAULT ''::text,
    note text DEFAULT ''::text,
    is_done boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    start_date date,
    start_time time without time zone,
    end_time time without time zone,
    anchor_type text DEFAULT 'absolute'::text NOT NULL,
    remind_minutes_before integer DEFAULT 0,
    participants text[] DEFAULT '{}'::text[] NOT NULL,
    kind text DEFAULT 'event'::text NOT NULL,
    created_by uuid,
    is_private boolean DEFAULT false NOT NULL,
    owner text,
    recurrence jsonb,
    done_dates date[] DEFAULT '{}'::date[] NOT NULL,
    CONSTRAINT tasks_anchor_type_check CHECK ((anchor_type = ANY (ARRAY['birth_relative'::text, 'absolute'::text]))),
    CONSTRAINT tasks_kind_check CHECK ((kind = ANY (ARRAY['event'::text, 'task'::text])))
);


--
-- Name: task_reminder_schedule; Type: VIEW; Schema: sukusuku; Owner: -
--

CREATE VIEW sukusuku.task_reminder_schedule WITH (security_invoker='on') AS
 SELECT t.id AS task_id,
    t.family_id,
    t.title,
    t.category,
    t.place,
    t.start_time,
    0 AS remind_minutes_before,
    resolved.target_date,
    ((resolved.target_date + COALESCE(t.start_time, '09:00:00'::time without time zone)) AT TIME ZONE 'Asia/Tokyo'::text) AS starts_at,
    ((resolved.target_date + COALESCE(t.start_time, '09:00:00'::time without time zone)) AT TIME ZONE 'Asia/Tokyo'::text) AS remind_at,
    t.is_private,
    t.created_by
   FROM (sukusuku.tasks t
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN (t.anchor_type = 'absolute'::text) THEN t.start_date
                    ELSE (sukusuku.family_birth_date(t.family_id) + t.days_after_birth)
                END AS target_date) resolved)
  WHERE ((NOT t.is_done) AND (resolved.target_date IS NOT NULL) AND ((t.recurrence IS NULL) OR (t.anchor_type <> 'absolute'::text)));


--
-- Name: temperature_reminder_deliveries; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.temperature_reminder_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    family_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    CONSTRAINT temperature_reminder_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: temperature_reminder_settings; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.temperature_reminder_settings (
    family_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    morning_time time without time zone DEFAULT '06:00:00'::time without time zone NOT NULL,
    evening_time time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: temperature_reminder_schedule; Type: VIEW; Schema: sukusuku; Owner: -
--

CREATE VIEW sukusuku.temperature_reminder_schedule WITH (security_invoker='on') AS
 WITH settings AS (
         SELECT f.id AS family_id,
            COALESCE(s.enabled, true) AS enabled,
            COALESCE(s.morning_time, '06:00:00'::time without time zone) AS morning_time,
            COALESCE(s.evening_time, '18:00:00'::time without time zone) AS evening_time
           FROM (sukusuku.families f
             LEFT JOIN sukusuku.temperature_reminder_settings s ON ((s.family_id = f.id)))
        ), slots AS (
         SELECT settings.family_id,
            'morning'::text AS slot,
            settings.morning_time AS at_time
           FROM settings
          WHERE settings.enabled
        UNION ALL
         SELECT settings.family_id,
            'evening'::text AS slot,
            settings.evening_time AS at_time
           FROM settings
          WHERE settings.enabled
        ), occurrences AS (
         SELECT slots.family_id,
            slots.slot,
            (((((now() AT TIME ZONE 'Asia/Tokyo'::text))::date - days.back) + slots.at_time) AT TIME ZONE 'Asia/Tokyo'::text) AS scheduled_for
           FROM (slots
             CROSS JOIN ( VALUES (0), (1)) days(back))
        )
 SELECT family_id,
    slot,
    scheduled_for
   FROM occurrences o
  WHERE (NOT (EXISTS ( SELECT 1
           FROM sukusuku.care_logs c
          WHERE ((c.family_id = o.family_id) AND (c.type = 'temperature'::text) AND (c.logged_at >= (o.scheduled_for - '01:00:00'::interval))))));


--
-- Name: users; Type: TABLE; Schema: sukusuku; Owner: -
--

CREATE TABLE sukusuku.users (
    id uuid NOT NULL,
    family_id uuid,
    name text,
    workplace text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    start_tab text DEFAULT 'schedule'::text NOT NULL,
    show_care_tab boolean DEFAULT true NOT NULL,
    CONSTRAINT users_start_tab_check CHECK ((start_tab = ANY (ARRAY['schedule'::text, 'list'::text, 'care'::text, 'money'::text, 'living'::text, 'settings'::text])))
);


--
-- Name: care_logs care_logs_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.care_logs
    ADD CONSTRAINT care_logs_pkey PRIMARY KEY (id);


--
-- Name: children children_member_id_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.children
    ADD CONSTRAINT children_member_id_key UNIQUE (member_id);


--
-- Name: children children_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.children
    ADD CONSTRAINT children_pkey PRIMARY KEY (id);


--
-- Name: contract_deliveries contract_deliveries_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contract_deliveries
    ADD CONSTRAINT contract_deliveries_pkey PRIMARY KEY (id);


--
-- Name: contract_deliveries contract_deliveries_subscription_day_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contract_deliveries
    ADD CONSTRAINT contract_deliveries_subscription_day_key UNIQUE (subscription_id, notify_on);


--
-- Name: contract_fields contract_fields_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contract_fields
    ADD CONSTRAINT contract_fields_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: families families_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.families
    ADD CONSTRAINT families_pkey PRIMARY KEY (id);


--
-- Name: family_members family_members_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.family_members
    ADD CONSTRAINT family_members_pkey PRIMARY KEY (id);


--
-- Name: family_members family_members_user_id_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.family_members
    ADD CONSTRAINT family_members_user_id_key UNIQUE (user_id);


--
-- Name: family_sync family_sync_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.family_sync
    ADD CONSTRAINT family_sync_pkey PRIMARY KEY (family_id);


--
-- Name: feeding_reminder_deliveries feeding_reminder_deliveries_log_subscription_time_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.feeding_reminder_deliveries
    ADD CONSTRAINT feeding_reminder_deliveries_log_subscription_time_key UNIQUE (care_log_id, subscription_id, scheduled_for);


--
-- Name: feeding_reminder_deliveries feeding_reminder_deliveries_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.feeding_reminder_deliveries
    ADD CONSTRAINT feeding_reminder_deliveries_pkey PRIMARY KEY (id);


--
-- Name: feeding_settings feeding_settings_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.feeding_settings
    ADD CONSTRAINT feeding_settings_pkey PRIMARY KEY (family_id);


--
-- Name: gifts gifts_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.gifts
    ADD CONSTRAINT gifts_pkey PRIMARY KEY (id);


--
-- Name: growth_records growth_records_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.growth_records
    ADD CONSTRAINT growth_records_pkey PRIMARY KEY (id);


--
-- Name: list_groups list_groups_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.list_groups
    ADD CONSTRAINT list_groups_pkey PRIMARY KEY (id);


--
-- Name: list_items list_items_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.list_items
    ADD CONSTRAINT list_items_pkey PRIMARY KEY (id);


--
-- Name: lists lists_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.lists
    ADD CONSTRAINT lists_pkey PRIMARY KEY (id);


--
-- Name: lottery_coupons lottery_coupons_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.lottery_coupons
    ADD CONSTRAINT lottery_coupons_pkey PRIMARY KEY (id);


--
-- Name: member_invites member_invites_code_hash_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.member_invites
    ADD CONSTRAINT member_invites_code_hash_key UNIQUE (code_hash);


--
-- Name: member_invites member_invites_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.member_invites
    ADD CONSTRAINT member_invites_pkey PRIMARY KEY (id);


--
-- Name: money_amazon_lines money_amazon_lines_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_lines
    ADD CONSTRAINT money_amazon_lines_pkey PRIMARY KEY (id);


--
-- Name: money_amazon_orders money_amazon_orders_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_orders
    ADD CONSTRAINT money_amazon_orders_id_family_key UNIQUE (id, family_id);


--
-- Name: money_amazon_orders money_amazon_orders_no_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_orders
    ADD CONSTRAINT money_amazon_orders_no_key UNIQUE (family_id, order_no);


--
-- Name: money_amazon_orders money_amazon_orders_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_orders
    ADD CONSTRAINT money_amazon_orders_pkey PRIMARY KEY (id);


--
-- Name: money_amazon_shipment_lines money_amazon_shipment_lines_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipment_lines
    ADD CONSTRAINT money_amazon_shipment_lines_pkey PRIMARY KEY (id);


--
-- Name: money_amazon_shipments money_amazon_shipments_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipments
    ADD CONSTRAINT money_amazon_shipments_id_family_key UNIQUE (id, family_id);


--
-- Name: money_amazon_shipments money_amazon_shipments_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipments
    ADD CONSTRAINT money_amazon_shipments_pkey PRIMARY KEY (id);


--
-- Name: money_amazon_shipments money_amazon_shipments_source_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipments
    ADD CONSTRAINT money_amazon_shipments_source_key UNIQUE (family_id, source_id);


--
-- Name: money_categories money_categories_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_categories
    ADD CONSTRAINT money_categories_id_family_key UNIQUE (id, family_id);


--
-- Name: money_categories money_categories_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_categories
    ADD CONSTRAINT money_categories_pkey PRIMARY KEY (id);


--
-- Name: money_feed money_feed_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed
    ADD CONSTRAINT money_feed_id_family_key UNIQUE (id, family_id);


--
-- Name: money_feed_mails money_feed_mails_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_mails
    ADD CONSTRAINT money_feed_mails_pkey PRIMARY KEY (family_id, message_id);


--
-- Name: money_feed money_feed_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed
    ADD CONSTRAINT money_feed_pkey PRIMARY KEY (id);


--
-- Name: money_feed_rules money_feed_rules_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_rules
    ADD CONSTRAINT money_feed_rules_pkey PRIMARY KEY (id);


--
-- Name: money_feed_settings money_feed_settings_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_settings
    ADD CONSTRAINT money_feed_settings_pkey PRIMARY KEY (family_id);


--
-- Name: money_feed money_feed_source_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed
    ADD CONSTRAINT money_feed_source_key UNIQUE (family_id, source, source_id);


--
-- Name: money_feed_tokens money_feed_tokens_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_tokens
    ADD CONSTRAINT money_feed_tokens_pkey PRIMARY KEY (family_id);


--
-- Name: money_feed_tokens money_feed_tokens_token_hash_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_tokens
    ADD CONSTRAINT money_feed_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: money_fx_rates money_fx_rates_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_fx_rates
    ADD CONSTRAINT money_fx_rates_pkey PRIMARY KEY (currency, rate_on);


--
-- Name: money_holding_values money_holding_values_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holding_values
    ADD CONSTRAINT money_holding_values_pkey PRIMARY KEY (holding_id, value_on);


--
-- Name: money_holdings money_holdings_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holdings
    ADD CONSTRAINT money_holdings_id_family_key UNIQUE (id, family_id);


--
-- Name: money_holdings money_holdings_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holdings
    ADD CONSTRAINT money_holdings_pkey PRIMARY KEY (id);


--
-- Name: money_holdings money_holdings_wallet_security_account_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holdings
    ADD CONSTRAINT money_holdings_wallet_security_account_key UNIQUE (wallet_id, security_id, account);


--
-- Name: money_items money_items_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_items
    ADD CONSTRAINT money_items_pkey PRIMARY KEY (id);


--
-- Name: money_month_requests money_month_requests_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_month_requests
    ADD CONSTRAINT money_month_requests_pkey PRIMARY KEY (family_id, month, user_id);


--
-- Name: money_month_wallet_checks money_month_wallet_checks_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_month_wallet_checks
    ADD CONSTRAINT money_month_wallet_checks_pkey PRIMARY KEY (family_id, month, wallet_id, user_id);


--
-- Name: money_months money_months_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_months
    ADD CONSTRAINT money_months_pkey PRIMARY KEY (family_id, month);


--
-- Name: money_ratio_targets money_ratio_targets_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_ratio_targets
    ADD CONSTRAINT money_ratio_targets_pkey PRIMARY KEY (family_id, budget_group);


--
-- Name: money_receipt_scans money_receipt_scans_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_receipt_scans
    ADD CONSTRAINT money_receipt_scans_pkey PRIMARY KEY (id);


--
-- Name: money_records money_records_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_id_family_key UNIQUE (id, family_id);


--
-- Name: money_records money_records_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_pkey PRIMARY KEY (id);


--
-- Name: money_recurring money_recurring_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_recurring
    ADD CONSTRAINT money_recurring_id_family_key UNIQUE (id, family_id);


--
-- Name: money_recurring money_recurring_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_recurring
    ADD CONSTRAINT money_recurring_pkey PRIMARY KEY (id);


--
-- Name: money_securities money_securities_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_securities
    ADD CONSTRAINT money_securities_id_family_key UNIQUE (id, family_id);


--
-- Name: money_securities money_securities_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_securities
    ADD CONSTRAINT money_securities_pkey PRIMARY KEY (id);


--
-- Name: money_security_prices money_security_prices_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_security_prices
    ADD CONSTRAINT money_security_prices_pkey PRIMARY KEY (security_id, price_on);


--
-- Name: money_stores money_stores_family_name_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_stores
    ADD CONSTRAINT money_stores_family_name_key UNIQUE (family_id, name);


--
-- Name: money_stores money_stores_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_stores
    ADD CONSTRAINT money_stores_pkey PRIMARY KEY (id);


--
-- Name: money_wallet_balances money_wallet_balances_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallet_balances
    ADD CONSTRAINT money_wallet_balances_pkey PRIMARY KEY (id);


--
-- Name: money_wallet_balances money_wallet_balances_wallet_date_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallet_balances
    ADD CONSTRAINT money_wallet_balances_wallet_date_key UNIQUE (wallet_id, balance_on);


--
-- Name: money_wallets money_wallets_id_family_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallets
    ADD CONSTRAINT money_wallets_id_family_key UNIQUE (id, family_id);


--
-- Name: money_wallets money_wallets_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallets
    ADD CONSTRAINT money_wallets_pkey PRIMARY KEY (id);


--
-- Name: nurseries nurseries_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.nurseries
    ADD CONSTRAINT nurseries_pkey PRIMARY KEY (id);


--
-- Name: nursing_alarms nursing_alarms_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.nursing_alarms
    ADD CONSTRAINT nursing_alarms_pkey PRIMARY KEY (subscription_id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: reminder_deliveries reminder_deliveries_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.reminder_deliveries
    ADD CONSTRAINT reminder_deliveries_pkey PRIMARY KEY (id);


--
-- Name: reminder_deliveries reminder_deliveries_task_subscription_time_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.reminder_deliveries
    ADD CONSTRAINT reminder_deliveries_task_subscription_time_key UNIQUE (task_id, subscription_id, scheduled_for);


--
-- Name: stock_expiry_deliveries stock_expiry_deliveries_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_expiry_deliveries
    ADD CONSTRAINT stock_expiry_deliveries_pkey PRIMARY KEY (id);


--
-- Name: stock_expiry_deliveries stock_expiry_deliveries_subscription_day_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_expiry_deliveries
    ADD CONSTRAINT stock_expiry_deliveries_subscription_day_key UNIQUE (subscription_id, notify_on);


--
-- Name: stock_items stock_items_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_items
    ADD CONSTRAINT stock_items_pkey PRIMARY KEY (id);


--
-- Name: stock_targets stock_targets_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_targets
    ADD CONSTRAINT stock_targets_pkey PRIMARY KEY (id);


--
-- Name: subsidy_draws subsidy_draws_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.subsidy_draws
    ADD CONSTRAINT subsidy_draws_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: temperature_reminder_deliveries temperature_reminder_deliveries_family_subscription_time_key; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.temperature_reminder_deliveries
    ADD CONSTRAINT temperature_reminder_deliveries_family_subscription_time_key UNIQUE (family_id, subscription_id, scheduled_for);


--
-- Name: temperature_reminder_deliveries temperature_reminder_deliveries_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.temperature_reminder_deliveries
    ADD CONSTRAINT temperature_reminder_deliveries_pkey PRIMARY KEY (id);


--
-- Name: temperature_reminder_settings temperature_reminder_settings_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.temperature_reminder_settings
    ADD CONSTRAINT temperature_reminder_settings_pkey PRIMARY KEY (family_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: family_members_family_display_name; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE UNIQUE INDEX family_members_family_display_name ON sukusuku.family_members USING btree (family_id, display_name);


--
-- Name: idx_care_logs_created_by; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_care_logs_created_by ON sukusuku.care_logs USING btree (created_by);


--
-- Name: idx_care_logs_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_care_logs_family_id ON sukusuku.care_logs USING btree (family_id);


--
-- Name: idx_care_logs_family_logged_at; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_care_logs_family_logged_at ON sukusuku.care_logs USING btree (family_id, logged_at DESC);


--
-- Name: idx_care_logs_pumped_milk; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_care_logs_pumped_milk ON sukusuku.care_logs USING btree (family_id) WHERE ((type = 'milk'::text) AND ((details ->> 'method'::text) = 'pumped'::text));


--
-- Name: idx_care_logs_pumping; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_care_logs_pumping ON sukusuku.care_logs USING btree (family_id) WHERE (type = 'pumping'::text);


--
-- Name: idx_children_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_children_family_id ON sukusuku.children USING btree (family_id);


--
-- Name: idx_contract_deliveries_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_contract_deliveries_family_id ON sukusuku.contract_deliveries USING btree (family_id);


--
-- Name: idx_contract_deliveries_sent_at; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_contract_deliveries_sent_at ON sukusuku.contract_deliveries USING btree (sent_at);


--
-- Name: idx_contract_fields_contract_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_contract_fields_contract_id ON sukusuku.contract_fields USING btree (contract_id);


--
-- Name: idx_contracts_contractor_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_contracts_contractor_id ON sukusuku.contracts USING btree (contractor_id);


--
-- Name: idx_contracts_created_by; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_contracts_created_by ON sukusuku.contracts USING btree (created_by);


--
-- Name: idx_contracts_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_contracts_family_id ON sukusuku.contracts USING btree (family_id);


--
-- Name: idx_documents_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_documents_family_id ON sukusuku.documents USING btree (family_id);


--
-- Name: idx_family_members_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_family_members_family_id ON sukusuku.family_members USING btree (family_id);


--
-- Name: idx_feeding_reminder_deliveries_sent_at; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_feeding_reminder_deliveries_sent_at ON sukusuku.feeding_reminder_deliveries USING btree (sent_at);


--
-- Name: idx_feeding_reminder_deliveries_subscription_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_feeding_reminder_deliveries_subscription_id ON sukusuku.feeding_reminder_deliveries USING btree (subscription_id);


--
-- Name: idx_gifts_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_gifts_family_id ON sukusuku.gifts USING btree (family_id);


--
-- Name: idx_growth_records_child_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_growth_records_child_id ON sukusuku.growth_records USING btree (child_id);


--
-- Name: idx_list_groups_list_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_list_groups_list_id ON sukusuku.list_groups USING btree (list_id);


--
-- Name: idx_list_items_group_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_list_items_group_id ON sukusuku.list_items USING btree (group_id);


--
-- Name: idx_list_items_list_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_list_items_list_id ON sukusuku.list_items USING btree (list_id);


--
-- Name: idx_lists_created_by; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_lists_created_by ON sukusuku.lists USING btree (created_by);


--
-- Name: idx_lists_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_lists_family_id ON sukusuku.lists USING btree (family_id);


--
-- Name: idx_lottery_coupons_owner; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_lottery_coupons_owner ON sukusuku.lottery_coupons USING btree (owner_id, obtained_at DESC);


--
-- Name: idx_member_invites_member_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_member_invites_member_id ON sukusuku.member_invites USING btree (member_id);


--
-- Name: idx_money_amazon_lines_category_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_lines_category_id ON sukusuku.money_amazon_lines USING btree (category_id);


--
-- Name: idx_money_amazon_lines_family_open; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_lines_family_open ON sukusuku.money_amazon_lines USING btree (family_id) WHERE (feed_id IS NULL);


--
-- Name: idx_money_amazon_lines_feed_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_lines_feed_id ON sukusuku.money_amazon_lines USING btree (feed_id);


--
-- Name: idx_money_amazon_lines_order_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_lines_order_id ON sukusuku.money_amazon_lines USING btree (order_id);


--
-- Name: idx_money_amazon_orders_adjust_feed_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_orders_adjust_feed_id ON sukusuku.money_amazon_orders USING btree (adjust_feed_id);


--
-- Name: idx_money_amazon_orders_family_ordered; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_orders_family_ordered ON sukusuku.money_amazon_orders USING btree (family_id, ordered_on);


--
-- Name: idx_money_amazon_shipment_lines_line_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_shipment_lines_line_id ON sukusuku.money_amazon_shipment_lines USING btree (line_id);


--
-- Name: idx_money_amazon_shipment_lines_order_no; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_shipment_lines_order_no ON sukusuku.money_amazon_shipment_lines USING btree (family_id, order_no);


--
-- Name: idx_money_amazon_shipment_lines_shipment_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_shipment_lines_shipment_id ON sukusuku.money_amazon_shipment_lines USING btree (shipment_id);


--
-- Name: idx_money_amazon_shipments_feed_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_amazon_shipments_feed_id ON sukusuku.money_amazon_shipments USING btree (feed_id);


--
-- Name: idx_money_categories_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_categories_family_id ON sukusuku.money_categories USING btree (family_id);


--
-- Name: idx_money_categories_parent_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_categories_parent_id ON sukusuku.money_categories USING btree (parent_id);


--
-- Name: idx_money_feed_family_occurred; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_family_occurred ON sukusuku.money_feed USING btree (family_id, occurred_on);


--
-- Name: idx_money_feed_family_status; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_family_status ON sukusuku.money_feed USING btree (family_id, status);


--
-- Name: idx_money_feed_pair_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_pair_id ON sukusuku.money_feed USING btree (pair_id);


--
-- Name: idx_money_feed_record_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_record_id ON sukusuku.money_feed USING btree (record_id);


--
-- Name: idx_money_feed_resolved_by; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_resolved_by ON sukusuku.money_feed USING btree (resolved_by);


--
-- Name: idx_money_feed_rules_category_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_rules_category_id ON sukusuku.money_feed_rules USING btree (category_id);


--
-- Name: idx_money_feed_rules_family; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_rules_family ON sukusuku.money_feed_rules USING btree (family_id, "position");


--
-- Name: idx_money_feed_rules_recurring_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_rules_recurring_id ON sukusuku.money_feed_rules USING btree (recurring_id);


--
-- Name: idx_money_feed_rules_to_wallet_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_rules_to_wallet_id ON sukusuku.money_feed_rules USING btree (to_wallet_id);


--
-- Name: idx_money_feed_rules_wallet_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_rules_wallet_id ON sukusuku.money_feed_rules USING btree (wallet_id);


--
-- Name: idx_money_feed_wallet_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_feed_wallet_id ON sukusuku.money_feed USING btree (wallet_id);


--
-- Name: idx_money_holding_values_family_on; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_holding_values_family_on ON sukusuku.money_holding_values USING btree (family_id, value_on);


--
-- Name: idx_money_holdings_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_holdings_family_id ON sukusuku.money_holdings USING btree (family_id);


--
-- Name: idx_money_holdings_security_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_holdings_security_id ON sukusuku.money_holdings USING btree (security_id);


--
-- Name: idx_money_items_category_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_items_category_id ON sukusuku.money_items USING btree (category_id);


--
-- Name: idx_money_items_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_items_family_id ON sukusuku.money_items USING btree (family_id);


--
-- Name: idx_money_items_family_receipt_name; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_items_family_receipt_name ON sukusuku.money_items USING btree (family_id, receipt_name) WHERE (receipt_name IS NOT NULL);


--
-- Name: idx_money_items_record_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_items_record_id ON sukusuku.money_items USING btree (record_id);


--
-- Name: idx_money_receipt_scans_family_created; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_receipt_scans_family_created ON sukusuku.money_receipt_scans USING btree (family_id, created_at);


--
-- Name: idx_money_records_created_by; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_records_created_by ON sukusuku.money_records USING btree (created_by);


--
-- Name: idx_money_records_draw_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE UNIQUE INDEX idx_money_records_draw_id ON sukusuku.money_records USING btree (draw_id) WHERE (draw_id IS NOT NULL);


--
-- Name: idx_money_records_family_occurred; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_records_family_occurred ON sukusuku.money_records USING btree (family_id, occurred_on);


--
-- Name: idx_money_records_family_receipt_store; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_records_family_receipt_store ON sukusuku.money_records USING btree (family_id, receipt_store) WHERE (receipt_store IS NOT NULL);


--
-- Name: idx_money_records_feed_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_records_feed_id ON sukusuku.money_records USING btree (feed_id);


--
-- Name: idx_money_records_recurring_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_records_recurring_id ON sukusuku.money_records USING btree (recurring_id);


--
-- Name: idx_money_records_to_wallet_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_records_to_wallet_id ON sukusuku.money_records USING btree (to_wallet_id);


--
-- Name: idx_money_records_wallet_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_records_wallet_id ON sukusuku.money_records USING btree (wallet_id);


--
-- Name: idx_money_recurring_category_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_recurring_category_id ON sukusuku.money_recurring USING btree (category_id);


--
-- Name: idx_money_recurring_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_recurring_family_id ON sukusuku.money_recurring USING btree (family_id);


--
-- Name: idx_money_recurring_to_wallet_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_recurring_to_wallet_id ON sukusuku.money_recurring USING btree (to_wallet_id);


--
-- Name: idx_money_recurring_wallet_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_recurring_wallet_id ON sukusuku.money_recurring USING btree (wallet_id);


--
-- Name: idx_money_securities_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_securities_family_id ON sukusuku.money_securities USING btree (family_id);


--
-- Name: idx_money_security_prices_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_security_prices_family_id ON sukusuku.money_security_prices USING btree (family_id);


--
-- Name: idx_money_wallet_balances_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_wallet_balances_family_id ON sukusuku.money_wallet_balances USING btree (family_id);


--
-- Name: idx_money_wallets_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_wallets_family_id ON sukusuku.money_wallets USING btree (family_id);


--
-- Name: idx_money_wallets_pay_wallet_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_money_wallets_pay_wallet_id ON sukusuku.money_wallets USING btree (pay_wallet_id);


--
-- Name: idx_nurseries_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_nurseries_family_id ON sukusuku.nurseries USING btree (family_id);


--
-- Name: idx_nursing_alarms_user_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_nursing_alarms_user_id ON sukusuku.nursing_alarms USING btree (user_id);


--
-- Name: idx_push_subscriptions_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_push_subscriptions_family_id ON sukusuku.push_subscriptions USING btree (family_id);


--
-- Name: idx_push_subscriptions_kind; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_push_subscriptions_kind ON sukusuku.push_subscriptions USING btree (kind);


--
-- Name: idx_push_subscriptions_user_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_push_subscriptions_user_id ON sukusuku.push_subscriptions USING btree (user_id);


--
-- Name: idx_reminder_deliveries_sent_at; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_reminder_deliveries_sent_at ON sukusuku.reminder_deliveries USING btree (sent_at);


--
-- Name: idx_reminder_deliveries_subscription_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_reminder_deliveries_subscription_id ON sukusuku.reminder_deliveries USING btree (subscription_id);


--
-- Name: idx_stock_expiry_deliveries_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_stock_expiry_deliveries_family_id ON sukusuku.stock_expiry_deliveries USING btree (family_id);


--
-- Name: idx_stock_expiry_deliveries_sent_at; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_stock_expiry_deliveries_sent_at ON sukusuku.stock_expiry_deliveries USING btree (sent_at);


--
-- Name: idx_stock_items_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_stock_items_family_id ON sukusuku.stock_items USING btree (family_id);


--
-- Name: idx_stock_items_target_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_stock_items_target_id ON sukusuku.stock_items USING btree (target_id);


--
-- Name: idx_stock_targets_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_stock_targets_family_id ON sukusuku.stock_targets USING btree (family_id);


--
-- Name: idx_subsidy_draws_drawn_by_drawn_at; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_subsidy_draws_drawn_by_drawn_at ON sukusuku.subsidy_draws USING btree (drawn_by, drawn_at DESC);


--
-- Name: idx_subsidy_draws_family_drawn_at; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_subsidy_draws_family_drawn_at ON sukusuku.subsidy_draws USING btree (family_id, drawn_at DESC);


--
-- Name: idx_tasks_created_by; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_tasks_created_by ON sukusuku.tasks USING btree (created_by);


--
-- Name: idx_tasks_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_tasks_family_id ON sukusuku.tasks USING btree (family_id);


--
-- Name: idx_tasks_family_start_date; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_tasks_family_start_date ON sukusuku.tasks USING btree (family_id, start_date);


--
-- Name: idx_temperature_reminder_deliveries_sent_at; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_temperature_reminder_deliveries_sent_at ON sukusuku.temperature_reminder_deliveries USING btree (sent_at);


--
-- Name: idx_temperature_reminder_deliveries_subscription_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_temperature_reminder_deliveries_subscription_id ON sukusuku.temperature_reminder_deliveries USING btree (subscription_id);


--
-- Name: idx_users_family_id; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX idx_users_family_id ON sukusuku.users USING btree (family_id);


--
-- Name: money_feed_mails_open_idx; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE INDEX money_feed_mails_open_idx ON sukusuku.money_feed_mails USING btree (family_id) WHERE (trashed_at IS NULL);


--
-- Name: money_records_recurring_month_key; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE UNIQUE INDEX money_records_recurring_month_key ON sukusuku.money_records USING btree (recurring_id, month) WHERE (recurring_id IS NOT NULL);


--
-- Name: money_wallets_feed_key; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE UNIQUE INDEX money_wallets_feed_key ON sukusuku.money_wallets USING btree (family_id, lower(holder_zaim_email), feed_name) WHERE ((holder_zaim_email IS NOT NULL) AND (feed_name IS NOT NULL) AND (archived_at IS NULL));


--
-- Name: uq_lottery_coupons_box; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE UNIQUE INDEX uq_lottery_coupons_box ON sukusuku.lottery_coupons USING btree (source_draw_id) WHERE (slot IS NOT NULL);


--
-- Name: uq_lottery_coupons_slot; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE UNIQUE INDEX uq_lottery_coupons_slot ON sukusuku.lottery_coupons USING btree (owner_id, is_test, cycle, slot) WHERE (slot IS NOT NULL);


--
-- Name: uq_lottery_coupons_trip; Type: INDEX; Schema: sukusuku; Owner: -
--

CREATE UNIQUE INDEX uq_lottery_coupons_trip ON sukusuku.lottery_coupons USING btree (owner_id, is_test, cycle) WHERE (kind = 'trip'::text);


--
-- Name: care_logs family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.care_logs REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: children family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.children REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: contract_fields family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.contract_fields REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select c.family_id from %rows% r join sukusuku.contracts c on c.id = r.contract_id');


--
-- Name: contracts family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.contracts REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: documents family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.documents REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: families family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.families REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select id from %rows%');


--
-- Name: family_members family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.family_members REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: feeding_settings family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.feeding_settings REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: gifts family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.gifts REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: growth_records family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.growth_records REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select c.family_id from %rows% r join sukusuku.children c on c.id = r.child_id');


--
-- Name: list_groups family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.list_groups REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select l.family_id from %rows% r join sukusuku.lists l on l.id = r.list_id');


--
-- Name: list_items family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.list_items REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select l.family_id from %rows% r join sukusuku.lists l on l.id = r.list_id');


--
-- Name: lists family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.lists REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: lottery_coupons family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.lottery_coupons REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_lines family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_amazon_lines REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_orders family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_amazon_orders REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_shipment_lines family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_amazon_shipment_lines REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_shipments family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_amazon_shipments REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_categories family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_categories REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_feed REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_mails family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_feed_mails REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_rules family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_feed_rules REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_settings family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_feed_settings REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_holding_values family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_holding_values REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_holdings family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_holdings REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_items family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_items REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_month_requests family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_month_requests REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_month_wallet_checks family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_month_wallet_checks REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_months family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_months REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_ratio_targets family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_ratio_targets REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_receipt_scans family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_receipt_scans REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_records family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_records REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_recurring family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_recurring REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_securities family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_securities REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_security_prices family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_security_prices REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_stores family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_stores REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_wallet_balances family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_wallet_balances REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_wallets family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.money_wallets REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: nurseries family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.nurseries REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: nursing_alarms family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.nursing_alarms REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select sukusuku.push_subscription_family_id(r.subscription_id) from %rows% r');


--
-- Name: stock_items family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.stock_items REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: stock_targets family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.stock_targets REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: subsidy_draws family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.subsidy_draws REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: tasks family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.tasks REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: temperature_reminder_settings family_sync_gone; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_gone AFTER DELETE ON sukusuku.temperature_reminder_settings REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: care_logs family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.care_logs REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: children family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.children REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: contract_fields family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.contract_fields REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select c.family_id from %rows% r join sukusuku.contracts c on c.id = r.contract_id');


--
-- Name: contracts family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.contracts REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: documents family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.documents REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: families family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.families REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select id from %rows%');


--
-- Name: family_members family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.family_members REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: feeding_settings family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.feeding_settings REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: gifts family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.gifts REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: growth_records family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.growth_records REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select c.family_id from %rows% r join sukusuku.children c on c.id = r.child_id');


--
-- Name: list_groups family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.list_groups REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select l.family_id from %rows% r join sukusuku.lists l on l.id = r.list_id');


--
-- Name: list_items family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.list_items REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select l.family_id from %rows% r join sukusuku.lists l on l.id = r.list_id');


--
-- Name: lists family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.lists REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: lottery_coupons family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.lottery_coupons REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_lines family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_amazon_lines REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_orders family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_amazon_orders REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_shipment_lines family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_amazon_shipment_lines REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_shipments family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_amazon_shipments REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_categories family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_categories REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_feed REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_mails family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_feed_mails REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_rules family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_feed_rules REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_settings family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_feed_settings REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_holding_values family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_holding_values REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_holdings family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_holdings REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_items family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_items REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_month_requests family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_month_requests REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_month_wallet_checks family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_month_wallet_checks REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_months family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_months REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_ratio_targets family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_ratio_targets REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_receipt_scans family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_receipt_scans REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_records family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_records REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_recurring family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_recurring REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_securities family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_securities REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_security_prices family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_security_prices REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_stores family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_stores REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_wallet_balances family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_wallet_balances REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_wallets family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.money_wallets REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: nurseries family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.nurseries REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: nursing_alarms family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.nursing_alarms REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select sukusuku.push_subscription_family_id(r.subscription_id) from %rows% r');


--
-- Name: stock_items family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.stock_items REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: stock_targets family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.stock_targets REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: subsidy_draws family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.subsidy_draws REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: tasks family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.tasks REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: temperature_reminder_settings family_sync_ins; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_ins AFTER INSERT ON sukusuku.temperature_reminder_settings REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: care_logs family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.care_logs REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: children family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.children REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: contract_fields family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.contract_fields REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select c.family_id from %rows% r join sukusuku.contracts c on c.id = r.contract_id');


--
-- Name: contracts family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.contracts REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: documents family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.documents REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: families family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.families REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select id from %rows%');


--
-- Name: family_members family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.family_members REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: feeding_settings family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.feeding_settings REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: gifts family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.gifts REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: growth_records family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.growth_records REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select c.family_id from %rows% r join sukusuku.children c on c.id = r.child_id');


--
-- Name: list_groups family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.list_groups REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select l.family_id from %rows% r join sukusuku.lists l on l.id = r.list_id');


--
-- Name: list_items family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.list_items REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select l.family_id from %rows% r join sukusuku.lists l on l.id = r.list_id');


--
-- Name: lists family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.lists REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: lottery_coupons family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.lottery_coupons REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_lines family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_amazon_lines REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_orders family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_amazon_orders REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_shipment_lines family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_amazon_shipment_lines REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_amazon_shipments family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_amazon_shipments REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_categories family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_categories REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_feed REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_mails family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_feed_mails REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_rules family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_feed_rules REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_feed_settings family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_feed_settings REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_holding_values family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_holding_values REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_holdings family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_holdings REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_items family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_items REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_month_requests family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_month_requests REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_month_wallet_checks family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_month_wallet_checks REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_months family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_months REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_ratio_targets family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_ratio_targets REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_receipt_scans family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_receipt_scans REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_records family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_records REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_recurring family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_recurring REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_securities family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_securities REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_security_prices family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_security_prices REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_stores family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_stores REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_wallet_balances family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_wallet_balances REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: money_wallets family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.money_wallets REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: nurseries family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.nurseries REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: nursing_alarms family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.nursing_alarms REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select sukusuku.push_subscription_family_id(r.subscription_id) from %rows% r');


--
-- Name: stock_items family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.stock_items REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: stock_targets family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.stock_targets REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: subsidy_draws family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.subsidy_draws REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: tasks family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.tasks REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: temperature_reminder_settings family_sync_upd; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER family_sync_upd AFTER UPDATE ON sukusuku.temperature_reminder_settings REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sukusuku.touch_family_sync('select family_id from %rows%');


--
-- Name: family_members guard_family_member_columns; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER guard_family_member_columns BEFORE UPDATE ON sukusuku.family_members FOR EACH ROW EXECUTE FUNCTION sukusuku.guard_family_member_columns();


--
-- Name: money_categories money_categories_keep_name; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_categories_keep_name BEFORE DELETE ON sukusuku.money_categories FOR EACH ROW EXECUTE FUNCTION sukusuku.money_categories_keep_name();


--
-- Name: money_categories money_categories_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_categories_set_updated_at BEFORE UPDATE ON sukusuku.money_categories FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_feed_mails money_feed_mails_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_feed_mails_set_updated_at BEFORE UPDATE ON sukusuku.money_feed_mails FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_feed_rules money_feed_rules_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_feed_rules_set_updated_at BEFORE UPDATE ON sukusuku.money_feed_rules FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_feed money_feed_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_feed_set_updated_at BEFORE UPDATE ON sukusuku.money_feed FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_feed_settings money_feed_settings_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_feed_settings_set_updated_at BEFORE UPDATE ON sukusuku.money_feed_settings FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_holdings money_holdings_refresh_today; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_holdings_refresh_today AFTER INSERT OR UPDATE OF quantity, cost_price, archived_at ON sukusuku.money_holdings FOR EACH ROW EXECUTE FUNCTION sukusuku.money_holdings_refresh_today();


--
-- Name: money_holdings money_holdings_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_holdings_set_updated_at BEFORE UPDATE ON sukusuku.money_holdings FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_items money_items_check_record_total; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE CONSTRAINT TRIGGER money_items_check_record_total AFTER INSERT OR UPDATE ON sukusuku.money_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sukusuku.money_items_check_record_total();


--
-- Name: money_month_requests money_month_requests_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_month_requests_set_updated_at BEFORE UPDATE ON sukusuku.money_month_requests FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_month_wallet_checks money_month_wallet_checks_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_month_wallet_checks_set_updated_at BEFORE UPDATE ON sukusuku.money_month_wallet_checks FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_months money_months_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_months_set_updated_at BEFORE UPDATE ON sukusuku.money_months FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_ratio_targets money_ratio_targets_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_ratio_targets_set_updated_at BEFORE UPDATE ON sukusuku.money_ratio_targets FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_records money_records_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_records_set_updated_at BEFORE UPDATE ON sukusuku.money_records FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_recurring money_recurring_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_recurring_set_updated_at BEFORE UPDATE ON sukusuku.money_recurring FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_securities money_securities_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_securities_set_updated_at BEFORE UPDATE ON sukusuku.money_securities FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_stores money_stores_set_position; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_stores_set_position BEFORE INSERT ON sukusuku.money_stores FOR EACH ROW EXECUTE FUNCTION sukusuku.money_stores_set_position();


--
-- Name: money_stores money_stores_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_stores_set_updated_at BEFORE UPDATE ON sukusuku.money_stores FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_wallet_balances money_wallet_balances_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_wallet_balances_set_updated_at BEFORE UPDATE ON sukusuku.money_wallet_balances FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: money_wallets money_wallets_card_start; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_wallets_card_start BEFORE INSERT OR UPDATE OF close_day, pay_day, pay_wallet_id ON sukusuku.money_wallets FOR EACH ROW EXECUTE FUNCTION sukusuku.money_wallets_card_start();


--
-- Name: money_wallets money_wallets_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER money_wallets_set_updated_at BEFORE UPDATE ON sukusuku.money_wallets FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: family_members rename_member_in_tasks; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER rename_member_in_tasks AFTER UPDATE OF display_name ON sukusuku.family_members FOR EACH ROW EXECUTE FUNCTION sukusuku.rename_member_in_tasks();


--
-- Name: contracts set_contracts_notify_after; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER set_contracts_notify_after BEFORE INSERT OR UPDATE ON sukusuku.contracts FOR EACH ROW EXECUTE FUNCTION sukusuku.contracts_set_notify_after();


--
-- Name: contracts set_contracts_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER set_contracts_updated_at BEFORE UPDATE ON sukusuku.contracts FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: families set_families_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER set_families_updated_at BEFORE UPDATE ON sukusuku.families FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: family_members set_family_members_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER set_family_members_updated_at BEFORE UPDATE ON sukusuku.family_members FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: tasks set_tasks_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER set_tasks_updated_at BEFORE UPDATE ON sukusuku.tasks FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: stock_items stock_items_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER stock_items_set_updated_at BEFORE UPDATE ON sukusuku.stock_items FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: stock_targets stock_targets_set_updated_at; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER stock_targets_set_updated_at BEFORE UPDATE ON sukusuku.stock_targets FOR EACH ROW EXECUTE FUNCTION sukusuku.set_updated_at();


--
-- Name: subsidy_draws subsidy_draws_after_insert; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER subsidy_draws_after_insert AFTER INSERT ON sukusuku.subsidy_draws FOR EACH ROW EXECUTE FUNCTION sukusuku.subsidy_draws_after_insert();


--
-- Name: subsidy_draws subsidy_draws_before_insert; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER subsidy_draws_before_insert BEFORE INSERT ON sukusuku.subsidy_draws FOR EACH ROW EXECUTE FUNCTION sukusuku.subsidy_draws_before_insert();


--
-- Name: subsidy_draws subsidy_draws_to_money; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER subsidy_draws_to_money AFTER INSERT ON sukusuku.subsidy_draws FOR EACH ROW EXECUTE FUNCTION sukusuku.subsidy_draws_to_money();


--
-- Name: subsidy_draws subsidy_draws_to_money_update; Type: TRIGGER; Schema: sukusuku; Owner: -
--

CREATE TRIGGER subsidy_draws_to_money_update AFTER UPDATE OF subsidy ON sukusuku.subsidy_draws FOR EACH ROW WHEN ((old.subsidy IS DISTINCT FROM new.subsidy)) EXECUTE FUNCTION sukusuku.subsidy_draws_to_money_update();


--
-- Name: care_logs care_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.care_logs
    ADD CONSTRAINT care_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: care_logs care_logs_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.care_logs
    ADD CONSTRAINT care_logs_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: children children_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.children
    ADD CONSTRAINT children_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: children children_member_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.children
    ADD CONSTRAINT children_member_id_fkey FOREIGN KEY (member_id) REFERENCES sukusuku.family_members(id) ON DELETE SET NULL;


--
-- Name: contract_deliveries contract_deliveries_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contract_deliveries
    ADD CONSTRAINT contract_deliveries_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: contract_deliveries contract_deliveries_subscription_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contract_deliveries
    ADD CONSTRAINT contract_deliveries_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES sukusuku.push_subscriptions(id) ON DELETE CASCADE;


--
-- Name: contract_fields contract_fields_contract_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contract_fields
    ADD CONSTRAINT contract_fields_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES sukusuku.contracts(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_contractor_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contracts
    ADD CONSTRAINT contracts_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES sukusuku.family_members(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_created_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contracts
    ADD CONSTRAINT contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.contracts
    ADD CONSTRAINT contracts_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: documents documents_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.documents
    ADD CONSTRAINT documents_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: family_members family_members_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.family_members
    ADD CONSTRAINT family_members_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: family_members family_members_user_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.family_members
    ADD CONSTRAINT family_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: feeding_reminder_deliveries feeding_reminder_deliveries_care_log_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.feeding_reminder_deliveries
    ADD CONSTRAINT feeding_reminder_deliveries_care_log_id_fkey FOREIGN KEY (care_log_id) REFERENCES sukusuku.care_logs(id) ON DELETE CASCADE;


--
-- Name: feeding_reminder_deliveries feeding_reminder_deliveries_subscription_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.feeding_reminder_deliveries
    ADD CONSTRAINT feeding_reminder_deliveries_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES sukusuku.push_subscriptions(id) ON DELETE CASCADE;


--
-- Name: feeding_settings feeding_settings_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.feeding_settings
    ADD CONSTRAINT feeding_settings_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: gifts gifts_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.gifts
    ADD CONSTRAINT gifts_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: growth_records growth_records_child_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.growth_records
    ADD CONSTRAINT growth_records_child_id_fkey FOREIGN KEY (child_id) REFERENCES sukusuku.children(id) ON DELETE CASCADE;


--
-- Name: list_groups list_groups_list_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.list_groups
    ADD CONSTRAINT list_groups_list_id_fkey FOREIGN KEY (list_id) REFERENCES sukusuku.lists(id) ON DELETE CASCADE;


--
-- Name: list_items list_items_group_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.list_items
    ADD CONSTRAINT list_items_group_id_fkey FOREIGN KEY (group_id) REFERENCES sukusuku.list_groups(id) ON DELETE SET NULL;


--
-- Name: list_items list_items_list_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.list_items
    ADD CONSTRAINT list_items_list_id_fkey FOREIGN KEY (list_id) REFERENCES sukusuku.lists(id) ON DELETE CASCADE;


--
-- Name: lists lists_created_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.lists
    ADD CONSTRAINT lists_created_by_fkey FOREIGN KEY (created_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: lists lists_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.lists
    ADD CONSTRAINT lists_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: lottery_coupons lottery_coupons_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.lottery_coupons
    ADD CONSTRAINT lottery_coupons_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: lottery_coupons lottery_coupons_owner_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.lottery_coupons
    ADD CONSTRAINT lottery_coupons_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES sukusuku.users(id) ON DELETE CASCADE;


--
-- Name: lottery_coupons lottery_coupons_source_draw_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.lottery_coupons
    ADD CONSTRAINT lottery_coupons_source_draw_id_fkey FOREIGN KEY (source_draw_id) REFERENCES sukusuku.subsidy_draws(id) ON DELETE SET NULL;


--
-- Name: lottery_coupons lottery_coupons_used_draw_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.lottery_coupons
    ADD CONSTRAINT lottery_coupons_used_draw_id_fkey FOREIGN KEY (used_draw_id) REFERENCES sukusuku.subsidy_draws(id) ON DELETE SET NULL;


--
-- Name: member_invites member_invites_created_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.member_invites
    ADD CONSTRAINT member_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: member_invites member_invites_member_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.member_invites
    ADD CONSTRAINT member_invites_member_id_fkey FOREIGN KEY (member_id) REFERENCES sukusuku.family_members(id) ON DELETE CASCADE;


--
-- Name: money_amazon_lines money_amazon_lines_category_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_lines
    ADD CONSTRAINT money_amazon_lines_category_fkey FOREIGN KEY (category_id, family_id) REFERENCES sukusuku.money_categories(id, family_id) ON DELETE SET NULL (category_id);


--
-- Name: money_amazon_lines money_amazon_lines_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_lines
    ADD CONSTRAINT money_amazon_lines_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_amazon_lines money_amazon_lines_feed_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_lines
    ADD CONSTRAINT money_amazon_lines_feed_fkey FOREIGN KEY (feed_id, family_id) REFERENCES sukusuku.money_feed(id, family_id) ON DELETE SET NULL (feed_id);


--
-- Name: money_amazon_lines money_amazon_lines_order_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_lines
    ADD CONSTRAINT money_amazon_lines_order_fkey FOREIGN KEY (order_id, family_id) REFERENCES sukusuku.money_amazon_orders(id, family_id) ON DELETE CASCADE;


--
-- Name: money_amazon_orders money_amazon_orders_adjust_feed_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_orders
    ADD CONSTRAINT money_amazon_orders_adjust_feed_fkey FOREIGN KEY (adjust_feed_id, family_id) REFERENCES sukusuku.money_feed(id, family_id) ON DELETE SET NULL (adjust_feed_id);


--
-- Name: money_amazon_orders money_amazon_orders_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_orders
    ADD CONSTRAINT money_amazon_orders_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_amazon_shipment_lines money_amazon_shipment_lines_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipment_lines
    ADD CONSTRAINT money_amazon_shipment_lines_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_amazon_shipment_lines money_amazon_shipment_lines_line_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipment_lines
    ADD CONSTRAINT money_amazon_shipment_lines_line_id_fkey FOREIGN KEY (line_id) REFERENCES sukusuku.money_amazon_lines(id) ON DELETE SET NULL;


--
-- Name: money_amazon_shipment_lines money_amazon_shipment_lines_shipment_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipment_lines
    ADD CONSTRAINT money_amazon_shipment_lines_shipment_fkey FOREIGN KEY (shipment_id, family_id) REFERENCES sukusuku.money_amazon_shipments(id, family_id) ON DELETE CASCADE;


--
-- Name: money_amazon_shipments money_amazon_shipments_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipments
    ADD CONSTRAINT money_amazon_shipments_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_amazon_shipments money_amazon_shipments_feed_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_amazon_shipments
    ADD CONSTRAINT money_amazon_shipments_feed_fkey FOREIGN KEY (feed_id, family_id) REFERENCES sukusuku.money_feed(id, family_id) ON DELETE SET NULL (feed_id);


--
-- Name: money_categories money_categories_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_categories
    ADD CONSTRAINT money_categories_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_categories money_categories_parent_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_categories
    ADD CONSTRAINT money_categories_parent_fkey FOREIGN KEY (parent_id, family_id) REFERENCES sukusuku.money_categories(id, family_id) ON DELETE CASCADE;


--
-- Name: money_feed money_feed_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed
    ADD CONSTRAINT money_feed_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_feed_mails money_feed_mails_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_mails
    ADD CONSTRAINT money_feed_mails_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_feed money_feed_pair_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed
    ADD CONSTRAINT money_feed_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES sukusuku.money_feed(id) ON DELETE SET NULL;


--
-- Name: money_feed money_feed_record_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed
    ADD CONSTRAINT money_feed_record_fkey FOREIGN KEY (record_id, family_id) REFERENCES sukusuku.money_records(id, family_id) ON DELETE SET NULL (record_id);


--
-- Name: money_feed money_feed_resolved_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed
    ADD CONSTRAINT money_feed_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: money_feed_rules money_feed_rules_category_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_rules
    ADD CONSTRAINT money_feed_rules_category_fkey FOREIGN KEY (category_id, family_id) REFERENCES sukusuku.money_categories(id, family_id) ON DELETE SET NULL (category_id);


--
-- Name: money_feed_rules money_feed_rules_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_rules
    ADD CONSTRAINT money_feed_rules_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_feed_rules money_feed_rules_recurring_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_rules
    ADD CONSTRAINT money_feed_rules_recurring_id_fkey FOREIGN KEY (recurring_id) REFERENCES sukusuku.money_recurring(id) ON DELETE CASCADE;


--
-- Name: money_feed_rules money_feed_rules_to_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_rules
    ADD CONSTRAINT money_feed_rules_to_wallet_fkey FOREIGN KEY (to_wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE CASCADE;


--
-- Name: money_feed_rules money_feed_rules_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_rules
    ADD CONSTRAINT money_feed_rules_wallet_fkey FOREIGN KEY (wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE CASCADE;


--
-- Name: money_feed_settings money_feed_settings_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_settings
    ADD CONSTRAINT money_feed_settings_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_feed_tokens money_feed_tokens_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed_tokens
    ADD CONSTRAINT money_feed_tokens_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_feed money_feed_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_feed
    ADD CONSTRAINT money_feed_wallet_fkey FOREIGN KEY (wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE SET NULL (wallet_id);


--
-- Name: money_holding_values money_holding_values_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holding_values
    ADD CONSTRAINT money_holding_values_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_holding_values money_holding_values_holding_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holding_values
    ADD CONSTRAINT money_holding_values_holding_fkey FOREIGN KEY (holding_id, family_id) REFERENCES sukusuku.money_holdings(id, family_id) ON DELETE CASCADE;


--
-- Name: money_holdings money_holdings_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holdings
    ADD CONSTRAINT money_holdings_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_holdings money_holdings_security_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holdings
    ADD CONSTRAINT money_holdings_security_fkey FOREIGN KEY (security_id, family_id) REFERENCES sukusuku.money_securities(id, family_id) ON DELETE CASCADE;


--
-- Name: money_holdings money_holdings_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_holdings
    ADD CONSTRAINT money_holdings_wallet_fkey FOREIGN KEY (wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE CASCADE;


--
-- Name: money_items money_items_category_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_items
    ADD CONSTRAINT money_items_category_fkey FOREIGN KEY (category_id, family_id) REFERENCES sukusuku.money_categories(id, family_id) ON DELETE SET NULL (category_id);


--
-- Name: money_items money_items_record_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_items
    ADD CONSTRAINT money_items_record_fkey FOREIGN KEY (record_id, family_id) REFERENCES sukusuku.money_records(id, family_id) ON DELETE CASCADE;


--
-- Name: money_month_requests money_month_requests_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_month_requests
    ADD CONSTRAINT money_month_requests_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_month_requests money_month_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_month_requests
    ADD CONSTRAINT money_month_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: money_month_wallet_checks money_month_wallet_checks_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_month_wallet_checks
    ADD CONSTRAINT money_month_wallet_checks_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_month_wallet_checks money_month_wallet_checks_user_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_month_wallet_checks
    ADD CONSTRAINT money_month_wallet_checks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: money_month_wallet_checks money_month_wallet_checks_wallet_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_month_wallet_checks
    ADD CONSTRAINT money_month_wallet_checks_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES sukusuku.money_wallets(id) ON DELETE CASCADE;


--
-- Name: money_months money_months_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_months
    ADD CONSTRAINT money_months_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_ratio_targets money_ratio_targets_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_ratio_targets
    ADD CONSTRAINT money_ratio_targets_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_receipt_scans money_receipt_scans_created_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_receipt_scans
    ADD CONSTRAINT money_receipt_scans_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: money_receipt_scans money_receipt_scans_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_receipt_scans
    ADD CONSTRAINT money_receipt_scans_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_records money_records_created_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: money_records money_records_draw_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_draw_id_fkey FOREIGN KEY (draw_id) REFERENCES sukusuku.subsidy_draws(id);


--
-- Name: money_records money_records_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_records money_records_feed_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_feed_fkey FOREIGN KEY (feed_id, family_id) REFERENCES sukusuku.money_feed(id, family_id) ON DELETE SET NULL (feed_id);


--
-- Name: money_records money_records_recurring_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_recurring_fkey FOREIGN KEY (recurring_id, family_id) REFERENCES sukusuku.money_recurring(id, family_id) ON DELETE SET NULL (recurring_id);


--
-- Name: money_records money_records_to_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_to_wallet_fkey FOREIGN KEY (to_wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE SET NULL (to_wallet_id);


--
-- Name: money_records money_records_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_records
    ADD CONSTRAINT money_records_wallet_fkey FOREIGN KEY (wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE SET NULL (wallet_id);


--
-- Name: money_recurring money_recurring_category_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_recurring
    ADD CONSTRAINT money_recurring_category_fkey FOREIGN KEY (category_id, family_id) REFERENCES sukusuku.money_categories(id, family_id) ON DELETE SET NULL (category_id);


--
-- Name: money_recurring money_recurring_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_recurring
    ADD CONSTRAINT money_recurring_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_recurring money_recurring_to_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_recurring
    ADD CONSTRAINT money_recurring_to_wallet_fkey FOREIGN KEY (to_wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE SET NULL (to_wallet_id);


--
-- Name: money_recurring money_recurring_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_recurring
    ADD CONSTRAINT money_recurring_wallet_fkey FOREIGN KEY (wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE SET NULL (wallet_id);


--
-- Name: money_securities money_securities_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_securities
    ADD CONSTRAINT money_securities_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_security_prices money_security_prices_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_security_prices
    ADD CONSTRAINT money_security_prices_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_security_prices money_security_prices_security_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_security_prices
    ADD CONSTRAINT money_security_prices_security_fkey FOREIGN KEY (security_id, family_id) REFERENCES sukusuku.money_securities(id, family_id) ON DELETE CASCADE;


--
-- Name: money_stores money_stores_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_stores
    ADD CONSTRAINT money_stores_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_wallet_balances money_wallet_balances_created_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallet_balances
    ADD CONSTRAINT money_wallet_balances_created_by_fkey FOREIGN KEY (created_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: money_wallet_balances money_wallet_balances_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallet_balances
    ADD CONSTRAINT money_wallet_balances_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_wallet_balances money_wallet_balances_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallet_balances
    ADD CONSTRAINT money_wallet_balances_wallet_fkey FOREIGN KEY (wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE CASCADE;


--
-- Name: money_wallets money_wallets_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallets
    ADD CONSTRAINT money_wallets_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: money_wallets money_wallets_pay_wallet_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.money_wallets
    ADD CONSTRAINT money_wallets_pay_wallet_fkey FOREIGN KEY (pay_wallet_id, family_id) REFERENCES sukusuku.money_wallets(id, family_id) ON DELETE SET NULL (pay_wallet_id);


--
-- Name: nurseries nurseries_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.nurseries
    ADD CONSTRAINT nurseries_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: nursing_alarms nursing_alarms_subscription_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.nursing_alarms
    ADD CONSTRAINT nursing_alarms_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES sukusuku.push_subscriptions(id) ON DELETE CASCADE;


--
-- Name: nursing_alarms nursing_alarms_user_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.nursing_alarms
    ADD CONSTRAINT nursing_alarms_user_id_fkey FOREIGN KEY (user_id) REFERENCES sukusuku.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.push_subscriptions
    ADD CONSTRAINT push_subscriptions_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES sukusuku.users(id) ON DELETE CASCADE;


--
-- Name: reminder_deliveries reminder_deliveries_subscription_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.reminder_deliveries
    ADD CONSTRAINT reminder_deliveries_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES sukusuku.push_subscriptions(id) ON DELETE CASCADE;


--
-- Name: reminder_deliveries reminder_deliveries_task_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.reminder_deliveries
    ADD CONSTRAINT reminder_deliveries_task_id_fkey FOREIGN KEY (task_id) REFERENCES sukusuku.tasks(id) ON DELETE CASCADE;


--
-- Name: stock_expiry_deliveries stock_expiry_deliveries_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_expiry_deliveries
    ADD CONSTRAINT stock_expiry_deliveries_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: stock_expiry_deliveries stock_expiry_deliveries_subscription_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_expiry_deliveries
    ADD CONSTRAINT stock_expiry_deliveries_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES sukusuku.push_subscriptions(id) ON DELETE CASCADE;


--
-- Name: stock_items stock_items_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_items
    ADD CONSTRAINT stock_items_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: stock_items stock_items_target_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_items
    ADD CONSTRAINT stock_items_target_id_fkey FOREIGN KEY (target_id) REFERENCES sukusuku.stock_targets(id) ON DELETE SET NULL;


--
-- Name: stock_targets stock_targets_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.stock_targets
    ADD CONSTRAINT stock_targets_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: subsidy_draws subsidy_draws_drawn_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.subsidy_draws
    ADD CONSTRAINT subsidy_draws_drawn_by_fkey FOREIGN KEY (drawn_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: subsidy_draws subsidy_draws_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.subsidy_draws
    ADD CONSTRAINT subsidy_draws_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES sukusuku.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.tasks
    ADD CONSTRAINT tasks_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: temperature_reminder_deliveries temperature_reminder_deliveries_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.temperature_reminder_deliveries
    ADD CONSTRAINT temperature_reminder_deliveries_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: temperature_reminder_deliveries temperature_reminder_deliveries_subscription_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.temperature_reminder_deliveries
    ADD CONSTRAINT temperature_reminder_deliveries_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES sukusuku.push_subscriptions(id) ON DELETE CASCADE;


--
-- Name: temperature_reminder_settings temperature_reminder_settings_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.temperature_reminder_settings
    ADD CONSTRAINT temperature_reminder_settings_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE CASCADE;


--
-- Name: users users_family_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.users
    ADD CONSTRAINT users_family_id_fkey FOREIGN KEY (family_id) REFERENCES sukusuku.families(id) ON DELETE SET NULL;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: sukusuku; Owner: -
--

ALTER TABLE ONLY sukusuku.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: care_logs; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.care_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: care_logs care_logs_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY care_logs_family_all ON sukusuku.care_logs USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: children; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.children ENABLE ROW LEVEL SECURITY;

--
-- Name: children children_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY children_family_all ON sukusuku.children USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: contract_deliveries; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.contract_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_deliveries contract_deliveries_own_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY contract_deliveries_own_select ON sukusuku.contract_deliveries FOR SELECT USING ((EXISTS ( SELECT 1
   FROM sukusuku.push_subscriptions s
  WHERE ((s.id = contract_deliveries.subscription_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: contract_fields; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.contract_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_fields contract_fields_visible_contract; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY contract_fields_visible_contract ON sukusuku.contract_fields USING ((EXISTS ( SELECT 1
   FROM sukusuku.contracts c
  WHERE (c.id = contract_fields.contract_id)))) WITH CHECK ((EXISTS ( SELECT 1
   FROM sukusuku.contracts c
  WHERE (c.id = contract_fields.contract_id))));


--
-- Name: contracts; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts contracts_visible; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY contracts_visible ON sukusuku.contracts USING (((family_id = sukusuku.current_family_id()) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (( SELECT sukusuku.my_member_id() AS my_member_id) = ANY (visible_member_ids))))) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: documents; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: documents documents_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY documents_family_all ON sukusuku.documents USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: families; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.families ENABLE ROW LEVEL SECURITY;

--
-- Name: families families_insert_any; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY families_insert_any ON sukusuku.families FOR INSERT WITH CHECK (true);


--
-- Name: families families_select_own; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY families_select_own ON sukusuku.families FOR SELECT USING ((id = sukusuku.current_family_id()));


--
-- Name: families families_update_guardian; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY families_update_guardian ON sukusuku.families FOR UPDATE USING (((id = sukusuku.current_family_id()) AND sukusuku.is_family_guardian())) WITH CHECK ((id = sukusuku.current_family_id()));


--
-- Name: family_members; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.family_members ENABLE ROW LEVEL SECURITY;

--
-- Name: family_members family_members_select_family; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY family_members_select_family ON sukusuku.family_members FOR SELECT USING ((family_id = sukusuku.current_family_id()));


--
-- Name: family_members family_members_update_guardian_or_self; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY family_members_update_guardian_or_self ON sukusuku.family_members FOR UPDATE USING (((family_id = sukusuku.current_family_id()) AND (sukusuku.is_family_guardian() OR (user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: family_sync; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.family_sync ENABLE ROW LEVEL SECURITY;

--
-- Name: family_sync family_sync_family_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY family_sync_family_select ON sukusuku.family_sync FOR SELECT TO authenticated USING ((family_id = ( SELECT sukusuku.current_family_id() AS current_family_id)));


--
-- Name: feeding_reminder_deliveries; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.feeding_reminder_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: feeding_reminder_deliveries feeding_reminder_deliveries_own_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY feeding_reminder_deliveries_own_select ON sukusuku.feeding_reminder_deliveries FOR SELECT USING ((EXISTS ( SELECT 1
   FROM sukusuku.push_subscriptions s
  WHERE ((s.id = feeding_reminder_deliveries.subscription_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: feeding_settings; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.feeding_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: feeding_settings feeding_settings_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY feeding_settings_family_all ON sukusuku.feeding_settings USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: gifts; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.gifts ENABLE ROW LEVEL SECURITY;

--
-- Name: gifts gifts_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY gifts_family_all ON sukusuku.gifts USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: growth_records; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.growth_records ENABLE ROW LEVEL SECURITY;

--
-- Name: growth_records growth_records_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY growth_records_family_all ON sukusuku.growth_records USING ((EXISTS ( SELECT 1
   FROM sukusuku.children c
  WHERE ((c.id = growth_records.child_id) AND (c.family_id = sukusuku.current_family_id()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM sukusuku.children c
  WHERE ((c.id = growth_records.child_id) AND (c.family_id = sukusuku.current_family_id())))));


--
-- Name: list_groups; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.list_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: list_groups list_groups_visible_list; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY list_groups_visible_list ON sukusuku.list_groups USING ((EXISTS ( SELECT 1
   FROM sukusuku.lists l
  WHERE ((l.id = list_groups.list_id) AND (l.family_id = sukusuku.current_family_id()) AND ((NOT l.is_private) OR (l.created_by = ( SELECT auth.uid() AS uid))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM sukusuku.lists l
  WHERE ((l.id = list_groups.list_id) AND (l.family_id = sukusuku.current_family_id()) AND ((NOT l.is_private) OR (l.created_by = ( SELECT auth.uid() AS uid)))))));


--
-- Name: list_items; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.list_items ENABLE ROW LEVEL SECURITY;

--
-- Name: list_items list_items_visible_list; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY list_items_visible_list ON sukusuku.list_items USING ((EXISTS ( SELECT 1
   FROM sukusuku.lists l
  WHERE ((l.id = list_items.list_id) AND (l.family_id = sukusuku.current_family_id()) AND ((NOT l.is_private) OR (l.created_by = ( SELECT auth.uid() AS uid))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM sukusuku.lists l
  WHERE ((l.id = list_items.list_id) AND (l.family_id = sukusuku.current_family_id()) AND ((NOT l.is_private) OR (l.created_by = ( SELECT auth.uid() AS uid)))))));


--
-- Name: lists; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.lists ENABLE ROW LEVEL SECURITY;

--
-- Name: lists lists_delete_shared_or_own; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY lists_delete_shared_or_own ON sukusuku.lists FOR DELETE USING (((family_id = sukusuku.current_family_id()) AND ((NOT is_private) OR (created_by = ( SELECT auth.uid() AS uid)))));


--
-- Name: lists lists_insert_family; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY lists_insert_family ON sukusuku.lists FOR INSERT WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: lists lists_select_shared_or_own; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY lists_select_shared_or_own ON sukusuku.lists FOR SELECT USING (((family_id = sukusuku.current_family_id()) AND ((NOT is_private) OR (created_by = ( SELECT auth.uid() AS uid)))));


--
-- Name: lists lists_update_shared_or_own; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY lists_update_shared_or_own ON sukusuku.lists FOR UPDATE USING (((family_id = sukusuku.current_family_id()) AND ((NOT is_private) OR (created_by = ( SELECT auth.uid() AS uid))))) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: lottery_coupons; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.lottery_coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: lottery_coupons lottery_coupons_family_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY lottery_coupons_family_select ON sukusuku.lottery_coupons FOR SELECT USING (((family_id = sukusuku.current_family_id()) AND ((NOT is_test) OR (owner_id = auth.uid()))));


--
-- Name: member_invites; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.member_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: money_amazon_lines; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_amazon_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: money_amazon_orders; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_amazon_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: money_amazon_shipment_lines; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_amazon_shipment_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: money_amazon_shipments; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_amazon_shipments ENABLE ROW LEVEL SECURITY;

--
-- Name: money_categories; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: money_categories money_categories_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_categories_family_all ON sukusuku.money_categories USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_feed; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_feed ENABLE ROW LEVEL SECURITY;

--
-- Name: money_feed money_feed_family_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_feed_family_select ON sukusuku.money_feed FOR SELECT USING ((family_id = sukusuku.current_family_id()));


--
-- Name: money_feed money_feed_family_update; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_feed_family_update ON sukusuku.money_feed FOR UPDATE USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_feed_mails; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_feed_mails ENABLE ROW LEVEL SECURITY;

--
-- Name: money_feed_rules; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_feed_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: money_feed_rules money_feed_rules_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_feed_rules_family_all ON sukusuku.money_feed_rules USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_feed_settings; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_feed_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: money_feed_settings money_feed_settings_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_feed_settings_family_all ON sukusuku.money_feed_settings USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_feed_tokens; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_feed_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: money_fx_rates; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_fx_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: money_fx_rates money_fx_rates_authenticated_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_fx_rates_authenticated_select ON sukusuku.money_fx_rates FOR SELECT TO authenticated USING (true);


--
-- Name: money_holding_values; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_holding_values ENABLE ROW LEVEL SECURITY;

--
-- Name: money_holding_values money_holding_values_family_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_holding_values_family_select ON sukusuku.money_holding_values FOR SELECT USING ((family_id = sukusuku.current_family_id()));


--
-- Name: money_holdings; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_holdings ENABLE ROW LEVEL SECURITY;

--
-- Name: money_holdings money_holdings_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_holdings_family_all ON sukusuku.money_holdings USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_items; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_items ENABLE ROW LEVEL SECURITY;

--
-- Name: money_items money_items_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_items_family_all ON sukusuku.money_items USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_month_requests; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_month_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: money_month_requests money_month_requests_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_month_requests_family_all ON sukusuku.money_month_requests USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_month_wallet_checks; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_month_wallet_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: money_month_wallet_checks money_month_wallet_checks_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_month_wallet_checks_family_all ON sukusuku.money_month_wallet_checks USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_months; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_months ENABLE ROW LEVEL SECURITY;

--
-- Name: money_months money_months_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_months_family_all ON sukusuku.money_months USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_ratio_targets; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_ratio_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: money_ratio_targets money_ratio_targets_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_ratio_targets_family_all ON sukusuku.money_ratio_targets USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_receipt_scans; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_receipt_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: money_records; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_records ENABLE ROW LEVEL SECURITY;

--
-- Name: money_records money_records_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_records_family_all ON sukusuku.money_records USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_recurring; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_recurring ENABLE ROW LEVEL SECURITY;

--
-- Name: money_recurring money_recurring_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_recurring_family_all ON sukusuku.money_recurring USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_securities; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_securities ENABLE ROW LEVEL SECURITY;

--
-- Name: money_securities money_securities_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_securities_family_all ON sukusuku.money_securities USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_security_prices; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_security_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: money_security_prices money_security_prices_family_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_security_prices_family_select ON sukusuku.money_security_prices FOR SELECT USING ((family_id = sukusuku.current_family_id()));


--
-- Name: money_stores; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_stores ENABLE ROW LEVEL SECURITY;

--
-- Name: money_stores money_stores_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_stores_family_all ON sukusuku.money_stores USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_wallet_balances; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_wallet_balances ENABLE ROW LEVEL SECURITY;

--
-- Name: money_wallet_balances money_wallet_balances_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_wallet_balances_family_all ON sukusuku.money_wallet_balances USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: money_wallets; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.money_wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: money_wallets money_wallets_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY money_wallets_family_all ON sukusuku.money_wallets USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: nurseries; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.nurseries ENABLE ROW LEVEL SECURITY;

--
-- Name: nurseries nurseries_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY nurseries_family_all ON sukusuku.nurseries USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: nursing_alarms; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.nursing_alarms ENABLE ROW LEVEL SECURITY;

--
-- Name: nursing_alarms nursing_alarms_family_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY nursing_alarms_family_select ON sukusuku.nursing_alarms FOR SELECT USING ((sukusuku.push_subscription_family_id(subscription_id) = sukusuku.current_family_id()));


--
-- Name: nursing_alarms nursing_alarms_own_delete; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY nursing_alarms_own_delete ON sukusuku.nursing_alarms FOR DELETE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: nursing_alarms nursing_alarms_own_insert; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY nursing_alarms_own_insert ON sukusuku.nursing_alarms FOR INSERT WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM sukusuku.push_subscriptions s
  WHERE ((s.id = nursing_alarms.subscription_id) AND (s.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: nursing_alarms nursing_alarms_own_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY nursing_alarms_own_select ON sukusuku.nursing_alarms FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: nursing_alarms nursing_alarms_own_update; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY nursing_alarms_own_update ON sukusuku.nursing_alarms FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_own_delete; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY push_subscriptions_own_delete ON sukusuku.push_subscriptions FOR DELETE USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: push_subscriptions push_subscriptions_own_insert; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY push_subscriptions_own_insert ON sukusuku.push_subscriptions FOR INSERT WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (family_id = sukusuku.current_family_id())));


--
-- Name: push_subscriptions push_subscriptions_own_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY push_subscriptions_own_select ON sukusuku.push_subscriptions FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: push_subscriptions push_subscriptions_own_update; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY push_subscriptions_own_update ON sukusuku.push_subscriptions FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: reminder_deliveries; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.reminder_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_deliveries reminder_deliveries_own_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY reminder_deliveries_own_select ON sukusuku.reminder_deliveries FOR SELECT USING ((EXISTS ( SELECT 1
   FROM sukusuku.push_subscriptions s
  WHERE ((s.id = reminder_deliveries.subscription_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: stock_expiry_deliveries; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.stock_expiry_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_expiry_deliveries stock_expiry_deliveries_own_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY stock_expiry_deliveries_own_select ON sukusuku.stock_expiry_deliveries FOR SELECT USING ((EXISTS ( SELECT 1
   FROM sukusuku.push_subscriptions s
  WHERE ((s.id = stock_expiry_deliveries.subscription_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: stock_items; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.stock_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_items stock_items_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY stock_items_family_all ON sukusuku.stock_items USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: stock_targets; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.stock_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_targets stock_targets_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY stock_targets_family_all ON sukusuku.stock_targets USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: subsidy_draws; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.subsidy_draws ENABLE ROW LEVEL SECURITY;

--
-- Name: subsidy_draws subsidy_draws_family_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY subsidy_draws_family_select ON sukusuku.subsidy_draws FOR SELECT USING (((family_id = sukusuku.current_family_id()) AND ((NOT is_test) OR (drawn_by = auth.uid()))));


--
-- Name: subsidy_draws subsidy_draws_own_insert; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY subsidy_draws_own_insert ON sukusuku.subsidy_draws FOR INSERT WITH CHECK (((family_id = sukusuku.current_family_id()) AND (drawn_by = auth.uid())));


--
-- Name: tasks; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks tasks_delete_shared_or_own; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY tasks_delete_shared_or_own ON sukusuku.tasks FOR DELETE USING (((family_id = sukusuku.current_family_id()) AND ((NOT is_private) OR (created_by = ( SELECT auth.uid() AS uid)))));


--
-- Name: tasks tasks_insert_family; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY tasks_insert_family ON sukusuku.tasks FOR INSERT WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: tasks tasks_select_shared_or_own; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY tasks_select_shared_or_own ON sukusuku.tasks FOR SELECT USING (((family_id = sukusuku.current_family_id()) AND ((NOT is_private) OR (created_by = ( SELECT auth.uid() AS uid)))));


--
-- Name: tasks tasks_update_shared_or_own; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY tasks_update_shared_or_own ON sukusuku.tasks FOR UPDATE USING (((family_id = sukusuku.current_family_id()) AND ((NOT is_private) OR (created_by = ( SELECT auth.uid() AS uid))))) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: temperature_reminder_deliveries; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.temperature_reminder_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: temperature_reminder_deliveries temperature_reminder_deliveries_own_select; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY temperature_reminder_deliveries_own_select ON sukusuku.temperature_reminder_deliveries FOR SELECT USING ((EXISTS ( SELECT 1
   FROM sukusuku.push_subscriptions s
  WHERE ((s.id = temperature_reminder_deliveries.subscription_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: temperature_reminder_settings; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.temperature_reminder_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: temperature_reminder_settings temperature_reminder_settings_family_all; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY temperature_reminder_settings_family_all ON sukusuku.temperature_reminder_settings USING ((family_id = sukusuku.current_family_id())) WITH CHECK ((family_id = sukusuku.current_family_id()));


--
-- Name: users; Type: ROW SECURITY; Schema: sukusuku; Owner: -
--

ALTER TABLE sukusuku.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert_self; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY users_insert_self ON sukusuku.users FOR INSERT WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: users users_select_self_or_family; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY users_select_self_or_family ON sukusuku.users FOR SELECT USING (((id = ( SELECT auth.uid() AS uid)) OR (family_id = sukusuku.current_family_id())));


--
-- Name: users users_update_self; Type: POLICY; Schema: sukusuku; Owner: -
--

CREATE POLICY users_update_self ON sukusuku.users FOR UPDATE USING ((id = ( SELECT auth.uid() AS uid)));


--
-- PostgreSQL database dump complete
--



--
-- 権限（旧プロジェクトの本番の付与に合わせる。anon には付けない）
--

GRANT USAGE ON SCHEMA sukusuku TO authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA sukusuku FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sukusuku TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA sukusuku TO service_role;

-- users は読む・消すだけ。書き換えてよい列は2つ（0077）。
REVOKE ALL ON sukusuku.users FROM authenticated;
GRANT SELECT, DELETE ON sukusuku.users TO authenticated;
GRANT UPDATE (start_tab, show_care_tab) ON sukusuku.users TO authenticated;
-- 変更台帳は読むだけ（書くのはトリガー）。
REVOKE ALL ON sukusuku.family_sync FROM authenticated;
GRANT SELECT ON sukusuku.family_sync TO authenticated;
-- 招待コードと、Edge Function が読む送信予定のビューは関数・service_role からだけ。
REVOKE ALL ON sukusuku.member_invites FROM authenticated;
REVOKE ALL ON sukusuku.next_feeding_schedule, sukusuku.task_reminder_schedule,
  sukusuku.temperature_reminder_schedule FROM authenticated;

-- 関数: 既定の PUBLIC 実行権を外し、アプリから呼ぶものだけ authenticated に付ける。
-- 計算だけの関数・トリガー関数（旧本番で PUBLIC のままのもの）は PUBLIC を残す。
DO $$
DECLARE
  f regprocedure;
  keep_public text[] := array[
    'contracts_set_notify_after', 'jp_base_holiday_name', 'jp_holiday_name',
    'money_categories_keep_name', 'money_day_of_month', 'money_feed_key', 'money_feed_requester',
    'money_is_business_day', 'money_items_check_record_total', 'money_record_amount',
    'money_rule_date', 'money_shift_business_day', 'money_stores_set_position',
    'money_wallets_card_start', 'my_member_id', 'set_updated_at'];
  for_app text[] := array[
    'create_member_invite', 'create_my_family', 'current_family_id', 'is_family_guardian',
    'lottery_delete_my_test_data', 'lottery_open_box', 'lottery_use_coupon', 'lottery_use_rate_up',
    'money_bootstrap', 'money_feed_fill', 'money_feed_issue_token', 'money_feed_last_sync',
    'money_feed_order_lines', 'money_feed_reprocess', 'money_feed_resolve',
    'money_latest_holding_values', 'push_subscription_family_id', 'redeem_member_invite',
    'request_money_month_close', 'save_money_record'];
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'sukusuku'::regnamespace LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    IF (SELECT proname FROM pg_proc WHERE oid = f) = ANY (keep_public) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', f);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
      IF (SELECT proname FROM pg_proc WHERE oid = f) = ANY (for_app) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
      END IF;
    END IF;
  END LOOP;
END
$$;
