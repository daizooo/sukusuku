-- すくすく手帳: 「自分だけ」の予定・タスクの通知を、作成した本人の端末だけへ送る
--
-- 「自分だけ」(is_private = true) の予定・タスクは、画面ではRLSで作成者にしか見えない
-- （0040）。ところが通知の配信は service_role で動く Edge Function（RLSが効かない）で、
-- ビュー task_reminder_schedule も is_private / created_by を持っていなかったため、
-- 「自分だけ」の予定のタイトル・場所が家族全員の端末へ通知されていた。
--
-- ここでビューに is_private と created_by を足す。宛先を作成者の端末だけに絞る処理は
-- Edge Function send-reminders が行う（_shared/reminderRecipients.ts）。
-- 列は末尾に足すだけなので、これまでの列・並び・権限は変えない。
--
-- 適用の順序: **先にこれを適用し、そのあとに Edge Function send-reminders をデプロイする。**
--   - 旧い関数は足した列を読まないだけなので、適用しても通知は今までどおり届く
--   - 関数を先に出すと、列がまだ無い間は「自分だけ」の判定ができず、全員に届いてしまう
-- 適用してから関数をデプロイするまでの間は、これまでと同じ（全員に届く）ことに注意。

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
     at time zone 'Asia/Tokyo')                                    as remind_at,
  t.is_private,
  t.created_by
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
  -- 日付指定で繰り返すものは、回ごとの通知を Edge Function が担当する（0050）。
  and (t.recurrence is null or t.anchor_type <> 'absolute');

comment on view public.task_reminder_schedule is
  '未完了の予定・タスク（繰り返さないもの）と、その通知時刻(remind_at。予定の日時そのもの)。繰り返す予定は Edge Function send-reminders が展開して通知する。is_private の行は created_by の端末にだけ送る。';

-- create or replace でも権限は引き継がれるが、配信専用であることを明示しておく。
revoke select on public.task_reminder_schedule from anon, authenticated;
