-- かぞく手帳: 出金元の種類に「証券口座」を足す（docs/kakei.md §9.2）
--
-- 証券口座（type = 'securities'）の残高は、記録からではなく、保有銘柄の評価額で数える（0071）。
-- check の作り直しは drop を含むので、MCP ではなく SQL Editor で流す（CLAUDE.md）。
-- 1つの文で作り直すので、途中で check が無くなる時間は無い。
--
-- 適用の順序: これと 0071 を適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは証券口座を知らないので、種類の分からない出金元として扱う

alter table public.money_wallets
  drop constraint if exists money_wallets_type_check,
  add constraint money_wallets_type_check
    check (type in ('card', 'cash', 'bank', 'prepaid', 'qr', 'securities'));
