-- 設定タブの各セクション(お子様の情報・パパママ情報・緊急連絡先)についても
-- カスタム項目と同様に、ユーザーが自由に項目(見出し+内容)を追加・削除できるようにする。
-- 固定カラムをjsonb配列(ProfileField[])のカラムに置き換える。
-- 各要素は { id: string, label: string, value: string, key?: string } の形。
-- keyは生後日数の計算やホーム画面のクイック発信など、特定機能から値を参照するための
-- 予約識別子で、アプリの初期データ(INITIAL_PROFILE)で付与される項目にのみ設定される。

alter table public.family_profiles
  add column if not exists child_fields jsonb not null default '[]'::jsonb,
  add column if not exists family_fields jsonb not null default '[]'::jsonb,
  add column if not exists emergency_fields jsonb not null default '[]'::jsonb;

-- 既存の固定カラムのデータを新しいjsonb構造へ移行する（未移行の行のみ対象、冪等）
update public.family_profiles set
  child_fields = jsonb_build_array(
    jsonb_build_object('id', 'baby-name', 'label', 'お名前', 'value', coalesce(baby_name, ''), 'key', 'babyName'),
    jsonb_build_object('id', 'birth-date', 'label', 'お誕生日', 'value', coalesce(birth_date::text, ''), 'key', 'birthDate')
  ),
  family_fields = jsonb_build_array(
    jsonb_build_object('id', 'mom-name', 'label', 'ママのお名前', 'value', coalesce(mom_name, '')),
    jsonb_build_object('id', 'mom-workplace', 'label', 'ママの勤務先', 'value', coalesce(mom_workplace, '')),
    jsonb_build_object('id', 'dad-name', 'label', 'パパのお名前', 'value', coalesce(dad_name, '')),
    jsonb_build_object('id', 'dad-workplace', 'label', 'パパの勤務先', 'value', coalesce(dad_workplace, '')),
    jsonb_build_object('id', 'address', 'label', 'ご住所', 'value', coalesce(address, ''))
  ),
  emergency_fields = jsonb_build_array(
    jsonb_build_object('id', 'hospital-name', 'label', '産院名', 'value', coalesce(hospital_name, '')),
    jsonb_build_object('id', 'hospital-phone', 'label', '産院 電話番号', 'value', coalesce(hospital_phone, ''), 'key', 'hospitalPhone'),
    jsonb_build_object('id', 'pediatric-name', 'label', '小児科名', 'value', coalesce(pediatric_name, '')),
    jsonb_build_object('id', 'pediatric-phone', 'label', '小児科 電話番号', 'value', coalesce(pediatric_phone, ''), 'key', 'pediatricPhone'),
    jsonb_build_object('id', 'papa-company-phone', 'label', 'パパ会社 電話番号', 'value', coalesce(papa_company_phone, ''), 'key', 'papaCompanyPhone'),
    jsonb_build_object('id', 'papa-contact-phone', 'label', 'パパ連絡先（携帯）', 'value', coalesce(papa_contact_phone, ''), 'key', 'papaContactPhone'),
    jsonb_build_object('id', 'mama-company-phone', 'label', 'ママ会社 電話番号', 'value', coalesce(mama_company_phone, ''), 'key', 'mamaCompanyPhone'),
    jsonb_build_object('id', 'mama-contact-phone', 'label', 'ママ連絡先（携帯）', 'value', coalesce(mama_contact_phone, ''), 'key', 'mamaContactPhone')
  )
where child_fields = '[]'::jsonb;

-- アプリ側は新カラムのみを読み書きするため、旧固定カラムを削除する
alter table public.family_profiles
  drop column baby_name,
  drop column birth_date,
  drop column mom_name,
  drop column mom_workplace,
  drop column dad_name,
  drop column dad_workplace,
  drop column address,
  drop column hospital_name,
  drop column hospital_phone,
  drop column pediatric_name,
  drop column pediatric_phone,
  drop column papa_company_phone,
  drop column papa_contact_phone,
  drop column mama_company_phone,
  drop column mama_contact_phone;
