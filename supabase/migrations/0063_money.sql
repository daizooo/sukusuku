-- かぞく手帳: 家計タブ（docs/kakei.md §5・§7 の2）
--
-- 日々の収支を記録する。1件の記録＝記録の詳細（money_records）＋品目（money_items）。Zaim と同じ組み立て。
--
--   money_categories  種類。大分類（parent_id が null）と小分類。生活費（living）と収入（income）
--   money_budgets     予算。大分類ごと・年度（4月始まり）ごとの月額
--   money_wallets     出金元。カード・財布・口座など。貯金用の口座は is_saving
--   money_records     記録の詳細。支出／収入／振替・日付・出金元（振替は入金先も）・お店
--   money_items       品目。金額・種類（小分類か大分類）か特別費の項目・品名・個数・単価・メモ
--
-- 特別費の項目・予定（special_items・special_plans）はそのまま使う。特別費の実績（special_actuals）は
-- 品目（special_item_id・special_plan_id を持つもの）へ移し、special_actuals は消す（docs/kakei.md §6）。
-- 移すのは行だけで、中身の値はリポジトリに書かない。
--
-- 日用品の台帳（household_products）に、その品を記録するときの種類（money_category_id）を足す。
-- 「日用品から選ぶ」の一覧のはじめの絞り込みに使う。台帳の「いつ・何個・いくらで買ったか」は、
-- product_id を持つ品目そのもの（docs/home.md §4.5）。
--
-- 最初に開くタブ（users.start_tab）に家計タブ（money）を足す。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは special_actuals を読めなくなり、暮らしタブの特別費の実績が空に見える
--     （読み込みの失敗は空として扱う作り）。「済」も保存できない。新しいアプリでは家計タブで見える
--   - それ以外（予定・項目・ほかのタブ）は今までどおり動く

-- ============================================================
-- 1. money_categories: 種類（大分類・小分類）
-- ============================================================
create table if not exists public.money_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- 生活費（living）か収入（income）。小分類は大分類と同じ値にする。
  kind text not null default 'living' check (kind in ('living', 'income')),
  -- 大分類なら null。小分類は大分類を指す。
  parent_id uuid,
  name text not null,
  position integer not null default 0,
  -- 使わなくした日時。記録に残っている種類は消さずに、これで選べなくする。
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_categories_id_family_key unique (id, family_id),
  constraint money_categories_parent_fkey foreign key (parent_id, family_id)
    references public.money_categories (id, family_id) on delete cascade
);

comment on table public.money_categories is
  '家計の種類。大分類（parent_id is null。予算を置く単位）と小分類（入力で選ぶ）。docs/kakei.md §3.1。';

create index if not exists idx_money_categories_family_id on public.money_categories (family_id);
create index if not exists idx_money_categories_parent_id on public.money_categories (parent_id);

drop trigger if exists money_categories_set_updated_at on public.money_categories;
create trigger money_categories_set_updated_at
  before update on public.money_categories
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- 2. money_budgets: 予算（大分類・年度ごとの月額）
-- ============================================================
create table if not exists public.money_budgets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  category_id uuid not null,
  -- 年度（4月始まりの年度の西暦。2026年4月〜2027年3月なら 2026）。特別費と同じ。
  fiscal_year integer not null,
  monthly_amount integer not null default 0 check (monthly_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_budgets_category_year_key unique (category_id, fiscal_year),
  constraint money_budgets_category_fkey foreign key (category_id, family_id)
    references public.money_categories (id, family_id) on delete cascade
);

comment on table public.money_budgets is
  '家計の予算。大分類ごと・年度ごとの月額。その年度の行が無ければ、前の年度の額を使う（docs/kakei.md §3.1）。';

create index if not exists idx_money_budgets_family_id on public.money_budgets (family_id);

drop trigger if exists money_budgets_set_updated_at on public.money_budgets;
create trigger money_budgets_set_updated_at
  before update on public.money_budgets
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- 3. money_wallets: 出金元
-- ============================================================
create table if not exists public.money_wallets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  type text not null default 'cash' check (type in ('card', 'cash', 'bank', 'prepaid', 'qr')),
  -- 貯金用の口座。ここへの振替を「貯金」として数える（docs/kakei.md §3.2）。
  is_saving boolean not null default false,
  -- 貯金の月の目標（円）。貯金用の口座だけ。
  saving_target integer check (saving_target is null or saving_target >= 0),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_wallets_id_family_key unique (id, family_id)
);

