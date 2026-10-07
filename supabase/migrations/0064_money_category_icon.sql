-- かぞく手帳: 家計の種類のアイコン（docs/kakei.md §3.1）
--
-- 種類ごとにアイコンを選べるようにする（Zaim と同じく種類ごとに絵と色）。
-- 値はアプリの MONEY_ICONS の key（'food'・'home' など）。色はアイコンごとにアプリで決める。
-- null は「名前から近いものを選ぶ」（アプリの guessIconKey）。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 列を足すだけ。古いアプリは読まないだけで、今までどおり動く

alter table public.money_categories
  add column if not exists icon text check (icon is null or char_length(icon) <= 40);

comment on column public.money_categories.icon is
  '種類のアイコン（アプリの MONEY_ICONS の key）。null は名前から選ぶ。docs/kakei.md §3.1。';
