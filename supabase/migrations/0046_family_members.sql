-- かぞく手帳: 家族1人1人（family_members）と世帯情報を持つ（docs/family-app.md §3）
--
-- いまは家族の名前が型・DB制約に直書きされ（tasks_owner_check 等）、家族情報は
-- family_profiles の自由入力（jsonb）に入っている。これを型のある列に移す。
-- このmigrationではテーブルを足して中身を移すだけで、アプリはまだ旧データを読む
-- （family_profiles・users.role は残す。読むのをやめてから別のmigrationで落とす）。

-- 1. 世帯情報
alter table public.families
  add column if not exists name text not null default '',
  add column if not exists postal_code text not null default '',
  add column if not exists address text not null default '',
  add column if not exists home_phone text not null default '',
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_families_updated_at on public.families;
create trigger set_families_updated_at
  before update on public.families
  for each row
  execute function public.set_updated_at();

-- 2. 家族メンバー
-- user_id はアカウントを持つ人だけ。子は最初null、スマホを持ったら招待で紐づける（§3.5）。
-- 年齢・生後日数は birth_date から計算し、保存しない。
-- color は画面側の色の組（文字・地・枠）を選ぶ名前で、色の値そのものは持たない。
create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid unique references public.users (id) on delete set null,
  relation text not null check (relation in ('husband', 'wife', 'child')),
  is_guardian boolean not null default false,
  display_name text not null,
  family_name text not null default '',
  given_name text not null default '',
  family_name_kana text not null default '',
  given_name_kana text not null default '',
  birth_date date,
  phone text not null default '',
  email text not null default '',
  workplace text not null default '',
  workplace_phone text not null default '',
  color text not null default 'gray' check (color in ('blue', 'pink', 'emerald', 'gray')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_family_members_family_id on public.family_members (family_id);

drop trigger if exists set_family_members_updated_at on public.family_members;
create trigger set_family_members_updated_at
  before update on public.family_members
  for each row
  execute function public.set_updated_at();

-- ログイン中の人が、自分の家族の保護者かどうか
create or replace function public.is_family_guardian()
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from public.family_members
     where user_id = auth.uid() and is_guardian
       and family_id = public.current_family_id()
  );
$fn$;
revoke execute on function public.is_family_guardian() from public, anon;
grant execute on function public.is_family_guardian() to authenticated, service_role;

alter table public.family_members enable row level security;

-- 見るのは家族全員。編集は保護者なら全員分、そうでなければ自分の行だけ。
-- 追加・削除はアプリからはしない（一家の3人を固定で持つ。§3.1）。
drop policy if exists "family_members_select_family" on public.family_members;
create policy "family_members_select_family" on public.family_members
  for select using (family_id = public.current_family_id());

drop policy if exists "family_members_update_guardian_or_self" on public.family_members;
create policy "family_members_update_guardian_or_self" on public.family_members
  for update
  using (
    family_id = public.current_family_id()
    and (public.is_family_guardian() or user_id = (select auth.uid()))
  )
  with check (family_id = public.current_family_id());

-- RLSは行単位なので、アプリから変えてはいけない列はトリガーで守る。
-- 家族・アカウントの紐づけはアプリからは変えない（招待の関数・migrationだけが変える）。
-- 続柄・保護者かどうかは保護者だけが変えられる。
-- auth.uid() が null（migration・service_role）のときは制限しない。
create or replace function public.guard_family_member_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.family_id <> old.family_id or new.user_id is distinct from old.user_id then
    raise exception 'family_members: family_id / user_id はアプリから変更できません';
  end if;
  if (new.relation <> old.relation or new.is_guardian <> old.is_guardian)
     and not public.is_family_guardian() then
    raise exception 'family_members: 続柄・保護者の設定は保護者だけが変更できます';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.guard_family_member_columns() from public, anon, authenticated;

drop trigger if exists guard_family_member_columns on public.family_members;
create trigger guard_family_member_columns
  before update on public.family_members
  for each row
  execute function public.guard_family_member_columns();

-- 世帯情報の編集は保護者だけ
drop policy if exists "families_update_guardian" on public.families;
create policy "families_update_guardian" on public.families
  for update
  using (id = public.current_family_id() and public.is_family_guardian())
  with check (id = public.current_family_id());

