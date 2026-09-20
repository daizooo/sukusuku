-- すくすく手帳: 予定・タスクの「参加者」導入と種別(kind)の追加
--
-- 単一選択だった assignee(パパ/ママ/家族) を、複数選択の participants
-- (大造/いづみ/岳) へ置き換える。あわせて、予定(event)とタスク(task)を
-- 区別する kind を追加する。
--
-- ============================================================
-- 適用条件（重要）
-- ============================================================
-- assignee を書き込む旧コード(mobile/src/lib/api/tasks.ts の旧 toWritableRow)
-- を使う端末が無いこと。参加者・種別を読み書きする新しいAPKを両端末に
-- 入れ終えてから適用する。先に適用すると、旧APKからの予定の追加・更新が
--   column "assignee" of relation "tasks" does not exist
-- で失敗する。

-- ============================================================
-- 1. participants / kind の追加
-- ============================================================
alter table public.tasks
  add column if not exists participants text[] not null default '{}',
  add column if not exists kind text not null default 'event';

alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks
  add constraint tasks_kind_check check (kind in ('event', 'task'));

-- ============================================================
-- 2. 既存の assignee を participants へ移す
-- ============================================================
-- パパ→大造 / ママ→いづみ / 家族→岳（子）。
update public.tasks
   set participants = case assignee
         when 'パパ' then array['大造']
         when 'ママ' then array['いづみ']
         else array['岳']
       end
 where participants = '{}';

-- ============================================================
-- 3. assignee の削除
-- ============================================================
alter table public.tasks drop column if exists assignee;
