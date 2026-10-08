-- かぞく手帳: 日用品のカテゴリの一覧（docs/home.md §4.1）
--
-- カテゴリを自由に書くと人によって書き方がばらつくため、家族で共有する一覧を持ち、品の編集では一覧から選ぶ。
-- 一覧は作る・名前を直す・並べ替える・消すができる（日用品の画面の「カテゴリ」から）。
-- 品（household_products）は今までどおりカテゴリを名前の文字列（category）で持つ。名前を直したときは、
-- アプリが同じ名前の品の category も書き換える。消したカテゴリを使っていた品は「なし」（空）になる。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは表を読まないだけで、今までどおり動く

create table if not exists public.household_product_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_product_categories_family_name_key unique (family_id, name)
);

comment on table public.household_product_categories is
  '日用品のカテゴリの一覧（家族で共有）。品は名前の文字列で持つ。docs/home.md §4.1。';

drop trigger if exists household_product_categories_set_updated_at on public.household_product_categories;
create trigger household_product_categories_set_updated_at
  before update on public.household_product_categories
  for each row
  execute function public.set_updated_at();

alter table public.household_product_categories enable row level security;

drop policy if exists "household_product_categories_family_all" on public.household_product_categories;
create policy "household_product_categories_family_all" on public.household_product_categories
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- いまある品のカテゴリを、名前の順で一覧に登録する
insert into public.household_product_categories (family_id, name, position)
select family_id, name, (row_number() over (partition by family_id order by name) - 1)::integer
  from (select distinct family_id, btrim(category) as name
          from public.household_products
         where btrim(category) <> '') as names
on conflict (family_id, name) do nothing;

-- 品の category の前後の空白をそろえる（一覧の名前と一致させるため）
update public.household_products set category = btrim(category) where category <> btrim(category);
