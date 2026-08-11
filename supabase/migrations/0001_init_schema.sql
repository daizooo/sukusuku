-- すくすく手帳: 初期スキーマ + RLS ポリシー
-- 基本設計書「4. データベース設計」「5. 認証とセキュリティ (RLS)」に対応。
--
-- 適用方法:
--   supabase db push
--   もしくは Supabase MCP の apply_migration ツールでこのファイルの内容を適用する。

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. families: 夫婦・家族単位のグループ
-- ============================================================
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. users: auth.users と1:1で紐づくプロフィール
-- ============================================================
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  family_id uuid references public.families (id) on delete set null,
  role text check (role in ('papa', 'mama')),
  name text,
  workplace text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. children: 子供情報
-- ============================================================
create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text,
  birth_date date,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4. tasks: 予定・ToDo
-- ============================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  title text not null,
  category text not null default '手続き',
  days_after_birth integer not null default 0,
  timing_memo text default '',
  place text default '',
  belongings text default '',
  note text default '',
  assignee text not null default '未定' check (assignee in ('パパ', 'ママ', '二人で', '未定')),
  is_done boolean not null default false,
  has_notification boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 5. care_logs: 育児記録 (授乳・排泄・睡眠)
-- ============================================================
create table if not exists public.care_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  type text not null check (type in ('milk', 'diaper', 'sleep')),
  amount text default '',
  logged_at timestamptz not null default now(),
  note text default '',
  created_by uuid references public.users (id) on delete set null
);

-- ============================================================
-- 6. growth_records: 成長記録 (身長・体重)
-- ============================================================
create table if not exists public.growth_records (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  recorded_date date not null default current_date,
  month_age integer,
  height numeric(5, 2),
  weight numeric(5, 2)
);

-- ============================================================
-- 7. gifts: お祝い・内祝い
-- ============================================================
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  sender_name text not null,
  received_item text default '',
  received_date date,
  return_status text not null default '未完了' check (return_status in ('未完了', '済', '不要')),
  return_item text default '',
  note text default ''
);

-- ============================================================
-- 8. nurseries: 保活メモ
-- ============================================================
create table if not exists public.nurseries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  distance text default '',
  status text not null default '未見学' check (status in ('未見学', '見学予約済', '見学済')),
  phone text default '',
  memo text default ''
);

-- ============================================================
-- 9. documents: 書類箱
-- ============================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  title text not null,
  file_url text not null,
  uploaded_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

-- 自分のfamily_idを返すヘルパー関数。
-- security definer + 固定 search_path で users テーブルへのRLS再帰を避ける。
create or replace function public.current_family_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select family_id from public.users where id = auth.uid();
$$;

alter table public.families enable row level security;
alter table public.users enable row level security;
alter table public.children enable row level security;
alter table public.tasks enable row level security;
alter table public.care_logs enable row level security;
alter table public.growth_records enable row level security;
alter table public.gifts enable row level security;
alter table public.nurseries enable row level security;
alter table public.documents enable row level security;

-- families: 自分が所属する家族のみ参照可能。作成は誰でも可能（サインアップ時に1件作る）。
create policy "families_select_own" on public.families
  for select using (id = public.current_family_id());
create policy "families_insert_any" on public.families
  for insert with check (true);

-- users: 自分自身の行、または同じ家族のパートナーの行を参照可能。更新は自分の行のみ。
create policy "users_select_self_or_family" on public.users
  for select using (id = auth.uid() or family_id = public.current_family_id());
create policy "users_insert_self" on public.users
  for insert with check (id = auth.uid());
create policy "users_update_self" on public.users
  for update using (id = auth.uid());

-- family_id が紐づく各テーブル共通ポリシー
create policy "children_family_all" on public.children
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy "tasks_family_all" on public.tasks
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy "care_logs_family_all" on public.care_logs
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy "gifts_family_all" on public.gifts
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy "nurseries_family_all" on public.nurseries
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy "documents_family_all" on public.documents
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- growth_records: children 経由で family_id を確認
create policy "growth_records_family_all" on public.growth_records
  for all using (
    exists (
      select 1 from public.children c
      where c.id = growth_records.child_id
        and c.family_id = public.current_family_id()
    )
  )
  with check (
    exists (
      select 1 from public.children c
      where c.id = growth_records.child_id
        and c.family_id = public.current_family_id()
    )
  );

-- ============================================================
-- updated_at 自動更新トリガー (tasks)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();
