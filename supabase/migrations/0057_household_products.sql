-- かぞく手帳: 日用品の台帳（暮らしタブ。docs/home.md §4）
--
-- 普段買っている日用品の「よく買うもの」の台帳。名前・いつも買うお店・いつもの値段を持ち、
-- 1タップで買い出しリストへ送る。お店の名前がリストのグループ名と同じなら、そのグループへ入る。
-- docs/lists.md §8 の「よく買うもの」はこの台帳で置き換える（完了履歴からは出さない）。
--
-- 在庫数は持たない（毎日減るものの数は記録し続けられず、すぐ嘘になる。docs/home.md §4.3）。
-- 台帳の行とリストの項目はつながない（項目に product_id は持たせない）。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは household_products を読まないだけなので、適用しても今までどおり動く

create table if not exists public.household_products (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  -- 「紙類」「洗剤」「ベビー」など。自由入力（候補は既にある値から出す）。
  category text not null default '',
  -- いつも買うお店。リストのグループ名と同じ書き方にする（送るときに同じ名前のグループへ入れる）。
  store text not null default '',
  -- いつもの値段（円・税込）。
  price integer check (price is null or price >= 0),
  note text not null default '',
  -- 最後に買い出しリストへ送った時刻。
  last_added_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.household_products is
  '日用品の台帳（よく買うもの）。1タップで買い出しリストへ送る。在庫数は持たない（docs/home.md §4）。';
comment on column public.household_products.store is
  'いつも買うお店。買い出しリストに同じ名前のグループがあれば、そこへ入れる。';

create index if not exists idx_household_products_family_id on public.household_products (family_id);

create trigger household_products_set_updated_at
  before update on public.household_products
  for each row
  execute function public.set_updated_at();

alter table public.household_products enable row level security;

create policy "household_products_family_all" on public.household_products
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());
