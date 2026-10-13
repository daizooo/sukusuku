-- かぞく手帳: 契約（賃貸・保険・サブスクなどの控え。docs/contracts.md）
--
--   contracts          契約。すべての種類に共通する項目だけを列で持つ（§3.1）
--   contract_fields    契約ごとに自由に足せる「ラベル: 値」の行（§3.2）
--   my_member_id()     自分の family_members.id。見せる相手の判定に使う（§5）
--
-- 書類（契約書・証券の写真）は持たない。証券番号・契約番号・口座・カード番号・パスワードも持たない
-- （docs/family-app.md §3.3 の方針。入力欄の下に注意書きを出す）。家計の固定費・特別費とは連動しない。
--
-- 見せる相手: visible_member_ids に入っている家族メンバーだけが、その契約と自由項目を見て、直して、消せる。
-- 作った本人（created_by）は、選ばなくても常に見られる（自分を外して契約を失わないように）。
--
-- 流し方（CLAUDE.md「本番DBへの migration の適用」）: 削除を含む文は無い（on delete は参照の定義）。
-- 適用してからアプリを出す。docs/contracts.md §9 の PR1。

-- 1. 自分の family_members.id ---------------------------------------------------
-- security definer + 固定 search_path で、RLS の中から family_members を引いても再帰しない
-- （current_family_id() と同じ作り）。
create or replace function public.my_member_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.family_members where user_id = auth.uid();
$$;

-- 2. contracts -----------------------------------------------------------------
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  created_by uuid references public.users (id) on delete set null,
  -- 賃貸 / 保険 / サブスク / その他。一覧の絞り込みと、自由項目の候補の出し分けに使う
  kind text not null check (kind in ('rent', 'insurance', 'subscription', 'other')),
  -- 小分類。保険なら「自動車」「医療」「就労不能」など（自由入力）
  category text not null default '',
  title text not null check (title <> ''),
  company text not null default '',
  -- 契約者（名義）。メンバーを外しても契約は残す
  contractor_id uuid references public.family_members (id) on delete set null,
  started_on date,
  -- 満了日・更新日・次の請求日をこの1つで表す。無い契約はお知らせもバッジも出ない
  renews_on date,
  -- 「更新した」で renews_on をこの月数だけ進める（賃貸24・保険12・サブスク1など）
  term_months int check (term_months is null or term_months > 0),
  amount int check (amount is null or amount >= 0),
  -- amount と対。金額が無いときは周期も無い
  amount_cycle text check (amount_cycle in ('monthly', 'yearly', 'once')),
  -- 更新日の何日前にお知らせするか。空にするとお知らせなし
  notify_days int[] not null default '{60,30,7}',
  memo text not null default '',
  -- 見せる相手（family_members.id の並び）。空にはできない
  visible_member_ids uuid[] not null check (cardinality(visible_member_ids) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_amount_cycle_pair check ((amount is null) = (amount_cycle is null))
);

comment on table public.contracts is
  '契約の控え（賃貸・保険・サブスクなど）。visible_member_ids の家族メンバーと、作った本人だけが見える。docs/contracts.md';
comment on column public.contracts.renews_on is
  '満了日・更新日・次の請求日。お知らせとバッジの基準';
comment on column public.contracts.visible_member_ids is
  '見せる相手（family_members.id）。作った本人は含まれていなくても見える';

create index if not exists idx_contracts_family_id on public.contracts (family_id);
create index if not exists idx_contracts_created_by on public.contracts (created_by);
create index if not exists idx_contracts_contractor_id on public.contracts (contractor_id);

drop trigger if exists set_contracts_updated_at on public.contracts;
create trigger set_contracts_updated_at
  before update on public.contracts
  for each row
  execute function public.set_updated_at();

alter table public.contracts enable row level security;

drop policy if exists "contracts_visible" on public.contracts;
create policy "contracts_visible" on public.contracts
  for all
  using (
    family_id = public.current_family_id()
    and (
      created_by = (select auth.uid())
      or (select public.my_member_id()) = any (visible_member_ids)
    )
  )
  with check (family_id = public.current_family_id());

-- 3. contract_fields -----------------------------------------------------------
create table if not exists public.contract_fields (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  label text not null check (label <> ''),
  value text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_fields_contract_id on public.contract_fields (contract_id);

alter table public.contract_fields enable row level security;

-- 自由項目は「その契約が見えるか」だけで決まる。サブクエリには contracts のポリシーが
-- そのまま掛かる（見えない契約の行は数えられない）。
drop policy if exists "contract_fields_visible_contract" on public.contract_fields;
create policy "contract_fields_visible_contract" on public.contract_fields
  for all
  using (exists (select 1 from public.contracts c where c.id = contract_fields.contract_id))
  with check (exists (select 1 from public.contracts c where c.id = contract_fields.contract_id));

-- 4. 他の端末での変更の台帳（docs/sync.md）----------------------------------------
select public.attach_family_sync('public.contracts');
select public.attach_family_sync('public.contract_fields',
  'select c.family_id from %rows% r join public.contracts c on c.id = r.contract_id');
