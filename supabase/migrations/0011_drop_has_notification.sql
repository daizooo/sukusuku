-- すくすく手帳: カレンダー移行(0010)の後片付け
--
-- 0010 で以下へ移行済みだが、適用時点の本番では旧コードが動いていたため、
-- 旧カラム・旧値を残したままにしていた。ここで削除・縮小する。
--   - has_notification -> remind_minutes_before
--   - assignee の '二人で' / '未定' -> '家族'
--
-- ============================================================
-- 適用条件（重要）
-- ============================================================
-- has_notification への書き込みを止めたコード
-- (src/lib/api/tasks.ts の toWritableRow) が **本番にデプロイ済みであること**。
--
-- 0010 の時点では「マージ後に削除する」としていたが、0010 のコードは
-- カラムが残っている間の整合のため has_notification を明示的に insert/update
-- していた。そのため 0010 をマージしただけの状態でこのマイグレーションを
-- 適用すると、本番の予定の追加・更新が
--   column "has_notification" of relation "tasks" does not exist
-- で失敗する。書き込みを外したデプロイの完了を確認してから適用すること。

-- ============================================================
-- 1. has_notification の削除
-- ============================================================
alter table public.tasks drop column if exists has_notification;

-- ============================================================
-- 2. assignee を パパ / ママ / 家族 の3値に絞る
-- ============================================================
-- 0010 の update で旧値の行は '家族' へ寄せ済み。制約を狭める前に、
-- 0010 適用後に旧コードから書き込まれた取りこぼしがあれば同じように寄せる。
update public.tasks
   set assignee = '家族'
 where assignee not in ('パパ', 'ママ', '家族');

alter table public.tasks drop constraint if exists tasks_assignee_check;
alter table public.tasks
  add constraint tasks_assignee_check
    check (assignee in ('パパ', 'ママ', '家族'));
