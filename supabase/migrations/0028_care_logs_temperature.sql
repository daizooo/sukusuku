-- 体温の記録を追加する
--
-- 受診したときに必ず「いつから・何度か」を聞かれるのに、care_logs には体温が無かった
-- （docs/what-to-record.md §4-1）。授乳の分数を1年分残すより、発熱した3日間の
-- 折れ線1本のほうが値打ちがある、という判断で足す。
--
--   temperature : { celsius: 数値 }   -- 測った体温(℃)。小数第1位まで
--
-- 0019 と同じく check 制約を張り直すだけで、既存の行には触らない。
-- type = 'sleep' も引き続き許可しておく（記録タブでは扱わないが、行は残してある）。

alter table public.care_logs drop constraint if exists care_logs_type_check;

alter table public.care_logs
  add constraint care_logs_type_check
  check (type in ('milk', 'diaper', 'sleep', 'pumping', 'temperature'));

comment on column public.care_logs.details is
  '記録の種類ごとの項目。milk: method(breast/pumped/formula)/amountMl/leftMinutes/rightMinutes/lastSide, diaper: kind/poopColor/poopConsistency, pumping: amountMl, temperature: celsius';