-- 3. 育児の対象（children）とメンバーを1:1でつなぐ。growth_records.child_id はそのまま
alter table public.children
  add column if not exists member_id uuid unique references public.family_members (id) on delete set null;

-- 4. アカウントごとの設定（§3.4）
alter table public.users
  add column if not exists start_tab text not null default 'schedule'
    check (start_tab in ('schedule', 'list', 'care', 'settings')),
  add column if not exists show_care_tab boolean not null default true;

-- 5. 既存データの移し替え（冪等。メンバーがまだいない家族だけ）
-- 対象はアカウントのある家族。表示名・色は、予定の参加者・主体と同じ値にする
-- （tasks.participants / owner を後でidへ変換するときに、表示名で突き合わせる）。
-- 氏名（姓・名）は旧データから確実に分けられないため移さず、設定画面で入れ直す。
do $migrate$
declare
  fam record;
  child_member uuid;
  -- family_profiles の項目を id で引いて、最初の入力済みの値を返す
  pf_value text;
begin
  for fam in
    select f.id, p.child_fields, p.family_fields, p.emergency_fields
      from public.families f
      left join public.family_profiles p on p.family_id = f.id
     where exists (select 1 from public.users u where u.family_id = f.id)
       and not exists (select 1 from public.family_members m where m.family_id = f.id)
  loop
    update public.families set name = '白石家' where id = fam.id and name = '';

    insert into public.family_members
      (family_id, user_id, relation, is_guardian, display_name, color, sort_order,
       workplace, workplace_phone, phone)
    select fam.id,
           (select u.id from public.users u where u.family_id = fam.id and u.role = 'papa' limit 1),
           'husband', true, '大造', 'blue', 1,
           coalesce((select v from jsonb_array_elements(fam.family_fields) e,
                       jsonb_array_elements_text(e->'values') v
                      where e->>'id' = 'dad-workplace' and trim(v) <> '' limit 1), ''),
           coalesce((select v from jsonb_array_elements(fam.emergency_fields) e,
                       jsonb_array_elements_text(e->'values') v
                      where e->>'id' = 'papa-company-phone' and trim(v) <> '' limit 1), ''),
           coalesce((select v from jsonb_array_elements(fam.emergency_fields) e,
                       jsonb_array_elements_text(e->'values') v
                      where e->>'id' = 'papa-contact-phone' and trim(v) <> '' limit 1), '');

    insert into public.family_members
      (family_id, user_id, relation, is_guardian, display_name, color, sort_order,
       workplace, workplace_phone, phone)
    select fam.id,
           (select u.id from public.users u where u.family_id = fam.id and u.role = 'mama' limit 1),
           'wife', true, 'いづみ', 'pink', 2,
           coalesce((select v from jsonb_array_elements(fam.family_fields) e,
                       jsonb_array_elements_text(e->'values') v
                      where e->>'id' = 'mom-workplace' and trim(v) <> '' limit 1), ''),
           coalesce((select v from jsonb_array_elements(fam.emergency_fields) e,
                       jsonb_array_elements_text(e->'values') v
                      where e->>'id' = 'mama-company-phone' and trim(v) <> '' limit 1), ''),
           coalesce((select v from jsonb_array_elements(fam.emergency_fields) e,
                       jsonb_array_elements_text(e->'values') v
                      where e->>'id' = 'mama-contact-phone' and trim(v) <> '' limit 1), '');

    -- 子の誕生日（YYYY-MM-DD の形のものだけ移す）
    pf_value := (select v from jsonb_array_elements(fam.child_fields) e,
                   jsonb_array_elements_text(e->'values') v
                  where e->>'id' = 'birth-date' and v ~ '^\d{4}-\d{2}-\d{2}$' limit 1);

    insert into public.family_members
      (family_id, relation, is_guardian, display_name, color, sort_order, birth_date)
    values (fam.id, 'child', false, '岳', 'emerald', 3, pf_value::date)
    returning id into child_member;

    -- 既存の children の行（なければ作る）を子メンバーにつなぐ
    update public.children
       set member_id = child_member
     where id = (select c.id from public.children c
                  where c.family_id = fam.id and c.member_id is null
                  order by c.created_at limit 1);
    if not found then
      insert into public.children (family_id, member_id) values (fam.id, child_member);
    end if;
  end loop;
end;
$migrate$;
