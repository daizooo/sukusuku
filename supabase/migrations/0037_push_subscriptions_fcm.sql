-- すくすく手帳: ネイティブ版(Android)へも通知を送れるようにする
--
-- 通知の宛先はこれまでブラウザのWeb Push購読(0012)だけだった。
-- ネイティブ版はService Workerを持たず、代わりにFCMの登録トークンで受け取るため、
-- 宛先の種類を push_subscriptions に持たせて1つの表で扱う。
--
-- なぜ別の表を作らないか:
--   送信済み記録(reminder_deliveries 0012 / feeding_reminder_deliveries 0024 /
--   temperature_reminder_deliveries 0030)と授乳の予約(nursing_alarms 0021)は
--   すべて push_subscriptions.id を参照している。宛先の表を分けると、
--   二重送信の防止・失効した宛先の片付け・RLSを宛先の種類ごとに二重に持つことになる。
--   ここに1列足すだけなら、それらはそのまま動く。
--
-- 行の形は種類ごとに次のようになる。
--   kind = 'webpush' … endpoint はプッシュサービスのURL。p256dh / auth は暗号化に使う鍵
--   kind = 'fcm'     … endpoint は 'fcm:' + FCMの登録トークン。p256dh / auth は空文字
--
-- endpoint に接頭辞を付けるのは、一意キー(endpoint)をそのまま「端末ごとに1行」の
-- 決まりとして使い続けるため。トークンだけを入れるとURLと見分けが付かない。

-- ============================================================
-- 1. 宛先の種類
-- ============================================================
alter table public.push_subscriptions
  add column if not exists kind text not null default 'webpush';

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_kind_check;

alter table public.push_subscriptions
  add constraint push_subscriptions_kind_check check (kind in ('webpush', 'fcm'));

-- FCMの宛先は暗号化の鍵を持たないので、入れずに登録できるようにする。
-- (既存の列は not null のまま。Web Pushの行はこれまでどおり必ず値が入る)
alter table public.push_subscriptions alter column p256dh set default '';
alter table public.push_subscriptions alter column auth set default '';

comment on column public.push_subscriptions.kind is
  '宛先の種類。webpush = ブラウザのWeb Push購読 / fcm = ネイティブ版の登録トークン（endpoint は fcm: で始まる）。';
comment on column public.push_subscriptions.endpoint is
  '端末ごとに一意な宛先。webpush はプッシュサービスのURL、fcm は fcm: + 登録トークン。';
comment on column public.push_subscriptions.p256dh is
  'Web Pushの暗号化に使う公開鍵。fcm の行では空文字。';
comment on column public.push_subscriptions.auth is
  'Web Pushの認証シークレット。fcm の行では空文字。';

-- 配信側は家族ぶんの宛先を種類込みで引くので、種類も含めて引けるようにしておく。
create index if not exists idx_push_subscriptions_kind
  on public.push_subscriptions (kind);
