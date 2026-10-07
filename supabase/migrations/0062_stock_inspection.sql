-- かぞく手帳: 防災備蓄の点検（暮らしタブの画面の作り直し。docs/home.md §10.2）
--
-- 値段は持たない（2026-10-07に決定。数年おきの買い物で、金額は当てにならないため。§10.2.1）
--
-- 1. inspected_on: 最後に点検した日（動作・中身を確かめた日）。未点検は null
-- 2. inspect_interval_months: 点検の間隔（月）。null は点検しない。
--    期限の無い備品（ラジオ・ランタン・ポータブル電源など）が対象で、間隔を過ぎると画面の「要対応」に出る
--    （通知は出さない）。点検日が未入力のものは、追加した日（created_at）から数える
--
-- 既存の「期限が無く、必要数に数えていない」ロット（備品。衛生用品なども含む）には、間隔6か月を入れる。
-- 点検が要らないものは、画面で「点検しない」にする。必要数に数えるロット（水の給水用バッグなど）と
-- 期限のあるロットは触らない
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは足した列を読まないだけ。点検は空のまま、今までどおり動く

alter table public.stock_items
  add column if not exists inspected_on date;

comment on column public.stock_items.inspected_on is
  '最後に点検した日。未点検は null（その場合は created_at から数える）。docs/home.md §10.2。';

alter table public.stock_items
  add column if not exists inspect_interval_months smallint
    check (inspect_interval_months is null or inspect_interval_months between 1 and 60);

comment on column public.stock_items.inspect_interval_months is
  '点検の間隔（月）。null は点検しない。期限の無い備品が対象。docs/home.md §10.2。';

update public.stock_items
  set inspect_interval_months = 6
  where expires_on is null
    and target_id is null
    and inspect_interval_months is null;