comment on table public.money_wallets is
  '家計の出金元（カード・財布・口座・プリペイド・QR決済）。is_saving は貯金用の口座（docs/kakei.md §3.2）。';

create index if not exists idx_money_wallets_family_id on public.money_wallets (family_id);

drop trigger if exists money_wallets_set_updated_at on public.money_wallets;
create trigger money_wallets_set_updated_at
  before update on public.money_wallets
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- 4. money_records: 記録の詳細
-- ============================================================
create table if not exists public.money_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense', 'income', 'transfer')),
  occurred_on date not null,
  -- 出金元（収入は入金先）。未設定もある（特別費の実績から移したものなど）。
  wallet_id uuid,
  -- 振替の入金先。振替だけ。
  to_wallet_id uuid,
  store text not null default '',
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_records_id_family_key unique (id, family_id),
  constraint money_records_wallet_fkey foreign key (wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete set null (wallet_id),
  constraint money_records_to_wallet_fkey foreign key (to_wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete set null (to_wallet_id)
);

comment on table public.money_records is
  '家計の記録の詳細（支出／収入／振替・日付・出金元・お店）。金額は品目（money_items）の合計（docs/kakei.md §3.2）。';

create index if not exists idx_money_records_family_occurred on public.money_records (family_id, occurred_on);
create index if not exists idx_money_records_wallet_id on public.money_records (wallet_id);
create index if not exists idx_money_records_to_wallet_id on public.money_records (to_wallet_id);
create index if not exists idx_money_records_created_by on public.money_records (created_by);

drop trigger if exists money_records_set_updated_at on public.money_records;
create trigger money_records_set_updated_at
  before update on public.money_records
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- 5. money_items: 品目
-- ============================================================
create table if not exists public.money_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  record_id uuid not null,
  amount integer not null default 0 check (amount >= 0),
  -- 種類（小分類か大分類）。特別費の品目と振替の品目は null。
  category_id uuid,
  -- 特別費の項目と、ひも付く予定（「済」）。予定外の特別費は special_plan_id が null。
  special_item_id uuid,
  special_plan_id uuid references public.special_plans (id) on delete set null,
  -- 日用品の台帳の品（任意）。
  product_id uuid references public.household_products (id) on delete set null,
  quantity integer not null default 1 check (quantity >= 1 and quantity <= 9999),
  -- 単価（円）。個数 × 単価 = 金額。電卓で金額だけ入れたものは null。
  unit_price integer check (unit_price is null or unit_price >= 0),
  name text not null default '',
  memo text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint money_items_record_fkey foreign key (record_id, family_id)
    references public.money_records (id, family_id) on delete cascade,
  constraint money_items_category_fkey foreign key (category_id, family_id)
    references public.money_categories (id, family_id),
  constraint money_items_special_item_fkey foreign key (special_item_id, family_id)
    references public.special_items (id, family_id) on delete cascade,
  constraint money_items_category_or_special_check check (category_id is null or special_item_id is null)
);

comment on table public.money_items is
  '家計の品目。種類（category_id）か特別費（special_item_id）を持つ。振替は金額だけ（docs/kakei.md §3.2・§5）。';

create index if not exists idx_money_items_record_id on public.money_items (record_id);
create index if not exists idx_money_items_family_id on public.money_items (family_id);
create index if not exists idx_money_items_category_id on public.money_items (category_id);
create index if not exists idx_money_items_special_item_id on public.money_items (special_item_id);
create index if not exists idx_money_items_special_plan_id on public.money_items (special_plan_id);
create index if not exists idx_money_items_product_id on public.money_items (product_id);

-- ============================================================
-- 6. 日用品の台帳に、記録するときの種類を足す
-- ============================================================
alter table public.household_products
  add column if not exists money_category_id uuid references public.money_categories (id) on delete set null;

comment on column public.household_products.money_category_id is
  'その品を家計に記録するときの種類（小分類）。「日用品から選ぶ」のはじめの絞り込みに使う（docs/kakei.md §5）。';

create index if not exists idx_household_products_money_category_id
  on public.household_products (money_category_id);

-- ============================================================
-- 7. Row Level Security（家族で共有する）
-- ============================================================
alter table public.money_categories enable row level security;
alter table public.money_budgets enable row level security;
alter table public.money_wallets enable row level security;
alter table public.money_records enable row level security;
alter table public.money_items enable row level security;

