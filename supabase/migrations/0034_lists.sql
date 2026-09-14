-- すくすく手帳: リスト（買い出し・やりたいこと・やること）
--
-- Google Keepで運用していたリストをアプリへ移す（docs/lists.md）。
-- Keepでは見出しがただの文字なので「お店で絞る」「項目のお店を変える」ができない。
-- そこで見出しをグループとして持ち、項目をそこにぶら下げる。
--
-- 束ねる軸は1つだけ（お店 / ジャンル / 担当 …）。呼び名は lists.group_label で
-- リストごとに変えられる。グループを1件も作らなければ、ただのチェックリストになる
-- （＝Todo用のリスト）。項目そのものには場所を持たせない。
--
-- 予定(tasks)とは「日付を持つか」で分ける。日付のあるものは予定、
-- 無いものはリスト。同じ用件を2か所に置かないための線引き。

-- ============================================================
-- 1. lists: リストそのもの
-- ============================================================
create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  -- 束ねる軸の呼び名。「お店」「ジャンル」「担当」など自由入力。
  group_label text not null default 'グループ',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.lists is
  '買い出し・やりたいこと・やることなどのリスト。日付を持つ用件は tasks に置く。';
comment on column public.lists.group_label is
  '項目を束ねる軸の呼び名（「お店」など）。画面の見出しと絞り込みの文言に使う。';

-- ============================================================
-- 2. list_groups: リストの中の区切り（お店・ジャンル・担当）
-- ============================================================
-- 0件でもよい。1件も無ければ画面は見出しも絞り込みも出さず、
-- ただのチェックリストとして振る舞う。
create table if not exists public.list_groups (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.list_groups is
  'リストの中で項目を束ねる区切り。名前は自由入力（「イオン」「ドラッグストア」など）。';

-- ============================================================
-- 3. list_items: 項目
-- ============================================================
-- 完了しても消さない。買い出しは同じ品を繰り返し買うため、
-- 完了した項目が「よく買うもの」の元になる（docs/lists.md §2）。
create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  -- グループを消しても項目は残す（未分類へ落ちる）。買い忘れを生まないため。
  group_id uuid references public.list_groups (id) on delete set null,
  title text not null,
  note text,
  is_done boolean not null default false,
  done_at timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.list_items is
  'リストの項目。数量はタイトルに書く（「牛乳2本」）。場所はグループで表す。';
comment on column public.list_items.done_at is
  '完了した時刻。完了した項目を消さずに残し、あとで「よく買うもの」を出すために使う。';

-- ============================================================
-- 4. インデックス
-- ============================================================
-- 外部キーには索引を張る（Performance Advisor対応。0004と同じ方針）。
create index if not exists idx_lists_family_id on public.lists (family_id);
create index if not exists idx_list_groups_list_id on public.list_groups (list_id);
create index if not exists idx_list_items_list_id on public.list_items (list_id);
create index if not exists idx_list_items_group_id on public.list_items (group_id);

-- ============================================================
-- 5. Row Level Security
-- ============================================================
-- lists は family_id を直接持つ。group / item は lists 経由で家族を確かめる
-- （growth_records が children 経由で確かめているのと同じ形）。
alter table public.lists enable row level security;
alter table public.list_groups enable row level security;
alter table public.list_items enable row level security;

create policy "lists_family_all" on public.lists
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

create policy "list_groups_family_all" on public.list_groups
  for all using (
    exists (
      select 1 from public.lists l
      where l.id = list_id and l.family_id = public.current_family_id()
    )
  )
  with check (
    exists (
      select 1 from public.lists l
      where l.id = list_id and l.family_id = public.current_family_id()
    )
  );

create policy "list_items_family_all" on public.list_items
  for all using (
    exists (
      select 1 from public.lists l
      where l.id = list_id and l.family_id = public.current_family_id()
    )
  )
  with check (
    exists (
      select 1 from public.lists l
      where l.id = list_id and l.family_id = public.current_family_id()
    )
  );
