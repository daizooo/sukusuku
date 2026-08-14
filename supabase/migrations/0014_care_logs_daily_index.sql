-- 育児記録の日別表示用インデックス
--
-- 記録タブは「家族 + 表示中の日の 0:00〜翌0:00」で care_logs を絞り込み、
-- logged_at の降順で並べる。family_id 単独のインデックス(0004)では
-- 家族の全記録を読んでからソートすることになるため、複合インデックスを張る。

create index if not exists idx_care_logs_family_logged_at
  on public.care_logs (family_id, logged_at desc);