drop policy if exists "money_categories_family_all" on public.money_categories;
create policy "money_categories_family_all" on public.money_categories
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

drop policy if exists "money_budgets_family_all" on public.money_budgets;
create policy "money_budgets_family_all" on public.money_budgets
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

drop policy if exists "money_wallets_family_all" on public.money_wallets;
create policy "money_wallets_family_all" on public.money_wallets
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

drop policy if exists "money_records_family_all" on public.money_records;
create policy "money_records_family_all" on public.money_records
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

drop policy if exists "money_items_family_all" on public.money_items;
create policy "money_items_family_all" on public.money_items
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- ============================================================
-- 8. 記録の保存（記録の詳細と品目を1回で入れ替える）
-- ============================================================
-- p_record: { id?, kind, occurred_on, wallet_id?, to_wallet_id?, store }
-- p_items:  [{ amount, category_id?, special_item_id?, special_plan_id?, product_id?,
--              quantity, unit_price?, name, memo }]（並びが position になる）
-- 品目は毎回すべて入れ替える（品目を指すものは無い）。日用品の台帳の品は、
-- いつもの値段を今回の単価にし、記録するときの種類が空なら今回の種類を入れる（docs/kakei.md §3.2）。
-- 呼んだ人の権限で動く（RLS がそのまま効く）。
create or replace function public.save_money_record(p_record jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_family uuid := public.current_family_id();
  v_id uuid := nullif(p_record ->> 'id', '')::uuid;
begin
  if v_family is null then
    raise exception 'no family';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a record needs at least one item';
  end if;

  if v_id is null then
    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, created_by)
    values (
      v_family,
      p_record ->> 'kind',
      (p_record ->> 'occurred_on')::date,
      nullif(p_record ->> 'wallet_id', '')::uuid,
      nullif(p_record ->> 'to_wallet_id', '')::uuid,
      coalesce(p_record ->> 'store', ''),
      (select auth.uid())
    )
    returning id into v_id;
  else
    update public.money_records
      set kind = p_record ->> 'kind',
          occurred_on = (p_record ->> 'occurred_on')::date,
          wallet_id = nullif(p_record ->> 'wallet_id', '')::uuid,
          to_wallet_id = nullif(p_record ->> 'to_wallet_id', '')::uuid,
          store = coalesce(p_record ->> 'store', '')
      where id = v_id;
    if not found then
      raise exception 'record not found';
    end if;
    delete from public.money_items where record_id = v_id;
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
  '家計の記録（詳細＋品目）を1回で保存する。品目は入れ替える。docs/kakei.md §3.2。';

revoke execute on function public.save_money_record(jsonb, jsonb) from public, anon;
grant execute on function public.save_money_record(jsonb, jsonb) to authenticated;

-- ============================================================
-- 9. 特別費の実績を品目へ移す（docs/kakei.md §6）
-- ============================================================
-- 実績1件 → 記録1件（id は実績の id をそのまま使う）＋品目1つ。
-- 特別収入の実績は収入の記録にする。出金元・お店は空（実績に無かった）。メモは品目のメモへ。
do $$
begin
  if to_regclass('public.special_actuals') is not null then
    insert into public.money_records (id, family_id, kind, occurred_on, store, created_at)
    select actual.id, actual.family_id,
           case when item.kind = 'income' then 'income' else 'expense' end,
           actual.occurred_on, '', actual.created_at
      from public.special_actuals as actual
      join public.special_items as item on item.id = actual.item_id
      on conflict (id) do nothing;

    insert into public.money_items (family_id, record_id, amount, special_item_id, special_plan_id, memo, created_at)
    select actual.family_id, actual.id, actual.amount, actual.item_id, actual.plan_id, actual.note, actual.created_at
      from public.special_actuals as actual
      where not exists (select 1 from public.money_items as moved where moved.record_id = actual.id);

    drop table public.special_actuals;
  end if;
end;
$$;

-- ============================================================
-- 10. 最初に開くタブに家計タブを足す
-- ============================================================
alter table public.users drop constraint if exists users_start_tab_check;
alter table public.users
  add constraint users_start_tab_check
    check (start_tab in ('schedule', 'list', 'care', 'money', 'living', 'settings'));
