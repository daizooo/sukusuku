-- 吐き戻しの記録を追加する
--
-- メモ欄を集計したら、いちばん多い中身が吐き戻しだった（メモの27%、docs/what-to-record.md §11-3）。
-- 毎日手で書いているものなので、量の3択に置き換えて形にする。
--
--   spitup : { amount: 'little' | 'lot' | 'projectile',  -- 吐いた量。噴水状は受診の目安
--              minutesAfterMilk: 数値 }                  -- 直前の授乳からの間隔(分)。無ければ持たない
--
-- 0028（体温）と同じく check 制約を張り直すだけで、既存の行には触らない。
-- type = 'sleep' も引き続き許可しておく（記録タブでは扱わないが、行は残してある）。

alter table public.care_logs drop constraint if exists care_logs_type_check;

alter table public.care_logs
  add constraint care_logs_type_check
  check (type in ('milk', 'diaper', 'sleep', 'pumping', 'temperature', 'spitup'));

comment on column public.care_logs.details is
  '記録の種類ごとの項目。milk: method(breast/pumped/formula)/amountMl/leftMinutes/rightMinutes/lastSide, diaper: kind/poopColor/poopConsistency, pumping: amountMl, temperature: celsius, spitup: amount(little/lot/projectile)/minutesAfterMilk';
