-- すくすく手帳: 予定・タスクの通知を「設定した日時に必ず」へ一本化する
--
-- これまでは予定ごとに「何分前に通知するか」(remind_minutes_before) を選べ、
-- null なら通知しなかった。入力欄からリマインダーを無くし、予定・タスクとも
-- 設定した日時ちょうどに必ず通知する（時刻が無いものは終日として朝9時。0012）。
--
-- 方針: remind_minutes_before 列は消さず、配信のビューが値を見ないようにする。
--   - 列を消すと、まだ列へ書き込む旧版（旧APK・旧Web版）の予定の追加・更新が失敗する
--   - ビューが値を見なければ、旧版が null や「前日」を書いても通知の時刻は変わらない
-- そのため、このマイグレーションは新版のデプロイの前後どちらで適用してもよい。
-- 列は旧版が使われなくなったあとの別のマイグレーションで消す。

-- 既存の予定・タスクも、通知なし(null)や「前日」などの設定を捨てて時刻ちょうどにそろえる。
update public.tasks
   set remind_minutes_before = 0
 where remind_minutes_before is distinct from 0;

alter table public.tasks
  alter column remind_minutes_before set default 0;

-- 通知時刻 = 予定の時刻。remind_minutes_before の列は、ビューの列の並びを
-- 変えないために常に0で出す（Edge Function send-reminders はこの値を使わない）。
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
  and resolved.target_date is not null;

comment on view public.task_reminder_schedule is
  '未完了の予定・タスクと、その通知時刻(remind_at。予定の日時そのもの)。Edge Function send-reminders が参照する。';

-- create or replace でも権限は引き継がれるが、配信専用であることを明示しておく。
revoke select on public.task_reminder_schedule from anon, authenticated;
