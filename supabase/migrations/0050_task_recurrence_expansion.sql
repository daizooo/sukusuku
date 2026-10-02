-- すくすく手帳: 繰り返す予定・タスクの「展開」に必要な変更
--
-- 0042 で繰り返しのルールだけを保存できるようにした。今回は、ルールを回ごとの日付へ
-- 展開してカレンダーに並べ、回ごとに通知・完了できるようにする。
--
-- 1. 回ごとの完了: done_dates（完了にした回の日付の配列）を追加する。
--    繰り返す予定・タスクは、予定そのものの完了（is_done）ではなく、この配列に回の日付が
--    入っているかで「その回が完了か」を決める。繰り返さないものは今までどおり is_done。
--    回ごとの行は作らない（日付の一覧はルールから計算できるため）。
-- 2. 通知: 回ごとの通知時刻は SQL では出さず、Edge Function send-reminders が
--    ルールを展開して求める。そのため task_reminder_schedule は、日付指定で繰り返す
--    予定・タスクを返さないようにする（返すと開始日の1回ぶんが二重に通知される）。
--    生後日数で日付を決める予定は繰り返しを持てない（入力欄を出さない）ので、
--    古いデータに繰り返しの設定が残っていても、これまでどおりビューが扱う。
--
-- 適用の順序: **先に Edge Function send-reminders をデプロイし、そのあとにこれを適用する。**
--   - 関数は done_dates が無い間は繰り返す予定を読めないが、そのときは読み飛ばして
--     繰り返さない予定の通知だけを送る（ビューは変えていないので、繰り返す予定も
--     開始日の1回ぶんは今までどおりビューから届く）
--   - 適用した瞬間から、関数が回ごとの通知を担当し、ビューは外れる（通知の空白も二重も無い）
--   - 逆の順序（これを先に適用）だと、関数をデプロイするまで繰り返す予定は通知されない
-- 新しい画面（回ごとの完了）は、この適用の前だと完了の保存に失敗する（元に戻って
-- 警告が出るだけで、ほかの操作は影響を受けない）ので、適用はアプリの配布と続けて行う。

alter table public.tasks
  add column if not exists done_dates date[] not null default '{}';

comment on column public.tasks.done_dates is
  '繰り返す予定・タスクで、完了にした回の日付。繰り返さないものは is_done を使い、これは空のまま。';

create or replace view public.task_reminder_schedule
with (security_invoker = on) as
select
  t.id                                        as task_id,
  t.family_id,
  t.title,
  t.category,
  t.place,
  t.start_time,
  0                                           as remind_minutes_before,
  resolved.target_date,
  ((resolved.target_date + coalesce(t.start_time, time '09:00'))
     at time zone 'Asia/Tokyo')                                    as starts_at,
  ((resolved.target_date + coalesce(t.start_time, time '09:00'))
     at time zone 'Asia/Tokyo')                                    as remind_at
from public.tasks t
cross join lateral (
  select case
           when t.anchor_type = 'absolute' then t.start_date
           -- 誕生日が未登録なら null になり、下の where で除外される
           else public.family_birth_date(t.family_id) + t.days_after_birth
         end as target_date
) as resolved
where not t.is_done
  and resolved.target_date is not null
  -- 日付指定で繰り返すものは、回ごとの通知を Edge Function が担当する。
  and (t.recurrence is null or t.anchor_type <> 'absolute');

comment on view public.task_reminder_schedule is
  '未完了の予定・タスク（繰り返さないもの）と、その通知時刻(remind_at。予定の日時そのもの)。繰り返す予定は Edge Function send-reminders が展開して通知する。';

-- create or replace でも権限は引き継がれるが、配信専用であることを明示しておく。
revoke select on public.task_reminder_schedule from anon, authenticated;
