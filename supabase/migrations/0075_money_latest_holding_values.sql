-- 家計タブ「口座」の一覧を速く出すための関数（docs/kakei.md §9.2）。
--
-- 口座の残高に要るのは、保有ごとの今日（日本時間）以前で最新の評価額の1行だけ。
-- money_holding_values は保有ごとに1日1行（1年で数千行）あり、全部を読むと往復が増えて遅いので、
-- 一覧用にはこの関数で保有ごとの最新の1行だけ読み、履歴（推移）は開いたときに読む。
--
-- 使わなくした保有は、その日から評価額 0 の行が入る（money_holdings_refresh_today）ので、
-- 最新の行がそのまま「今の評価額」になる。
--
-- 適用の順序: これを適用してから、アプリ（PWA・mobile）を出す。削除を含まない。

create or replace function public.money_latest_holding_values(p_family_id uuid)
returns setof public.money_holding_values
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (holding_id) *
    from public.money_holding_values
   where family_id = p_family_id
     and value_on <= (now() at time zone 'Asia/Tokyo')::date
   order by holding_id, value_on desc;
$$;

comment on function public.money_latest_holding_values(uuid) is
  '保有ごとの、今日（日本時間）以前で最新の評価額の1行。口座の一覧用（履歴は全件読まない）。呼ぶ人の権限（RLS）で読む。docs/kakei.md §9.2。';

revoke execute on function public.money_latest_holding_values(uuid) from public, anon;
grant execute on function public.money_latest_holding_values(uuid) to authenticated;
