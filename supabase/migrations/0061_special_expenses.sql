-- かぞく手帳: 特別費（暮らしタブ。docs/home.md §5.4・フェーズ4a）
--
-- 年に数回の大きな出費（税金・保険の年払い・車検・お祝い・旅行・家電の買い替えなど）と、
-- 特別収入（賞与など）を、年度（4月〜翌3月）ごとに「予定（予算）」と「実績」で持つ。
-- 月々の家計簿は作らない（Zaimが持っている。§5.3）。
--
-- 3つのテーブルに分ける:
--   special_items   項目。種類（支出/収入）・名前・周期（毎年/n年おき/1回きり）
--   special_plans   予定。1回ぶん=1行（月と金額。月未定・仮もある）。年に複数回出る項目は複数行
--   special_actuals 実績。予定にひも付く（「済」を押したもの）か、予定外の出費
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは特別費を読まないだけなので、適用しても今までどおり動く

-- ============================================================
-- 1. special_items: 項目
-- ============================================================
create table if not exists public.special_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  -- 「車維持費」「保険」「税金」「お祝い」など。自由入力（候補は既にある値から出す）。
  category text not null default '',
  name text not null,
  -- 周期。1=毎年、2=2年おき（車検など）…、0=1回きり。
  cycle_years integer not null default 1 check (cycle_years >= 0 and cycle_years <= 50),
  -- 周期の起点の年度（4月始まりの年度の西暦。2026年4月〜2027年3月なら 2026）。
  -- 毎年（cycle_years = 1）なら null でよい。それ以外は、どの年度に出るかを決めるのに要る。
  base_year integer,
  note text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint special_items_base_year_check check (cycle_years = 1 or base_year is not null),
  -- 予定・実績が (項目, 家族) をまとめて参照するための一意制約。
  constraint special_items_id_family_key unique (id, family_id)
);

comment on table public.special_items is
  '特別費・特別収入の項目。年度ごとの予定(special_plans)と実績(special_actuals)を持つ（docs/home.md §5.4）。';
comment on column public.special_items.cycle_years is
  '周期。1=毎年、n=n年おき、0=1回きり。n年おき・1回きりは base_year の年度から数える。';

create index if not exists idx_special_items_family_id on public.special_items (family_id);

drop trigger if exists special_items_set_updated_at on public.special_items;
create trigger special_items_set_updated_at
  before update on public.special_items
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- 2. special_plans: 予定（予算）
-- ============================================================
create table if not exists public.special_plans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  item_id uuid not null,
  -- 発生する月（1〜12）。月が決まっていないものは null。
  month integer check (month is null or (month >= 1 and month <= 12)),
  amount integer not null default 0 check (amount >= 0),
  -- 「2月(仮)」のように、月がまだ仮のもの。
  tentative boolean not null default false,
  created_at timestamptz not null default now(),
  -- 別の家族の項目へぶら下げられないよう、家族まで合わせて参照する。
  constraint special_plans_item_fkey foreign key (item_id, family_id)
    references public.special_items (id, family_id) on delete cascade
);

comment on table public.special_plans is
  '特別費の予定。1回ぶん=1行。年に複数回出る項目（オイル交換・灯油など）は複数行。';

create index if not exists idx_special_plans_item_id on public.special_plans (item_id);
create index if not exists idx_special_plans_family_id on public.special_plans (family_id);

-- ============================================================
-- 3. special_actuals: 実績
-- ============================================================
create table if not exists public.special_actuals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  item_id uuid not null,
  -- ひも付く予定。「済」で入れたものは予定を指す。予定外の出費は null。
  -- 予定を消しても実績は残す（予定外の実績になる）。
  plan_id uuid references public.special_plans (id) on delete set null,
  occurred_on date not null,
  amount integer not null default 0 check (amount >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint special_actuals_item_fkey foreign key (item_id, family_id)
    references public.special_items (id, family_id) on delete cascade
);

comment on table public.special_actuals is
  '特別費の実績。年度は occurred_on から決める（4月〜翌3月）。plan_id があれば予定の実績、無ければ予定外。';

create index if not exists idx_special_actuals_item_id on public.special_actuals (item_id);
create index if not exists idx_special_actuals_family_id on public.special_actuals (family_id);
create index if not exists idx_special_actuals_plan_id on public.special_actuals (plan_id);

-- ============================================================
-- 4. Row Level Security（家族で共有する。リスト・備蓄と同じ）
-- ============================================================
alter table public.special_items enable row level security;
alter table public.special_plans enable row level security;
alter table public.special_actuals enable row level security;

drop policy if exists "special_items_family_all" on public.special_items;
create policy "special_items_family_all" on public.special_items
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

drop policy if exists "special_plans_family_all" on public.special_plans;
create policy "special_plans_family_all" on public.special_plans
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

drop policy if exists "special_actuals_family_all" on public.special_actuals;
create policy "special_actuals_family_all" on public.special_actuals
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());
