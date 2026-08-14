-- 設定タブでユーザーが自由に項目(見出し+内容)を追加・削除できるようにするため、
-- family_profiles にカスタム項目を保存するカラムを追加する。
-- 各要素は { id: string, label: string, value: string } の配列。

alter table public.family_profiles
  add column if not exists custom_fields jsonb not null default '[]'::jsonb;
