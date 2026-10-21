-- 記録の上の帯（未確定明細）の「翌月へ送る」（docs/kakei.md §0.7・§3.6。2026-10-21）
--
-- - deferred_until: 帯に出すルール（makes_record = false）を、この日まで帯に出さない。「翌月へ送る」で翌月1日を入れる。
--   null は送っていない。過ぎたら、その日から（記録が無ければ）また帯に出る
-- money_bootstrap は to_jsonb(r) で返すので、関数は変えない。

alter table public.money_recurring add column if not exists deferred_until date;
