-- 設定タブに緊急連絡先(産院・小児科・パパママの連絡先)の項目が追加されたため、
-- family_profiles にも対応するカラムを追加する。

alter table public.family_profiles
  add column if not exists hospital_name text not null default '',
  add column if not exists hospital_phone text not null default '',
  add column if not exists pediatric_name text not null default '',
  add column if not exists pediatric_phone text not null default '',
  add column if not exists papa_company_phone text not null default '',
  add column if not exists papa_contact_phone text not null default '',
  add column if not exists mama_company_phone text not null default '',
  add column if not exists mama_contact_phone text not null default '';
