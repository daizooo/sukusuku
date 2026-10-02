-- かぞく手帳: 予定の参加者・主体の名前の直書きをやめる（docs/family-app.md §3.2・§5 の5）
--
-- 予定（tasks.participants / owner）は今までどおり家族の表示名で持つ。
-- 名前の並びと色はアプリが family_members から決めるようにしたので、DBの
-- 「主体は 大造・いづみ・岳 のどれか」という直書きの制約を外す。
--
-- 表示名で持ち続けるのは、端末に入っている前の版のアプリも名前で読み書きするため
-- （型をidに変えると、新しい版を入れるまで前の版が動かなくなる）。
-- そのかわり、表示名を変えたら予定の名前もDBで書き換える（下のトリガー）。
--
-- DROP を含むので、Supabase の SQL Editor で実行する（MCPからは確認を求められて止まる）。

-- 1. 直書きの制約を外す
alter table public.tasks drop constraint if exists tasks_owner_check;

-- 2. 表示名は空にせず、家族の中で重ねない（予定を名前で突き合わせるため）
do $migrate$
begin
  if not exists (select 1 from pg_constraint where conname = 'family_members_display_name_not_blank') then
    alter table public.family_members
      add constraint family_members_display_name_not_blank check (btrim(display_name) <> '');
  end if;
end;
$migrate$;

create unique index if not exists family_members_family_display_name
  on public.family_members (family_id, display_name);

-- 3. 表示名を変えたら、その家族の予定の参加者・主体の名前も書き換える。
-- 「自分だけ」の予定は作った本人にしか見えない（RLS）が、名前は全部そろえたいので
-- security definer で家族の予定をまとめて書き換える（対象は同じ家族の行だけ）。
create or replace function public.rename_member_in_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.display_name is distinct from old.display_name then
    update public.tasks
       set participants = array_replace(participants, old.display_name, new.display_name),
           owner = case when owner = old.display_name then new.display_name else owner end
     where family_id = new.family_id
       and (old.display_name = any (participants) or owner = old.display_name);
  end if;
  return new;
end;
$fn$;
revoke execute on function public.rename_member_in_tasks() from public, anon, authenticated;

create or replace trigger rename_member_in_tasks
  after update of display_name on public.family_members
  for each row
  execute function public.rename_member_in_tasks();
