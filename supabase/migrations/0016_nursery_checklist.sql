-- 保育園見学のチェックリストを保育園ごとに持たせる
--
-- 見学時に確認したい項目は全園で共通のため、項目そのもの（見出し・確認点）は
-- アプリ側の定義 (src/lib/nurseryChecklist.ts) に置き、DBには
-- 「その園でどの項目をチェックしたか」「項目ごとのメモ」だけを保存する。
--
-- 項目ごとに列や行を足すと項目の増減のたびにスキーマ変更が必要になるため、
-- nurseries.checklist (jsonb) に項目IDをキーとしてまとめて入れる。
--
--   { "diaper": { "checked": true, "memo": "サブスクあり" }, ... }
--
-- 既存の保育園は checklist が空のまま残る（未チェック扱い）。

alter table public.nurseries
  add column if not exists checklist jsonb not null default '{}'::jsonb;

comment on column public.nurseries.checklist is
  '見学チェックリストの状態。項目IDをキーに { checked: boolean, memo: text } を持つ';
