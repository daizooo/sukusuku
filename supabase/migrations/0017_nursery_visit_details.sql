-- 保育園に住所と見学日時を持たせる
--
-- 見学の連絡・当日の移動には園の住所が要るが、これまでは distance
-- （「車5分」などのアクセスメモ）しか持っていなかった。
-- また見学の日時は保活メモ側に置き場がなく、メモ欄に書くしかなかった。
--
-- 見学日時は予定(tasks)と同じ持ち方に合わせ、日付は date、時刻は 'HH:mm' の
-- 文字列で持つ（どちらも未定のうちは null）。

alter table public.nurseries
  add column if not exists address text default '',
  add column if not exists visit_date date,
  add column if not exists visit_time text;

comment on column public.nurseries.address is '園の住所';
comment on column public.nurseries.visit_date is '見学日。未定なら null';
comment on column public.nurseries.visit_time is '見学の時刻 (HH:mm)。未定なら null';
