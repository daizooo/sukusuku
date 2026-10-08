-- かぞく手帳: 証券の評価額（銘柄ごと。docs/kakei.md §7 の6・§9.2）
--
-- 証券口座は、証券会社ごとではなく銘柄ごとに追う。評価額 = 保有数 × 価格（ドル建ては × 為替）。
-- 価格と為替はサーバー（Edge Function fetch-security-prices。pg_cron から毎朝）が取って入れる。
--
--   money_securities       銘柄。 種類（米国株・国内投信・預り金）/ 名前 / コード / 通貨
--   money_holdings         保有。 証券口座・銘柄・預り区分（NISA・特定など）ごとに1行。 保有数 / 取得単価（円）
--   money_security_prices  価格。 銘柄・日付（取得元の日付）ごとに1行
--   money_fx_rates         為替。 通貨・日付ごとに1行（家族によらない公開の値）
--   money_holding_values   保有ごとの日々の評価額。 推移はここから出す。保有数をあとで直しても、過去の行は変わらない
--
-- 評価額（円）= 保有数 × 価格 × 為替 ÷ 単位（国内投信は1万口あたりの価格なので 10000。ほかは 1）
-- 取得額（円）= 保有数 × 取得単価 ÷ 単位（取得単価はドル建ても円で入れる。§9.2.5）
-- 預り金（kind = 'cash'）は価格を 1 として数える（ドルの預り金は × 為替）。
--
-- 価格・為替・評価額の書き込みはサーバーだけ（アプリからは読むだけ）。
-- 保有を足す・直すと、その日の評価額の行を作り直す（トリガー）。過去1年の行は、銘柄を足したときに
-- Edge Function が価格を取ってから refresh_money_holding_values で作る（今の保有数で。§9.2.5）。
--
-- 適用の順序: 0069 とこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは表を読まないだけで、今までどおり動く

-- ============================================================
-- 1. money_securities: 銘柄
-- ============================================================
create table if not exists public.money_securities (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  -- 'us_stock' 米国株・米国ETF（Alpha Vantage）/ 'jp_fund' 国内の投資信託（投資信託協会の基準価額CSV）/ 'cash' 預り金
  kind text not null check (kind in ('us_stock', 'jp_fund', 'cash')),
  -- 米国株はティッカー、国内投信は ISIN コード。預り金は無し。
  code text,
  -- 国内投信の協会コード（基準価額CSVを取るのに ISIN と一緒に要る）。
  fund_code text,
  currency text not null default 'JPY' check (currency in ('JPY', 'USD')),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_securities_id_family_key unique (id, family_id),
  constraint money_securities_code_check check (kind = 'cash' or code is not null),
  constraint money_securities_fund_code_check check (kind <> 'jp_fund' or fund_code is not null)
);

comment on table public.money_securities is
  '家計の証券の銘柄（米国株・国内投信・預り金）。価格はサーバーが毎朝取る。docs/kakei.md §9.2。';

create index if not exists idx_money_securities_family_id on public.money_securities (family_id);

create trigger money_securities_set_updated_at
  before update on public.money_securities
  for each row
  execute function public.set_updated_at();

alter table public.money_securities enable row level security;

