-- family_profiles と users.role を読み書きしないようにする（docs/family-app.md §3.6・§5 の6）
--
-- 家族の情報は family_members / families に、誰が夫・妻かは family_members.relation に移した。
-- この migration は、DB の関数がこの2つを使うのをやめる。表と列を落とすのは、アプリが
-- 読み書きしなくなったことを確かめたあとの別の SQL（docs/family-app.md §5 の6）。
-- 削除を含まない。

-- 1. 子の誕生日は family_members だけから読む（family_profiles への切り替え先を外す）
create or replace function public.family_birth_date(p_family_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $fn$
  select m.birth_date
    from public.family_members m
   where m.family_id = p_family_id
     and m.relation = 'child'
     and m.birth_date is not null
   order by m.sort_order
   limit 1;
$fn$;

-- 2. 家族への参加・家族の作成で users.role を書かない（続柄は family_members.relation が持つ）
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

  update public.users set family_id = member_row.family_id where id = auth.uid();
  perform set_config('sukusuku.member_link', 'on', true);
  update public.family_members set user_id = auth.uid() where id = member_row.id;
  perform set_config('sukusuku.member_link', 'off', true);
  update public.member_invites set used_at = now() where id = invite_row.id;

  return member_row.family_id;
end;
$fn$;

-- p_role は「作った本人がどちらの親か」（'papa'＝夫、'mama'＝妻）。users.role には書かない。
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

  update public.users set family_id = new_family where id = auth.uid();
  return new_family;
end;
$fn$;
