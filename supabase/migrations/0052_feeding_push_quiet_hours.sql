-- すくすく手帳: 「次の授乳」の通知を、端末ごとにおやすみ時間だけ止められるようにする
--
-- 次の授乳の目安の通知(send-feeding-reminders)は、家族の全端末へ届く。夜に授乳しない側の端末が
-- 起こされないよう、端末（購読）ごとに「この時間帯に目安が来るものは送らない」を持たせる
-- （docs/night-wake-alarm.md §6）。
--
-- 時間帯は日本時間の0:00からの分で持つ（22:00 = 1320）。開始 > 終了なら日をまたぐ
-- （22:00〜6:00 = 1320〜360）。開始 = 終了は「おやすみ時間なし」として扱う。
-- 2つとも null の端末は今までどおり、いつでも届く。
--
-- 止めるのは「次の授乳」(kind = 'feeding')の通知だけ。予定のリマインダーや検温などは
-- 別の仕組みなので触らない。
--
-- 適用の順序: **先にこれを適用し、そのあとに Edge Function send-feeding-reminders をデプロイする。**
--   - 旧い関数は足した列を読まないだけなので、適用しても通知は今までどおり届く
--   - 関数を先に出すと、列がまだ無い間は購読の取得に失敗して授乳の通知が止まる

alter table public.push_subscriptions
  add column if not exists feeding_quiet_start smallint,
  add column if not exists feeding_quiet_end smallint;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_feeding_quiet_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_feeding_quiet_check check (
    (feeding_quiet_start is null and feeding_quiet_end is null)
    or (
      feeding_quiet_start between 0 and 1439
      and feeding_quiet_end between 0 and 1439
    )
  );

comment on column public.push_subscriptions.feeding_quiet_start is
  '次の授乳の通知を止めるおやすみ時間の開始(日本時間0:00からの分)。null = 止めない。';
comment on column public.push_subscriptions.feeding_quiet_end is
  '次の授乳の通知を止めるおやすみ時間の終了(日本時間0:00からの分)。開始より小さければ日をまたぐ。';
