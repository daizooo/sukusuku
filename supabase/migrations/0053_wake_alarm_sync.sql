-- すくすく手帳: 夜間の起床アラームを、他の端末（PWAなど）での記録にも追従させる
--
-- 起床アラームの予約は端末の目覚まし（AlarmManager）に預けてあり、端末が自分で組み直すのは
-- 「自分で記録した／アプリを開いた／設定を変えた」ときだけ。PWAやパートナーの端末で授乳を
-- 記録しても、その端末は気づけず、古い時刻に鳴って本当の時刻には鳴らない。
-- そこでサーバーが毎分、端末ごとに「いま予約しているべき時刻」を求め、前回送った内容と
-- 違えば、FCMのデータ通知（画面に出ない）で端末へ伝える（docs/night-wake-alarm.md §4）。
-- 受け取った端末は、ネイティブ側がそのまま目覚ましを入れ替える。
--
-- 計算に要る設定（オンか・おやすみ時間）は端末が自分の宛先の行へ写す。
-- 「前回送った内容」は、同じ内容を毎分送り直さないために行に持つ。
--
-- 適用の順序: **先にこれを適用し、そのあとに Edge Function send-feeding-reminders をデプロイする。**
--   - 旧い関数は足した列を読まないだけなので、適用しても通知は今までどおり届く
--   - 関数を先に出すと、列がまだ無い間は購読の取得に失敗して授乳の通知が止まる

alter table public.push_subscriptions
  add column if not exists wake_alarm_enabled boolean not null default false,
  add column if not exists wake_quiet_start smallint,
  add column if not exists wake_quiet_end smallint,
  add column if not exists wake_synced_trigger_at timestamptz,
  add column if not exists wake_synced_due_at timestamptz;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_wake_quiet_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_wake_quiet_check check (
    (wake_quiet_start is null and wake_quiet_end is null)
    or (
      wake_quiet_start between 0 and 1439
      and wake_quiet_end between 0 and 1439
    )
  );

comment on column public.push_subscriptions.wake_alarm_enabled is
  'この端末で夜間の起床アラームを使うか（端末の設定を写したもの）。';
comment on column public.push_subscriptions.wake_quiet_start is
  '起床アラームの対象にするおやすみ時間の開始(日本時間0:00からの分)。';
comment on column public.push_subscriptions.wake_quiet_end is
  '起床アラームの対象にするおやすみ時間の終了(日本時間0:00からの分)。開始より小さければ日をまたぐ。';
comment on column public.push_subscriptions.wake_synced_trigger_at is
  'サーバーが最後に端末へ伝えた起床アラームの鳴らす時刻。null = 予約なしと伝えた（または未送信）。';
comment on column public.push_subscriptions.wake_synced_due_at is
  'その予約のもとになった次の授乳の目安の時刻。';
