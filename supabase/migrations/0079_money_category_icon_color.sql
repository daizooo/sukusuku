-- かぞく手帳: 種類（大分類）のアイコンの色を選べるようにする（docs/kakei.md §2.1・§3.1）
--
-- icon_color は '#rrggbb'。null は「標準」で、アイコンごとに決まっている色（moneyUtils の MONEY_ICONS）を使う。
-- 列を足すだけで、削除は含まない。古いアプリは列を知らないだけで、そのまま動く。

alter table public.money_categories
  add column if not exists icon_color text
    check (icon_color is null or icon_color ~ '^#[0-9a-f]{6}$');

comment on column public.money_categories.icon_color is
  '種類のアイコンの色（#rrggbb）。null は標準（アイコンごとの色）。docs/kakei.md §3.1。';
