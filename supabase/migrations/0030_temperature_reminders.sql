-- すくすく手帳: 検温のお知らせ（朝・夕の決まった時刻に体温の記録を促す）
--
-- 体温は「熱が出てから測る」ものではなく、**平熱を知るために毎日決まった時刻に測る**もの。
-- 平熱が分かっていて初めて「この子にしては高い」が言える（careLogUtils の平熱）。
-- ところが決まった時刻に測るのは忘れやすいので、朝と夕の2回、その時刻に通知する。
--
-- 予定のリマインダー(0012)・次の授乳の目安(0024)と同じ購読情報(push_subscriptions)を使い、
-- Edge Function `send-temperature-reminders` が送る。

-- ============================================================
-- 1. temperature_reminder_settings: 検温のお知らせの設定
-- ============================================================
-- 「毎日この時刻に測る」は夫婦で揃っていないと平熱の比べる相手にならないため、
-- 端末やユーザーではなく家族ごとに持つ。
-- 行が無い家族は既定値（朝6時・夕18時・お知らせする）とみなすので、
-- 設定を触るまでDBに行は作られない（feeding_settings と同じ考え方）。
create table if not exists public.temperature_reminder_settings (
  family_id uuid primary key references public.families (id) on delete cascade,
  -- お知らせそのものの入り切り。オフにしても体温の記録はいつでもできる。
  enabled boolean not null default true,
  -- 朝の検温の時刻。授乳や離乳食の前が測りやすいので、既定は6時。
  morning_time time not null default '06:00',
  -- 夕方の検温の時刻。既定は18時。
  evening_time time not null default '18:00',
  updated_at timestamptz not null default now()
);

comment on table public.temperature_reminder_settings is
  '検温のお知らせの家族ごとの設定。行が無い家族は既定値(朝6時・夕18時・お知らせする)として扱う。';
comment on column public.temperature_reminder_settings.morning_time is
  '朝の検温をお知らせする時刻(日本時間)。';
comment on column public.temperature_reminder_settings.evening_time is
  '夕方の検温をお知らせする時刻(日本時間)。';

-- ============================================================
-- 2. temperature_reminder_deliveries: 送信済み記録
-- ============================================================
-- 定期実行は取りこぼしを拾うために少し過去のぶんも対象にするため、
-- 同じ通知を二重に送らないよう (家族, 端末, お知らせの時刻) で一意にする。
-- 時刻の設定を変えると scheduled_for が変わるので、変更後は改めて通知される
-- （予定のリマインダー・授乳の目安と同じ考え方）。
create table if not exists public.temperature_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  -- お知らせの時刻(= その日の morning_time / evening_time)。
  scheduled_for timestamptz not null,
  sent_at timestamptz not null default now(),
  -- pending は「送信を予約した」印。実際の送信前にこの行を作ることで、
  -- 定期実行が重なっても同じ通知が二重に飛ばないようにしている。
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  constraint temperature_reminder_deliveries_family_subscription_time_key
    unique (family_id, subscription_id, scheduled_for)
);

create index if not exists idx_temperature_reminder_deliveries_subscription_id
  on public.temperature_reminder_deliveries (subscription_id);
-- 古い記録の掃除用
create index if not exists idx_temperature_reminder_deliveries_sent_at
  on public.temperature_reminder_deliveries (sent_at);

-- ============================================================
-- 3. temperature_reminder_schedule: お知らせの時刻を解決したビュー
-- ============================================================
-- 家族ごとに、朝と夕それぞれの「今日の時刻」と「昨日の時刻」を出す。
-- 昨日のぶんも出すのは、夜遅い時刻に設定していると日付をまたいだ直後の実行で
-- 今日のぶんがまだ未来になり、取りこぼしを拾えなくなるため。
-- 実際に送るかどうか（何分前まで遡るか）は Edge Function 側で絞る。
--
-- 時刻は日本時間で解釈する（家族全員が日本にいる前提。他のビューと同じ）。
--
-- **もう測っていればお知らせしない。** お知らせの時刻の1時間前以降に体温の記録が
-- あれば、その回は出さない。少し早めに測った直後に「体温を測りましょう」と
-- 届くのは、ただの邪魔になるため。
create or replace view public.temperature_reminder_schedule
with (security_invoker = on) as
with settings as (
  select
    f.id                                        as family_id,
    coalesce(s.enabled, true)                   as enabled,
    coalesce(s.morning_time, '06:00'::time)     as morning_time,
    coalesce(s.evening_time, '18:00'::time)     as evening_time
  from public.families f
  left join public.temperature_reminder_settings s on s.family_id = f.id
),
slots as (
  select family_id, 'morning' as slot, morning_time as at_time from settings where enabled
  union all
  select family_id, 'evening' as slot, evening_time as at_time from settings where enabled
),
occurrences as (
  select
    slots.family_id,
    slots.slot,
    ((((now() at time zone 'Asia/Tokyo')::date - days.back) + slots.at_time)
      at time zone 'Asia/Tokyo')                as scheduled_for
  from slots
  cross join (values (0), (1)) as days (back)
)
select o.family_id, o.slot, o.scheduled_for
  from occurrences o
 where not exists (
   select 1
     from public.care_logs c
    where c.family_id = o.family_id
      and c.type = 'temperature'
      and c.logged_at >= o.scheduled_for - interval '1 hour'
 );

comment on view public.temperature_reminder_schedule is
  '家族ごとの検温のお知らせの時刻(scheduled_for)。Edge Function send-temperature-reminders が参照する。';

-- 配信専用のビューで、画面からは使わない（画面は設定の時刻をそのまま出す）。
revoke select on public.temperature_reminder_schedule from anon, authenticated;

-- ============================================================
-- 4. Row Level Security
-- ============================================================
alter table public.temperature_reminder_settings enable row level security;
alter table public.temperature_reminder_deliveries enable row level security;

-- 時刻の設定は家族で共通なので、家族の誰でも読み書きできる。
create policy "temperature_reminder_settings_family_all" on public.temperature_reminder_settings
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- 送信記録は書き込みを Edge Function (service_role) に限定し、
-- 参照だけ自分の端末ぶんを許可する（通知が届かないときの確認用）。
create policy "temperature_reminder_deliveries_own_select" on public.temperature_reminder_deliveries
  for select using (
    exists (
      select 1 from public.push_subscriptions s
      where s.id = temperature_reminder_deliveries.subscription_id
        and s.user_id = (select auth.uid())
    )
  );
