-- 設定タブ（お子様情報・パパママ情報）を家族単位で永続化するテーブル。
-- 設定画面の入力値がリロード後に失われる不具合の修正対応。

create table if not exists public.family_profiles (
  family_id uuid primary key references public.families (id) on delete cascade,
  baby_name text not null default '',
  birth_date date,
  mom_name text not null default '',
  mom_workplace text not null default '',
  dad_name text not null default '',
  dad_workplace text not null default '',
  address text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.family_profiles enable row level security;

create policy "family_profiles_family_all" on public.family_profiles
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

drop trigger if exists set_family_profiles_updated_at on public.family_profiles;
create trigger set_family_profiles_updated_at
  before update on public.family_profiles
  for each row
  execute function public.set_updated_at();
