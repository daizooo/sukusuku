-- 育児記録に種類別の項目を持たせる
--
-- これまでは記録の内容を amount (自由入力の文字列) 1つで持っていたため、
-- 「母乳を左10分・右15分、最後は右で終了」「うんちが白っぽい」「13:00に寝て15:15に起きた」
-- といった、種類ごとに形の違う情報を残せなかった。
--
-- 種類ごとに列を足すと care_logs が横に広がり続けるため、
-- 種類別の項目は details (jsonb) にまとめて入れる。入る中身は次のとおり。
--
--   milk   : { method: 'breast'|'formula', amountMl?, leftMinutes?, rightMinutes?, lastSide?: 'left'|'right' }
--   diaper : { kind: 'pee'|'poop'|'both', poopColor?, poopConsistency? }
--   sleep  : { startedAt: ISO文字列, endedAt: ISO文字列 | null }  -- 計測中は endedAt が null
--
-- 既存の記録は details が空のまま残る。アプリ側は details が空の記録を
-- 従来どおり amount の文字列で表示する（移行は行わない）。

alter table public.care_logs
  add column if not exists details jsonb not null default '{}'::jsonb;

comment on column public.care_logs.details is
  '記録の種類ごとの項目。milk: method/amountMl/leftMinutes/rightMinutes/lastSide, diaper: kind/poopColor/poopConsistency, sleep: startedAt/endedAt';

-- 計測中の睡眠（起床時刻が未確定のもの）を探す用途のインデックス。
-- 起床の記録漏れがない限り常に0〜1件なので、部分インデックスにする。
-- jsonb の null を SQL の NULL として扱うため、比較は ->> で行う（-> だと一致しない）。
create index if not exists idx_care_logs_active_sleep
  on public.care_logs (family_id)
  where type = 'sleep' and details->>'startedAt' is not null and details->>'endedAt' is null;
