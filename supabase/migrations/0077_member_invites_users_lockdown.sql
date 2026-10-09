-- 家族への参加を招待コードに移し、users.family_id をアプリから書き換えられなくする
-- （docs/family-app.md §3.5・§5 の7）
--
-- いままでは users_update_self（自分の行なら何でも更新できる）のせいで、ログインした人が
-- users.family_id に他の家族のIDを書けば、その家族のデータをすべて読み書きできた。
-- しかも「招待コード」は家族のID（families.id）そのもので、一度漏れると使い回せた。
--
-- このmigrationで:
--   1. 招待コード（member_invites）を足す。使い切り・期限つき・DBにはハッシュだけ持つ
--   2. 家族への参加（redeem_member_invite）と家族の新規作成（create_my_family）を、
--      security definer の関数に寄せる
--   3. users の更新できる列を start_tab・show_care_tab だけに絞る（列の権限）
--
-- 削除を含まない。アプリを出す前に適用してよい（古いアプリは family_id を書き換える
-- 画面を持たない。PWA版の家族設定の画面だけが、このmigrationとセットで新しい形になる）。

-- 1. 招待コード
-- member_id の人にアカウントを紐づけるためのコード。コードそのものは保存しない。
create table if not exists public.member_invites (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.family_members (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_member_invites_member_id on public.member_invites (member_id);

-- 読み書きはすべて下の関数を通す（ポリシーを置かない＝アプリから直接は触れない）
alter table public.member_invites enable row level security;
revoke all on public.member_invites from anon, authenticated;

-- family_members の user_id は、招待の関数だけが変えられるようにする。
-- 0046 の guard_family_member_columns は auth.uid() が null のときだけ制限を外していたが、
-- 招待の関数はログインした本人の権限で呼ばれる（auth.uid() が入っている）ので、
-- 関数の中でだけ立てる印（取引の中だけ有効）を見て通す。
create or replace function public.guard_family_member_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null or current_setting('sukusuku.member_link', true) = 'on' then
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

-- 招待コードを出す。保護者が、まだアカウントの無い自分の家族のメンバーに対してだけ出せる。
-- コードは戻り値でしか見えない（保存するのはハッシュ）。そのメンバーの前のコードは無効にする。
create or replace function public.create_member_invite(p_member_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  member_row public.family_members;
  new_code text;
begin
  if auth.uid() is null then
    raise exception '招待コードを出すにはログインが必要です';
  end if;

  select * into member_row from public.family_members where id = p_member_id;
  if not found
     or member_row.family_id is distinct from public.current_family_id()
     or not public.is_family_guardian() then
    raise exception '招待コードを出せるのは、自分の家族の保護者だけです';
  end if;
  if member_row.user_id is not null then
    raise exception 'この人にはすでにアカウントがあります';
  end if;

  update public.member_invites
     set expires_at = now()
   where member_id = p_member_id and used_at is null and expires_at > now();

  -- 12文字の16進（48bit）。使い切りで7日で切れるので、総当たりは現実的でない
  new_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.member_invites (member_id, code_hash, expires_at, created_by)
  values (
    p_member_id,
    encode(sha256(convert_to(new_code, 'UTF8')), 'hex'),
    now() + interval '7 days',
    auth.uid()
  );
  return new_code;
end;
$fn$;

-- 招待コードで家族に参加する。まだどの家族にも入っていない人だけが使える。
-- users.family_id・role と family_members.user_id を同時に決める（アプリからは変えられない列）。
create or replace function public.redeem_member_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  normalized text := lower(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  invite_row public.member_invites;
  member_row public.family_members;
  my_family uuid;
begin
  if auth.uid() is null then
    raise exception '参加するにはログインが必要です';
  end if;

  select family_id into my_family from public.users where id = auth.uid();
  if not found then
    raise exception 'アカウントの情報が見つかりません';
  end if;
  if my_family is not null then
    raise exception 'すでに家族に参加しています';
  end if;

  select * into invite_row
    from public.member_invites
   where code_hash = encode(sha256(convert_to(normalized, 'UTF8')), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then
    raise exception '招待コードが正しくないか、期限が切れています';
  end if;

  select * into member_row from public.family_members where id = invite_row.member_id for update;
  if not found or member_row.user_id is not null then
    raise exception '招待コードが正しくないか、期限が切れています';
  end if;

  update public.users
     set family_id = member_row.family_id,
         role = case member_row.relation
                  when 'husband' then 'papa'
                  when 'wife' then 'mama'
                  else null
                end
   where id = auth.uid();
  perform set_config('sukusuku.member_link', 'on', true);
  update public.family_members set user_id = auth.uid() where id = member_row.id;
  perform set_config('sukusuku.member_link', 'off', true);
  update public.member_invites set used_at = now() where id = invite_row.id;

  return member_row.family_id;
end;
$fn$;

-- 家族を新しく作る。まだどの家族にも入っていない人だけが使える。
-- 一家の3人（夫・妻・子）を作り、作った本人を p_role に合う親のメンバーに紐づける。
-- もう一人の親には、あとで招待コード（create_member_invite）を出して参加してもらう。
-- 表示名は設定の「家族」で直す（家族の中で重ならない名前にしてある）。
create or replace function public.create_my_family(p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  new_family uuid := gen_random_uuid();
  child_member uuid;
  my_family uuid;
begin
  if auth.uid() is null then
    raise exception '家族を作るにはログインが必要です';
  end if;
  if p_role not in ('papa', 'mama') then
    raise exception '役割が正しくありません';
  end if;

  select family_id into my_family from public.users where id = auth.uid();
  if not found then
    raise exception 'アカウントの情報が見つかりません';
  end if;
  if my_family is not null then
    raise exception 'すでに家族に参加しています';
  end if;

  insert into public.families (id) values (new_family);

  insert into public.family_members
    (family_id, user_id, relation, is_guardian, display_name, color, sort_order)
  values
    (new_family, case when p_role = 'papa' then auth.uid() end, 'husband', true, 'パパ', 'blue', 1),
    (new_family, case when p_role = 'mama' then auth.uid() end, 'wife', true, 'ママ', 'pink', 2);

  insert into public.family_members
    (family_id, relation, is_guardian, display_name, color, sort_order)
  values (new_family, 'child', false, 'こども', 'emerald', 3)
  returning id into child_member;

  insert into public.children (family_id, member_id) values (new_family, child_member);

  update public.users set family_id = new_family, role = p_role where id = auth.uid();
  return new_family;
end;
$fn$;

revoke execute on function public.create_member_invite(uuid) from public, anon;
revoke execute on function public.redeem_member_invite(text) from public, anon;
revoke execute on function public.create_my_family(text) from public, anon;
grant execute on function public.create_member_invite(uuid) to authenticated, service_role;
grant execute on function public.redeem_member_invite(text) to authenticated, service_role;
grant execute on function public.create_my_family(text) to authenticated, service_role;

-- 2. users をアプリから書き換えられる列を絞る
-- 行の判定（users_update_self）は「自分の行」までしか見ないので、列は権限で絞る。
-- 家族・役割の紐づけは上の関数（と service_role・migration）だけが変える。
-- 行の追加はサインアップ時のトリガー（handle_new_auth_user）が行うので、アプリからは不要。
revoke insert, update on public.users from anon, authenticated;
grant update (start_tab, show_care_tab) on public.users to authenticated;