create policy "money_securities_family_all" on public.money_securities
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- ============================================================
-- 2. money_holdings: 保有（証券口座・銘柄・預り区分ごと）
-- ============================================================
create table if not exists public.money_holdings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  wallet_id uuid not null,
  security_id uuid not null,
  -- 預り区分。 'nisa' NISA成長投資枠 / 'nisa_tsumitate' NISAつみたて投資枠 / 'tokutei' 特定 / 'ippan' 一般
  account text not null default 'tokutei' check (account in ('nisa', 'nisa_tsumitate', 'tokutei', 'ippan')),
  -- 保有数（株数・口数・預り金の額）。小数もある。
  quantity numeric not null default 0 check (quantity >= 0),
  -- 取得単価（円）。国内投信は1万口あたり。預り金は無し。
  cost_price numeric check (cost_price is null or cost_price >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_holdings_id_family_key unique (id, family_id),
  constraint money_holdings_wallet_security_account_key unique (wallet_id, security_id, account),
  constraint money_holdings_wallet_fkey foreign key (wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete cascade,
  constraint money_holdings_security_fkey foreign key (security_id, family_id)
    references public.money_securities (id, family_id) on delete cascade
);

comment on table public.money_holdings is
  '家計の証券の保有（証券口座・銘柄・預り区分ごと）。保有数と取得単価（円）は人が直す。docs/kakei.md §9.2。';

create index if not exists idx_money_holdings_family_id on public.money_holdings (family_id);
create index if not exists idx_money_holdings_security_id on public.money_holdings (security_id);

create trigger money_holdings_set_updated_at
  before update on public.money_holdings
  for each row
  execute function public.set_updated_at();

alter table public.money_holdings enable row level security;

create policy "money_holdings_family_all" on public.money_holdings
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- ============================================================
-- 3. money_security_prices: 価格（サーバーが入れる）
-- ============================================================
create table if not exists public.money_security_prices (
  family_id uuid not null references public.families (id) on delete cascade,
  security_id uuid not null,
  -- 取得元の日付（米国株は取引日、国内投信は基準日）。
  price_on date not null,
  -- 価格（銘柄の通貨で。国内投信は1万口あたりの円）。
  price numeric not null check (price >= 0),
  created_at timestamptz not null default now(),
  primary key (security_id, price_on),
  constraint money_security_prices_security_fkey foreign key (security_id, family_id)
    references public.money_securities (id, family_id) on delete cascade
);

comment on table public.money_security_prices is
  '家計の証券の価格（取得元の日付ごと）。Edge Function fetch-security-prices が入れる。docs/kakei.md §9.2。';

create index if not exists idx_money_security_prices_family_id on public.money_security_prices (family_id);

alter table public.money_security_prices enable row level security;

create policy "money_security_prices_family_select" on public.money_security_prices
  for select using (family_id = public.current_family_id());

-- ============================================================
-- 4. money_fx_rates: 為替（家族によらない。サーバーが入れる）
-- ============================================================
create table if not exists public.money_fx_rates (
  currency text not null check (currency in ('USD')),
  -- ECB の参照レートの日付。
  rate_on date not null,
  -- 1単位あたりの円。
  rate numeric not null check (rate > 0),
  created_at timestamptz not null default now(),
  primary key (currency, rate_on)
);

comment on table public.money_fx_rates is
  '為替（1単位あたりの円。Frankfurter = ECB の参照レート）。家族によらない公開の値。docs/kakei.md §9.2。';

alter table public.money_fx_rates enable row level security;

create policy "money_fx_rates_authenticated_select" on public.money_fx_rates
  for select to authenticated using (true);

-- ============================================================
-- 5. money_holding_values: 保有ごとの日々の評価額（サーバーが入れる）
-- ============================================================
create table if not exists public.money_holding_values (
  family_id uuid not null references public.families (id) on delete cascade,
  holding_id uuid not null,
  -- 日本時間の日付。
  value_on date not null,
  quantity numeric not null,
  price numeric not null,
  fx numeric not null,
  -- 評価額（円）。
  value bigint not null,
  -- 取得額（円）。取得単価が無ければ無し。
  cost bigint,
  created_at timestamptz not null default now(),
  primary key (holding_id, value_on),
  constraint money_holding_values_holding_fkey foreign key (holding_id, family_id)
    references public.money_holdings (id, family_id) on delete cascade
);

comment on table public.money_holding_values is
  '家計の証券の、保有ごとの日々の評価額。推移と総残高（証券口座）はここから出す。docs/kakei.md §9.2。';

create index if not exists idx_money_holding_values_family_on on public.money_holding_values (family_id, value_on);

alter table public.money_holding_values enable row level security;

create policy "money_holding_values_family_select" on public.money_holding_values
  for select using (family_id = public.current_family_id());

-- ============================================================
-- 6. refresh_money_holding_values: 評価額の行を作る
-- ============================================================
-- p_from〜p_to の各日について、使っている保有の評価額の行を作る（今の保有数で）。
-- 価格・為替はその日以前で最新のもの。価格が1つも無い日は作らない。
-- p_to の日（ふつうは今日）の行は作り直し、それより前の日は、行が無いときだけ作る
-- （保有数をあとで直しても、過去の行は変えない。§9.2.5）。
-- p_holding_id を渡すと、その保有だけ。
create or replace function public.refresh_money_holding_values(
  p_from date,
  p_to date,
  p_holding_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.money_holding_values as hv
    (family_id, holding_id, value_on, quantity, price, fx, value, cost)
  select h.family_id, h.id, d.day::date, h.quantity, p.price, coalesce(fx.rate, 1),
         round(h.quantity * p.price * coalesce(fx.rate, 1) / u.unit)::bigint,
         case when h.cost_price is null then null else round(h.quantity * h.cost_price / u.unit)::bigint end
    from public.money_holdings h
    join public.money_securities s on s.id = h.security_id
    cross join generate_series(p_from, p_to, interval '1 day') as d(day)
    cross join lateral (select case when s.kind = 'jp_fund' then 10000 else 1 end as unit) u
    cross join lateral (
      select case when s.kind = 'cash' then 1::numeric else (
        select sp.price from public.money_security_prices sp
         where sp.security_id = s.id and sp.price_on <= d.day::date
         order by sp.price_on desc limit 1
      ) end as price
    ) p
    left join lateral (
      select r.rate from public.money_fx_rates r
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

comment on function public.refresh_money_holding_values(date, date, uuid) is
  '保有ごとの日々の評価額の行を作る（今の保有数で）。p_to の日は作り直し、前の日は無いときだけ作る。docs/kakei.md §9.2。';

-- 家族をまたいで作るので、アプリからは呼ばせない（Edge Function は service_role、pg_cron は postgres で動く）。
revoke execute on function public.refresh_money_holding_values(date, date, uuid) from public, anon, authenticated;

-- ============================================================
-- 7. 保有を足す・直すと、その日の評価額を作り直す
-- ============================================================
create or replace function public.money_holdings_refresh_today()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if new.archived_at is null then
    perform public.refresh_money_holding_values(v_today, v_today, new.id);
  else
    -- 使わなくした（売った）保有は、その日から評価額 0 とする（前の日の行は残す）。
    insert into public.money_holding_values (family_id, holding_id, value_on, quantity, price, fx, value, cost)
    values (new.family_id, new.id, v_today, 0, 0, 1, 0, null)
    on conflict (holding_id, value_on) do update
       set quantity = 0, price = 0, fx = 1, value = 0, cost = null;
  end if;
  return new;
end;
$$;

revoke execute on function public.money_holdings_refresh_today() from public, anon, authenticated;

create trigger money_holdings_refresh_today
  after insert or update of quantity, cost_price, archived_at on public.money_holdings
  for each row
  execute function public.money_holdings_refresh_today();
