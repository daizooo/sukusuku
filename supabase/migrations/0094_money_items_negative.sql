-- かぞく手帳: 品目の金額にマイナスを許す（値引き・割引・返金。docs/kakei.md §10.5）
--
-- 品目（money_items）の金額・単価の「0以上」の制約を外す。代わりに、1件の記録の合計（品目の和）が
-- 0以上であることを、記録の保存が終わった時点（トランザクションの終わり）で確かめる。
-- save_money_record は品目を消して入れ直すので、行ごとではなく、遅らせた制約トリガで見る。
--
-- 流し方（CLAUDE.md「本番DBへの migration の適用」）:
--   1. 〔MCPで適用〕記録の合計を確かめる関数とトリガ（追加だけ）
--   2. 〔SQL Editor で流す〕金額・単価の制約を外す（drop を含む）
--   アプリ（PWA・mobile）は 2 まで適用してから出す（2 の前にマイナスの品目を保存すると、保存に失敗する）

-- 1. 追加だけ -----------------------------------------------------------------

create or replace function public.money_items_check_record_total()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_record uuid := coalesce(new.record_id, old.record_id);
  v_total bigint;
begin
  select sum(amount) into v_total from public.money_items where record_id = v_record;
  if v_total is not null and v_total < 0 then
    raise exception 'the total of a record must not be negative';
  end if;
  return null;
end;
$function$;

drop trigger if exists money_items_check_record_total on public.money_items;
create constraint trigger money_items_check_record_total
  after insert or update on public.money_items
  deferrable initially deferred
  for each row
  execute function public.money_items_check_record_total();

-- 2. SQL Editor で流す（drop を含む） -------------------------------------------

alter table public.money_items drop constraint if exists money_items_amount_check;
alter table public.money_items drop constraint if exists money_items_unit_price_check;
