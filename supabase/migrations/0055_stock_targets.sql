-- かぞく手帳: 防災備蓄の必要数（暮らしタブ。docs/home.md §3.5）
--
-- 「家族3人（大人3人）の1週間分」を確保できているかを、品目ごとに確かめる。
-- 備蓄の行（stock_items）は品名×期限のロットなので、必要数はロットとは別の「目標」に持つ。
-- 1つの目標に複数のロットを数える（野菜スープは4種類×2ロット、水は500mlと1.8Lの両方）。
--
-- 必要数は「1人1日あたり × 人数 × 日数」で出す（水なら 3L × 3人 × 7日 = 63L）。
-- ラジオ・ランタンのように人数・日数で増えないものは、決まった数をそのまま持つ。
-- 人数と日数は家族で1つ（families.stock_people / stock_days。既定は3人・7日）。
--
-- 持っている量は、目標に数えるロットの「数 × 1つあたりの量」の合計。期限切れのロットは数えない。
-- 1つあたりの量は、ロットの単位を目標の単位に直す係数（水 500ml の1本は 0.5L）。既定は1。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは足した列・表を読まないだけなので、適用しても今までどおり動く

-- ============================================================
-- 1. stock_targets: 必要数（目標）
-- ============================================================
create table if not exists public.stock_targets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  category text not null default '',
  name text not null,
  -- per_person_day が true なら「1人1日あたり」、false なら必要数そのもの。
  quantity numeric not null default 0 check (quantity >= 0),
  per_person_day boolean not null default true,
  unit text not null default '',
  note text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stock_targets is
  '防災備蓄の必要数。1人1日あたり×人数×日数、または決まった数。ロット(stock_items.target_id)を合計して不足を出す（docs/home.md §3.5）。';
comment on column public.stock_targets.per_person_day is
  'true: quantity は1人1日あたり（必要数＝quantity×families.stock_people×stock_days）。false: quantity が必要数そのもの。';

create index if not exists idx_stock_targets_family_id on public.stock_targets (family_id);

create trigger stock_targets_set_updated_at
  before update on public.stock_targets
  for each row
  execute function public.set_updated_at();

alter table public.stock_targets enable row level security;

create policy "stock_targets_family_all" on public.stock_targets
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- ============================================================
-- 2. stock_items: どの目標に数えるか
-- ============================================================
alter table public.stock_items
  add column if not exists target_id uuid references public.stock_targets (id) on delete set null,
  add column if not exists amount_per_unit numeric not null default 1 check (amount_per_unit > 0);

comment on column public.stock_items.target_id is
  'このロットを数える必要数（目標）。null なら数えない。目標を消すと null に戻る。';
comment on column public.stock_items.amount_per_unit is
  '目標の単位に直した1つあたりの量（目標が L で、このロットが 500ml の本なら 0.5）。';

create index if not exists idx_stock_items_target_id on public.stock_items (target_id);

-- ============================================================
-- 3. families: 何人の何日分を備えるか
-- ============================================================
alter table public.families
  add column if not exists stock_people smallint not null default 3 check (stock_people between 1 and 20),
  add column if not exists stock_days smallint not null default 7 check (stock_days between 1 and 60);

comment on column public.families.stock_people is '防災備蓄を何人分備えるか（必要数の計算に使う）。';
comment on column public.families.stock_days is '防災備蓄を何日分備えるか（必要数の計算に使う）。';
