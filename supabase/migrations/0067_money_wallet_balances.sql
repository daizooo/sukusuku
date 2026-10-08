-- かぞく手帳: 家計の「口座の残高」（docs/kakei.md §7 の7・§9.3）
--
-- Zaim を消すと、Zaim で見ていた口座の残高が無くなる。かぞく手帳では、残高を次のように持つ。
--   残高 = 最後に確定した残高 + その後の記録（支出・収入・振替）
-- 記録は money_records・money_items にあるので、足すのは「確定した残高」だけ。
-- 通帳・銀行のアプリの残高を、出金元ごと・日付ごとに入れる（月に1回ほど）。
-- 確定したときの記録との差は、確定の前の残高と記録から計算で出せるので、列には持たない。
--
--   money_wallet_balances  確定した残高。 出金元 / 日付 / 額（その日の終わりの残高。マイナスもある＝カードの未払い）
--
-- 同じ出金元・同じ日付の確定は1件（入れ直すと上書き）。
-- 出金元は消さずに使わなくするだけなので、残高の確定も残る（出金元を消すと一緒に消える）。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは表を読まないだけで、今までどおり動く

-- ============================================================
-- 1. money_wallet_balances: 確定した残高
-- ============================================================
create table if not exists public.money_wallet_balances (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  wallet_id uuid not null,
  -- 残高の日付。その日の終わりの残高（この日の記録も含む）。
  balance_on date not null,
  -- 残高（円）。マイナスもある（カードの未払いなど）。
  amount integer not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint money_wallet_balances_wallet_date_key unique (wallet_id, balance_on),
  constraint money_wallet_balances_wallet_fkey foreign key (wallet_id, family_id)
    references public.money_wallets (id, family_id) on delete cascade
);

comment on table public.money_wallet_balances is
  '家計の出金元ごとの、確定した残高（通帳・銀行のアプリの残高）。残高 = 最後に確定した残高 + その後の記録。docs/kakei.md §9.3。';

create index if not exists idx_money_wallet_balances_family_id on public.money_wallet_balances (family_id);

drop trigger if exists money_wallet_balances_set_updated_at on public.money_wallet_balances;
create trigger money_wallet_balances_set_updated_at
  before update on public.money_wallet_balances
  for each row
  execute function public.set_updated_at();

alter table public.money_wallet_balances enable row level security;

drop policy if exists "money_wallet_balances_family_all" on public.money_wallet_balances;
create policy "money_wallet_balances_family_all" on public.money_wallet_balances
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());
