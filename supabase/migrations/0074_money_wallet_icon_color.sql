-- かぞく手帳: 出金元（口座）のアイコンの色を選べるようにする（docs/kakei.md §3.2）
--
-- icon_color は '#rrggbb'。null は「標準」で、種類（財布・カード・口座…）ごとの色を使う。
-- 列を足すだけで、削除は含まない。古いアプリは列を知らないだけで、そのまま動く。

alter table public.money_wallets
  add column if not exists icon_color text
    check (icon_color is null or icon_color ~ '^#[0-9a-f]{6}$');
