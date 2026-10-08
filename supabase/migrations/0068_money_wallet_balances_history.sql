-- かぞく手帳: 残高の補正を、履歴に残すかどうか選べるようにする（docs/kakei.md §9.3）
--
-- 補正のたびに「履歴に残す」か「残さない」かを選ぶ。残さない補正も、残高の土台としては同じに効く
-- （最後に補正した残高 + その後の記録）。口座の履歴の行だけ出さない。
-- 既存の補正は、これまでどおり履歴に出す（true）。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは列を読まないだけで、今までどおり動く（補正は常に履歴に出る）

alter table public.money_wallet_balances
  add column if not exists show_in_history boolean not null default true;

comment on column public.money_wallet_balances.show_in_history is
  '補正を口座の履歴に行として出すか。false でも残高の土台としては同じに効く。';
