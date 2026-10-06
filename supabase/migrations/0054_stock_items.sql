-- かぞく手帳: 防災備蓄（暮らしタブ。docs/home.md §3）
--
-- スプレッドシート／PDFの「災害備蓄品一覧」をアプリへ移す。困りごとは数を数えることでは
-- なく、期限切れに気づかないこと。そこで1行＝品名×期限（ロット）で持ち、期限の近い順に並べる。
-- 同じ品でも期限が違えば別の行にする（カゴメのスープの 12PC と 4PC など）。
--
-- あわせて、最初に開くタブ（users.start_tab）に暮らしタブ（living）を足す。
-- id を home にしないのは、旧ホームタブ（/home → /care へのリダイレクト）と紛らわしいため。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは stock_items を読まないだけなので、適用しても今までどおり動く

-- ============================================================
-- 1. stock_items: 備蓄（ロット）
-- ============================================================
create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- 「飲料・水」「食料品」など。自由入力（候補は既にある値から出す）。
  category text not null default '',
  name text not null,
  quantity numeric not null default 0 check (quantity >= 0),
  -- 「本」「袋」「PC」「回分」など。自由入力。
  unit text not null default '',
  -- 賞味・使用期限。期限の無いもの（衛生用品・ラジオ・ポータブル電源など）は null。
  expires_on date,
  -- 期限が「2027.06」のように月までしか無いとき true。expires_on はその月の末日で持つ。
  expires_month_only boolean not null default false,
  note text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_items_month_only_check check (not expires_month_only or expires_on is not null)
);

comment on table public.stock_items is
  '防災備蓄。1行＝品名×期限（ロット）。期限の近い順に並べ、期限切れに気づくためのもの（docs/home.md §3）。';
comment on column public.stock_items.expires_month_only is
  '期限が月までしか無いとき true。expires_on はその月の末日。画面では「2027.06」と出す。';

create index if not exists idx_stock_items_family_id on public.stock_items (family_id);

drop trigger if exists stock_items_set_updated_at on public.stock_items;
create trigger stock_items_set_updated_at
  before update on public.stock_items
  for each row
  execute function public.set_updated_at();

-- 家族で共有する（リストと同じ）。
alter table public.stock_items enable row level security;

drop policy if exists "stock_items_family_all" on public.stock_items;
create policy "stock_items_family_all" on public.stock_items
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- ============================================================
-- 2. 最初に開くタブに暮らしタブを足す
-- ============================================================
alter table public.users drop constraint if exists users_start_tab_check;
alter table public.users
  add constraint users_start_tab_check
    check (start_tab in ('schedule', 'list', 'care', 'living', 'settings'));
