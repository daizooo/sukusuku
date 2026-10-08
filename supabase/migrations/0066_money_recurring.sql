-- かぞく手帳: 家計の毎月の自動記録（固定費・給料・カード代金。docs/kakei.md §3.3・§3.4・§7 の4）
--
-- 口座から落ちるもの・口座に入るものを、項目ごとのルール（money_recurring）から毎日サーバーで記録する。
-- カード代金は、カードの出金元に締め日・引き落とし日・引き落とし口座を持たせ、締め日で区切った期間の
-- 合計で「引き落とし口座 → カード」の振替を作る。どちらも pg_cron から make_money_recurring_records() を呼ぶ。
--
--   money_recurring   ルール。種類・出金元・お店・引き落とし日・休日のとき・額の決め方
--   money_records     is_estimate（見込み）・recurring_id（どのルールから作ったか）・month（どの月の分か）を足す
--   money_wallets     カードの close_day（締め日）・pay_day（引き落とし日）・pay_wallet_id（引き落とし口座）を足す
--
-- 二重に作らない仕組み: ルール・カードごとに「どの月の分まで作ったか」（made_through・card_made_through）を持ち、
-- それより後の月だけを作る。記録を人が消しても、また作り直さない。
-- 休日は「国民の祝日に関する法律」のいまの形（アプリの japaneseHolidays.ts と同じ数え方）に、
-- 銀行の休業日（土日・12月31日〜1月3日）を足したもの。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 列と表を足すだけ。古いアプリは読まないだけで、今までどおり動く
--   - 古いアプリで見込みの記録を保存すると、見込みの印が外れる（save_money_record。額を確かめて直した扱い）

