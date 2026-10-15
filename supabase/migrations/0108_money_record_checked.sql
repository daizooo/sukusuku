-- かぞく手帳: 月の締めで、記録ごとに「確かめた」チェックを付ける（docs/kakei.md §4.5）
--
-- 月の締めの画面は、その月の記録を一覧にし、各記録にチェックボックスを出す。すべてチェックがついたら締められる。
--   - money_records に checked_at（timestamptz。null は未チェック）を足す。人が記録を直したときは、アプリが null に戻す
--   - 夫婦で同じチェックを見られるよう、記録の列として持つ（money_bootstrap は to_jsonb(rec) なので、関数は変えない）
--   - money_records は family_sync の対象のまま（列を足すだけで、トリガーは変わらない）
--   - 削除は含まない
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。古いアプリは新しい列を読まないだけ。

alter table public.money_records
  add column if not exists checked_at timestamptz;

comment on column public.money_records.checked_at is
  '月の締めで確かめた日時。null は未チェック。記録を直すとアプリが null に戻す（docs/kakei.md §4.5）。';
