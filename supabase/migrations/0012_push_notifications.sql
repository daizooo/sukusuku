-- すくすく手帳: リマインダー配信 (Web Push) のためのテーブルとビュー
--
-- これまでリマインダーは tasks.remind_minutes_before に「予定の何分前に通知するか」を
-- 保存するだけで、配信の仕組みが無かった。
-- Service Worker + Web Push で配信するために、
--   - 端末ごとの購読情報 (push_subscriptions)
--   - 送信済み記録 (reminder_deliveries)
--   - 通知時刻を解決したビュー (task_reminder_schedule)
-- を用意する。実際の送信は Edge Function `send-reminders` が行う。

-- ============================================================
-- 1. push_subscriptions: 端末ごとの購読情報
-- ============================================================
-- PushSubscription は「ブラウザ + 端末 + オリジン」ごとに発行される。
-- 同じユーザーがスマホとPCから購読すれば2行になるため、user_id ではなく
-- endpoint を一意キーにする。
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  endpoint text not null unique,
  -- 暗号化に使う公開鍵と認証シークレット (PushSubscription.getKey() の base64url)
  p256dh text not null,
  auth text not null,
  -- どの端末の購読かを設定画面で見分けるための表示用
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  -- 連続失敗の回数。410/404 が返った購読は Edge Function 側で削除する。
  failure_count integer not null default 0
);

create index if not exists idx_push_subscriptions_family_id
  on public.push_subscriptions (family_id);
create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

-- ============================================================
-- 2. reminder_deliveries: 送信済み記録
-- ============================================================
-- 定期実行は取りこぼしを拾うために過去ぶんも対象にするため、
-- 同じ通知を二重に送らないよう (予定, 端末, 通知時刻) で一意にする。
-- 予定の日時やリマインダー設定を変えると scheduled_for が変わるので、
-- 変更後は改めて通知される（これは意図した挙動）。
create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  scheduled_for timestamptz not null,
  sent_at timestamptz not null default now(),
  -- pending は「送信を予約した」印。実際の送信前にこの行を作ることで、
  -- 定期実行が重なっても同じ通知が二重に飛ばないようにしている。
  -- 送信結果が確定したら sent / failed に更新する。
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  constraint reminder_deliveries_task_subscription_time_key
    unique (task_id, subscription_id, scheduled_for)
);

create index if not exists idx_reminder_deliveries_subscription_id
  on public.reminder_deliveries (subscription_id);
-- 古い記録の掃除用
create index if not exists idx_reminder_deliveries_sent_at
  on public.reminder_deliveries (sent_at);

-- ============================================================
-- 3. 誕生日の取り出し
-- ============================================================
-- 出生日基準(anchor_type = 'birth_relative')の予定の日付は
-- 「子の誕生日 + days_after_birth」で決まる。画面側では
-- SukusukuApp の dynamicTodos が解決しているが、配信はサーバー側で
-- 動くため、SQLからも誕生日を引けるようにする。
--
-- 誕生日は family_profiles.child_fields (jsonb配列) の
-- key = 'birthDate' の要素の value に 'YYYY-MM-DD' で入っている。
-- ユーザーが自由に項目を編集できるカラムなので、
-- 配列でない・日付として読めない場合は null を返す。
create or replace function public.family_birth_date(p_family_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value text;
begin
  select field.value ->> 'value'
    into v_value
    from public.family_profiles p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.child_fields) = 'array' then p.child_fields else '[]'::jsonb end
    ) as field(value)
   where p.family_id = p_family_id
     and field.value ->> 'key' = 'birthDate'
   limit 1;

  if v_value is null or v_value = '' then
    return null;
  end if;

  return v_value::date;
exception
  when others then
    -- 日付として読めない値が入っていても配信全体を落とさない
    return null;
end;
$$;

-- ============================================================
-- 4. task_reminder_schedule: 通知時刻を解決したビュー
-- ============================================================
-- 日付・時刻は timestamptz ではなく date + time で保持している
-- (家族全員が同一タイムゾーンにいる前提)。通知時刻を求めるには
-- タイムゾーンを補う必要があるので、ここで Asia/Tokyo として解釈する。
--
-- 終日予定(start_time が null)は 09:00 を予定時刻とみなす。
-- 「前日」を選ぶと前日の 09:00 に通知される。
create or replace view public.task_reminder_schedule
with (security_invoker = on) as
select
  t.id                                        as task_id,
  t.family_id,
  t.title,
  t.category,
  t.place,
  t.start_time,
  t.remind_minutes_before,
  resolved.target_date,
  ((resolved.target_date + coalesce(t.start_time, time '09:00'))
     at time zone 'Asia/Tokyo')                                    as starts_at,
  ((resolved.target_date + coalesce(t.start_time, time '09:00'))
     at time zone 'Asia/Tokyo')
     - make_interval(mins => t.remind_minutes_before)              as remind_at
from public.tasks t
cross join lateral (
  select case
           when t.anchor_type = 'absolute' then t.start_date
           -- 誕生日が未登録なら null になり、下の where で除外される
           else public.family_birth_date(t.family_id) + t.days_after_birth
         end as target_date
) as resolved
where t.remind_minutes_before is not null
  and not t.is_done
  and resolved.target_date is not null;

comment on view public.task_reminder_schedule is
  'リマインダーが設定された未完了の予定と、その通知時刻(remind_at)。Edge Function send-reminders が参照する。';

-- family_birth_date は security definer なので、そのままだとログイン中の誰でも
-- /rest/v1/rpc/family_birth_date から他の家族の family_id を指定して
-- 誕生日を引けてしまう。参照するのは配信(service_role)だけなので実行させない。
revoke execute on function public.family_birth_date(uuid) from public, anon, authenticated;

-- ビューも配信専用で画面からは使わない。
revoke select on public.task_reminder_schedule from anon, authenticated;

-- ============================================================
-- 5. 連続失敗のカウントアップ
-- ============================================================
-- 送信に失敗した購読の failure_count を増やす。読み取ってから書き戻すと
-- 実行が重なったときに数え漏れるため、DB側で加算する。
create or replace function public.increment_push_failure(p_subscription_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_subscriptions
     set failure_count = failure_count + 1
   where id = p_subscription_id;
$$;

-- 呼ぶのは Edge Function (service_role) だけなので、一般ユーザーからは実行させない。
revoke execute on function public.increment_push_failure(uuid) from public, anon, authenticated;

-- ============================================================
-- 6. Row Level Security
-- ============================================================
alter table public.push_subscriptions enable row level security;
alter table public.reminder_deliveries enable row level security;

-- 購読情報は本人のものだけ読み書きできる。
-- (他の端末の購読を消せてしまうと、パートナーの通知を勝手に止められるため)
create policy "push_subscriptions_own_select" on public.push_subscriptions
  for select using (user_id = (select auth.uid()));
create policy "push_subscriptions_own_insert" on public.push_subscriptions
  for insert with check (
    user_id = (select auth.uid()) and family_id = public.current_family_id()
  );
create policy "push_subscriptions_own_update" on public.push_subscriptions
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "push_subscriptions_own_delete" on public.push_subscriptions
  for delete using (user_id = (select auth.uid()));

-- 送信記録は書き込みを Edge Function (service_role) に限定し、
-- 参照だけ自分の端末ぶんを許可する（通知が届かないときの確認用）。
create policy "reminder_deliveries_own_select" on public.reminder_deliveries
  for select using (
    exists (
      select 1 from public.push_subscriptions s
      where s.id = reminder_deliveries.subscription_id
        and s.user_id = (select auth.uid())
    )
  );