-- ============================================================
-- 1. 祝日と銀行の営業日
-- ============================================================
-- 祝日の名前（祝日でなければ null）。src/lib/japaneseHolidays.ts の getHolidayName と同じ数え方。
-- 過去にだけあった祝日や、一度きりの移動は入れない。春分・秋分は 1980〜2099年の近似式。
create or replace function public.jp_base_holiday_name(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$
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

create or replace function public.jp_holiday_name(p_date date)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := public.jp_base_holiday_name(p_date);
  v_day date;
begin
  if v_name is not null then
    return v_name;
  end if;
  -- 国民の休日。前後を祝日に挟まれた平日（日曜は振替休日のもとになるので除く）。
  if extract(dow from p_date) <> 0
     and public.jp_base_holiday_name(p_date - 1) is not null
     and public.jp_base_holiday_name(p_date + 1) is not null then
    return '国民の休日';
  end if;
  -- 振替休日。日曜と重なった祝日から、続く休みを越えた最初の日。
  v_day := p_date - 1;
  while public.jp_base_holiday_name(v_day) is not null
        or (extract(dow from v_day) <> 0
            and public.jp_base_holiday_name(v_day - 1) is not null
            and public.jp_base_holiday_name(v_day + 1) is not null) loop
    if extract(dow from v_day) = 0 and public.jp_base_holiday_name(v_day) is not null then
      return '振替休日';
    end if;
    v_day := v_day - 1;
  end loop;
  return null;
end;
$$;

comment on function public.jp_holiday_name(date) is
  '日本の祝日の名前（祝日でなければ null）。アプリの japaneseHolidays.ts と同じ数え方。docs/kakei.md §3.3。';

-- 銀行の営業日か（土日・祝日・12月31日〜1月3日は休み）。
create or replace function public.money_is_business_day(p_date date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select extract(isodow from p_date) < 6
     and public.jp_holiday_name(p_date) is null
     and to_char(p_date, 'MM-DD') not in ('12-31', '01-01', '01-02', '01-03');
$$;

-- その月の◯日（その月に無い日は末日。31 は「末日」）。p_month は月の1日。
create or replace function public.money_day_of_month(p_month date, p_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', p_month)::date
          + (least(p_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer) - 1))::date;
$$;

-- 休日のときに動かす。'next' 翌営業日／'prev' 前営業日／'none' そのまま。
create or replace function public.money_shift_business_day(p_date date, p_holiday text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_date date := p_date;
begin
  if p_holiday not in ('next', 'prev') then
    return v_date;
  end if;
  while not public.money_is_business_day(v_date) loop
    v_date := v_date + case when p_holiday = 'next' then 1 else -1 end;
  end loop;
  return v_date;
end;
$$;

-- ============================================================
-- 2. money_recurring: 毎月の記録のルール
-- ============================================================
create table if not exists public.money_recurring (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense', 'income', 'transfer')),
  -- 引き落とし日（毎月◯日）。その月に無い日は末日（31 は「末日」）。
  day smallint not null check (day between 1 and 31),
  -- 記録する月（1〜12）。null は毎月。賞与など年に数回のものに使う。
  months smallint[] check (months is null or (cardinality(months) > 0 and months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])),
  -- 休日のとき。翌営業日（next）／前営業日（prev）／そのまま（none）。
  holiday text not null default 'next' check (holiday in ('next', 'prev', 'none')),
  -- 額の決め方。固定額（fixed）は amount で確定として作る。見込む（estimate）は過去の記録から出し、
  -- 過去の記録が無いときだけ amount を使う。
  amount_mode text not null default 'estimate' check (amount_mode in ('fixed', 'estimate')),
  amount integer not null default 0 check (amount >= 0),
  -- 出金元（収入は入金先）。振替は出金元 → 入金先（to_wallet_id）。
  wallet_id uuid,
  to_wallet_id uuid,
  store text not null default '',
  -- 品目の種類（小分類か大分類）か特別費の項目（賞与＝特別収入など）。振替はどちらも null。
  category_id uuid,
  special_item_id uuid,
  -- 品名（任意。記録の品目の品名になる）。
  name text not null default '',
  position integer not null default 0,
  archived_at timestamptz,
  -- どの月の分まで作ったか（月の1日）。これより後の月だけを作る（記録を消しても作り直さない）。
  made_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_recurring_id_family_key unique (id, family_id),
  constraint money_recurring_wallet_fkey foreign key (wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete set null (wallet_id),
  constraint money_recurring_to_wallet_fkey foreign key (to_wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete set null (to_wallet_id),
  constraint money_recurring_category_fkey foreign key (category_id, family_id)
    references public.money_categories (id, family_id) on delete set null (category_id),
  constraint money_recurring_special_item_fkey foreign key (special_item_id, family_id)
    references public.special_items (id, family_id) on delete cascade,
  constraint money_recurring_category_or_special_check check (category_id is null or special_item_id is null)
);

comment on table public.money_recurring is
  '家計の毎月の記録のルール（固定費・給料など）。サーバーが毎日、その日に当たる記録を作る。docs/kakei.md §3.3。';

create index if not exists idx_money_recurring_family_id on public.money_recurring (family_id);
create index if not exists idx_money_recurring_wallet_id on public.money_recurring (wallet_id);
create index if not exists idx_money_recurring_to_wallet_id on public.money_recurring (to_wallet_id);
create index if not exists idx_money_recurring_category_id on public.money_recurring (category_id);
create index if not exists idx_money_recurring_special_item_id on public.money_recurring (special_item_id);

drop trigger if exists money_recurring_set_updated_at on public.money_recurring;
create trigger money_recurring_set_updated_at
  before update on public.money_recurring
  for each row
  execute function public.set_updated_at();

alter table public.money_recurring enable row level security;

drop policy if exists "money_recurring_family_all" on public.money_recurring;
create policy "money_recurring_family_all" on public.money_recurring
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- ============================================================
-- 3. money_records: 見込み・どのルールの何月分か
-- ============================================================
alter table public.money_records
  add column if not exists is_estimate boolean not null default false,
  add column if not exists recurring_id uuid,
  add column if not exists month date;

alter table public.money_records drop constraint if exists money_records_recurring_fkey;
alter table public.money_records
  add constraint money_records_recurring_fkey foreign key (recurring_id, family_id)
    references public.money_recurring (id, family_id) on delete set null (recurring_id);

comment on column public.money_records.is_estimate is
  '見込みの額か。額を直す（確かめる）と false になる。振り返りでは見込みと分かるように出す。docs/kakei.md §3.3。';
comment on column public.money_records.recurring_id is
  'この記録を作った毎月の記録のルール。docs/kakei.md §3.3。';
comment on column public.money_records.month is
  '自動で作った記録が、どの月の分か（月の1日）。カード代金は引き落としの月。人が入れた記録は null。docs/kakei.md §3.3・§3.4。';

create index if not exists idx_money_records_recurring_id on public.money_records (recurring_id);
create unique index if not exists money_records_recurring_month_key
  on public.money_records (recurring_id, month) where recurring_id is not null;

-- ============================================================
-- 4. money_wallets: カードの締め日・引き落とし日・引き落とし口座
-- ============================================================
alter table public.money_wallets
  add column if not exists close_day smallint check (close_day is null or close_day between 1 and 31),
  add column if not exists pay_day smallint check (pay_day is null or pay_day between 1 and 31),
  add column if not exists pay_wallet_id uuid,
  add column if not exists card_made_through date;

alter table public.money_wallets drop constraint if exists money_wallets_pay_wallet_fkey;
alter table public.money_wallets
  add constraint money_wallets_pay_wallet_fkey foreign key (pay_wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete set null (pay_wallet_id);

comment on column public.money_wallets.close_day is
  'カードの締め日（31 は末日）。docs/kakei.md §3.4。';
comment on column public.money_wallets.pay_day is
  'カードの引き落とし日（31 は末日）。締め日のあとに来る最初のこの日に、休日なら翌営業日に落ちる。docs/kakei.md §3.4。';
comment on column public.money_wallets.pay_wallet_id is
  'カードの引き落とし口座。docs/kakei.md §3.4。';
comment on column public.money_wallets.card_made_through is
  'カード代金の振替を、どの月の引き落としの分まで作ったか（月の1日）。docs/kakei.md §3.4。';

create index if not exists idx_money_wallets_pay_wallet_id on public.money_wallets (pay_wallet_id);

-- カードの設定（締め日・引き落とし日・引き落とし口座）がそろったときは、もう過ぎた引き落としの分を
-- 作ったことにする（人がもう入れているはず）。今日以降の引き落としから作る。
create or replace function public.money_wallets_card_start()
returns trigger
language plpgsql
set search_path = ''
as $$
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
    when public.money_shift_business_day(public.money_day_of_month(v_this_month, new.pay_day), 'next') < v_today
      then v_this_month
    else (v_this_month - interval '1 month')::date
  end;
  return new;
end;
$$;

drop trigger if exists money_wallets_card_start on public.money_wallets;
create trigger money_wallets_card_start
  before insert or update of close_day, pay_day, pay_wallet_id on public.money_wallets
  for each row
  execute function public.money_wallets_card_start();

-- ============================================================
-- 5. 見込みの額
-- ============================================================
-- そのルールの過去1年の記録（種類・出金元・お店が同じで、見込みでないもの）から出す。
--   1. 前年の同じ回（前年のその月の引き落とし日の前後10日）の記録があれば、その額
--   2. 無ければ、直近3回の平均
--   3. 記録が1件も無ければ、ルールの amount
-- 1件の記録に同じ種類の品目が複数あれば合計する。
create or replace function public.money_recurring_estimate(p_rule public.money_recurring, p_month date, p_on date)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_last_year date := public.money_shift_business_day(
    public.money_day_of_month((p_month - interval '1 year')::date, p_rule.day), p_rule.holiday);
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

comment on function public.money_recurring_estimate(public.money_recurring, date, date) is
  '毎月の記録のルールの見込みの額（前年の同じ回、無ければ直近3回の平均）。docs/kakei.md §3.3。';

-- ============================================================
-- 6. 毎日の記録づくり
-- ============================================================
-- p_today（日本時間の今日）までに来た分を作る。先月・今月・来月の分を見る（前営業日へ動いて
-- 月をまたぐことがあるため）。実行が飛んだ日は、7日前の分までさかのぼって拾う。
-- ルール・カードの行を for update で押さえてから作るので、重なって動いても二重に作らない。
-- 作った記録の件数を返す。
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
      v_close := public.money_day_of_month(v_month, v_card.close_day);
      if v_close >= v_pay then
        v_close := public.money_day_of_month((v_month - interval '1 month')::date, v_card.close_day);
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

-- 家族をまたいで作るので、アプリからは呼ばせない（pg_cron は postgres で動く）。
revoke execute on function public.make_money_recurring_records(date) from public, anon, authenticated;
revoke execute on function public.money_recurring_estimate(public.money_recurring, date, date) from public, anon, authenticated;

-- ============================================================
-- 7. 記録の保存（0065 と同じ。見込みの印を受け取る処理を足した）
-- ============================================================
-- p_record.is_estimate: 見込みのまま残すときだけ true。省くと false（人が額を確かめた扱い）。
create or replace function public.save_money_record(p_record jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_family uuid := public.current_family_id();
  v_id uuid := nullif(p_record ->> 'id', '')::uuid;
  v_store text := btrim(coalesce(p_record ->> 'store', ''));
  v_estimate boolean := coalesce((p_record ->> 'is_estimate')::boolean, false);
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

  -- まだ登録の無いお店は、設定データとして登録する（使わなくしたお店はそのまま）。
  if v_store <> '' then
    insert into public.money_stores (family_id, name)
    values (v_family, v_store)
    on conflict (family_id, name) do nothing;
  end if;

  insert into public.money_items (
    family_id, record_id, amount, category_id, special_item_id, special_plan_id, product_id,
    quantity, unit_price, name, memo, position
  )
  select
    v_family,
    v_id,
    (item ->> 'amount')::integer,
    nullif(item ->> 'category_id', '')::uuid,
    nullif(item ->> 'special_item_id', '')::uuid,
    nullif(item ->> 'special_plan_id', '')::uuid,
    nullif(item ->> 'product_id', '')::uuid,
    coalesce((item ->> 'quantity')::integer, 1),
    (item ->> 'unit_price')::integer,
    coalesce(item ->> 'name', ''),
    coalesce(item ->> 'memo', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as entries (item, ordinality);

  update public.household_products as product
    set price = coalesce(item.unit_price, product.price),
        money_category_id = coalesce(product.money_category_id, item.category_id)
    from public.money_items as item
    where item.record_id = v_id
      and item.product_id = product.id;

  return v_id;
end;
$$;

comment on function public.save_money_record(jsonb, jsonb) is
  '家計の記録（詳細＋品目）を1回で保存する。品目は入れ替える。新しいお店は money_stores に登録する。見込みの印は p_record.is_estimate。docs/kakei.md §3.2・§3.3・§3.5。';

revoke execute on function public.save_money_record(jsonb, jsonb) from public, anon;
grant execute on function public.save_money_record(jsonb, jsonb) to authenticated;

-- ============================================================
-- 8. 毎朝の実行（日本時間 5:00 = UTC 20:00）
-- ============================================================
select cron.unschedule('make-money-recurring-records')
 where exists (select 1 from cron.job where jobname = 'make-money-recurring-records');

select cron.schedule(
  'make-money-recurring-records',
  '0 20 * * *',
  $cron$ select public.make_money_recurring_records(); $cron$
);
