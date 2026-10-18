-- 見積費（docs/kakei.md §3.6。2026-10-17）
--
-- 車検・自動車保険・ふるさと納税・行事のように、出ることは決まっているが額が少しぶれ、カードや現金で払うものを、
-- 固定支出のルール（money_recurring）に「記録を作らない」ものとして持つ。予算と年末の着地見込みにだけ入り（アプリで計算）、
-- 実績は、その年に同じ小分類で入った記録をアプリが自動で結びつける。
--
-- - makes_record: false は見積費。出金元を持たない（wallet_id は null）ので、make_money_recurring_records（wallet_id が
--   null のルールは作らない）は変えずに、記録が作られない。念のため、見積費に出金元が入らないように check で止める
-- - skipped_months: 見積費で「今年はなし」にした回（予定の月 'YYYY-MM'）
-- - money_bootstrap は to_jsonb(r) で返すので、関数は変えない。family_sync は表に付いているので、そのまま

alter table public.money_recurring
  add column if not exists makes_record boolean not null default true,
  add column if not exists skipped_months text[] not null default '{}';

alter table public.money_recurring
  add constraint money_recurring_estimate_no_wallet check (makes_record or wallet_id is null);
