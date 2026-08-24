-- すくすく手帳: 次の授乳の目安（間隔の設定・目安時刻の通知）
--
-- 「次の授乳っていつだっけ」を夫婦で言い合わずに済むよう、前回の授乳から
-- 一定の間隔をおいた時刻を「次の目安」として画面に出し、その時刻に通知する。
--
-- 授乳中の経過時間お知らせ(0021)とは別物。あちらは「いま飲ませている最中」の
-- 経過時間を鳴らすもので、こちらは「次はいつか」を知らせるもの。
--
-- 通知は予定のリマインダー(0012)と同じ購読情報(push_subscriptions)を使い、
-- Edge Function `send-feeding-reminders` が送る。

-- ============================================================
-- 1. feeding_settings: 授乳の間隔の設定
-- ============================================================
-- 夫婦で違う目安が出ては意味がないので、端末やユーザーではなく家族ごとに持つ。
-- 行が無い家族は既定値（3時間・通知する）とみなすため、画面から先に作る必要はない。
create table if not exists public.feeding_settings (
  family_id uuid primary key references public.families (id) on delete cascade,
  -- 前回の授乳から次の目安までの時間。新生児〜生後数ヶ月の目安として既定は3時間。
  interval_minutes integer not null default 180 check (interval_minutes between 30 and 480),
  -- 目安の時刻に通知するか。オフにしても画面の「次の授乳の目安」は出る。
  notify_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.feeding_settings is
  '次の授乳の目安を出すための家族ごとの設定。行が無い家族は既定値(3時間・通知する)として扱う。';
comment on column public.feeding_settings.interval_minutes is
  '前回の授乳から次の目安までの時間(分)。';
comment on column public.feeding_settings.notify_enabled is
  '目安の時刻に通知するか。オフでも画面の表示は出る。';

-- ============================================================
-- 2. feeding_reminder_deliveries: 送信済み記録
-- ============================================================
-- 定期実行は取りこぼしを拾うために少し過去のぶんも対象にするため、
-- 同じ通知を二重に送らないよう (前回の授乳, 端末, 目安時刻) で一意にする。
-- 記録の時刻や間隔の設定を変えると scheduled_for が変わるので、
-- 変更後は改めて通知される（予定のリマインダーと同じ考え方）。
create table if not exists public.feeding_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- もとになった前回の授乳の記録。記録を消せば通知の記録も消える。
  care_log_id uuid not null references public.care_logs (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  -- 目安の時刻(= 前回の授乳 + 間隔)。
  scheduled_for timestamptz not null,
  sent_at timestamptz not null default now(),
  -- pending は「送信を予約した」印。実際の送信前にこの行を作ることで、
  -- 定期実行が重なっても同じ通知が二重に飛ばないようにしている。
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  constraint feeding_reminder_deliveries_log_subscription_time_key
    unique (care_log_id, subscription_id, scheduled_for)
);

create index if not exists idx_feeding_reminder_deliveries_subscription_id
  on public.feeding_reminder_deliveries (subscription_id);
-- 古い記録の掃除用
create index if not exists idx_feeding_reminder_deliveries_sent_at
  on public.feeding_reminder_deliveries (sent_at);

-- ============================================================
-- 3. next_feeding_schedule: 目安の時刻を解決したビュー
-- ============================================================
-- 家族ごとに「いちばん新しい授乳の記録」を1件だけ取り、間隔を足して目安の時刻を出す。
-- 授乳(care_logs.type = 'milk')は母乳・搾乳・ミルクのどれでも次の起点になる。
-- ためた搾乳(type = 'pumping')は飲ませた記録ではないので数えない。
--
-- 設定の行が無い家族は既定値(3時間・通知する)として扱う。
create or replace view public.next_feeding_schedule
with (security_invoker = on) as
select
  latest.family_id,
  latest.care_log_id,
  latest.last_fed_at,
  coalesce(s.interval_minutes, 180)                                              as interval_minutes,
  latest.last_fed_at + make_interval(mins => coalesce(s.interval_minutes, 180))   as due_at
from (
  select distinct on (c.family_id)
         c.family_id,
         c.id         as care_log_id,
         c.logged_at  as last_fed_at
    from public.care_logs c
   where c.type = 'milk'
   order by c.family_id, c.logged_at desc
) as latest
left join public.feeding_settings s on s.family_id = latest.family_id
where coalesce(s.notify_enabled, true);

comment on view public.next_feeding_schedule is
  '家族ごとの「前回の授乳」と次の目安の時刻(due_at)。Edge Function send-feeding-reminders が参照する。';

-- 配信専用のビューで、画面からは使わない（画面は自分の家族の記録から直接求める）。
revoke select on public.next_feeding_schedule from anon, authenticated;

-- ============================================================
-- 4. Row Level Security
-- ============================================================
alter table public.feeding_settings enable row level security;
alter table public.feeding_reminder_deliveries enable row level security;

-- 間隔の設定は家族で共通なので、家族の誰でも読み書きできる。
create policy "feeding_settings_family_all" on public.feeding_settings
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- 送信記録は書き込みを Edge Function (service_role) に限定し、
-- 参照だけ自分の端末ぶんを許可する（通知が届かないときの確認用）。
create policy "feeding_reminder_deliveries_own_select" on public.feeding_reminder_deliveries
  for select using (
    exists (
      select 1 from public.push_subscriptions s
      where s.id = feeding_reminder_deliveries.subscription_id
        and s.user_id = (select auth.uid())
    )
  );
