-- かぞく手帳: 福引チャンスの補助額を、家計に自動で記録する（docs/home.md §9.10）
--
-- 福引（subsidy_draws）が確定した（記録された）時点で、家計に支出を1件作る。
--   種類   : 大分類「その他」の小分類「お小遣い・補助」（無ければ「お小遣い」）
--   金額   : 補助額（subsidy）。補助率アップ券で補助額が変わったら、その記録の金額も合わせる
--   出金元 : 家族の最初の現金の出金元（使っているもの。家族の財布）。無ければ出金元なし
--   日付   : 引いた日（日本時間）
-- 記録しないもの:
--   - テストモードのくじ（is_test）。家族のお金に出さない約束（§9.6）
--   - 補助率100%。全額を家族のお金で買うので、買い物そのものが通常の記録（口座の取り込み・レシート）で入る。
--     ここでも作ると二重に数える
-- 種類が見つからないときは、記録を作らずに終わる（くじそのものは失敗させない）。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリを出す（アプリの変更は無い。古いアプリでも動く）

alter table public.money_records
  add column if not exists draw_id uuid references public.subsidy_draws (id);

comment on column public.money_records.draw_id is
  '福引チャンスの補助額から作った記録のとき、そのくじ（subsidy_draws）。1つのくじにつき記録は1件。docs/home.md §9.10。';

create unique index if not exists idx_money_records_draw_id
  on public.money_records (draw_id) where draw_id is not null;

-- ---------------------------------------------------------------------------
-- くじが記録されたら、補助額を家計に記録する
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_draws_to_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category uuid;
  v_wallet uuid;
  v_record uuid;
begin
  if new.is_test or new.rate >= 100 or new.subsidy <= 0 then
    return null;
  end if;

  select c.id into v_category
    from public.money_categories c
    join public.money_categories p on p.id = c.parent_id and p.family_id = c.family_id
   where c.family_id = new.family_id
     and p.name = 'その他'
     and c.name in ('お小遣い・補助', 'お小遣い')
   order by (c.name = 'お小遣い・補助') desc, c.position
   limit 1;
  if v_category is null then
    return null;
  end if;

  select w.id into v_wallet
    from public.money_wallets w
   where w.family_id = new.family_id and w.type = 'cash' and w.archived_at is null
   order by w.position
   limit 1;

  insert into public.money_records (family_id, kind, occurred_on, wallet_id, store, created_by, draw_id)
  values (
    new.family_id,
    'expense',
    (new.drawn_at at time zone 'Asia/Tokyo')::date,
    v_wallet,
    '福引チャンス',
    new.drawn_by,
    new.id
  )
  returning id into v_record;

  insert into public.money_items (family_id, record_id, amount, category_id, quantity, name, memo, position)
  values (
    new.family_id,
    v_record,
    new.subsidy,
    v_category,
    1,
    coalesce(nullif(btrim(new.item_name), ''), '福引の補助'),
    '福引チャンス 補助率' || new.rate || '%（税込' || new.price || '円）',
    0
  );
  return null;
end;
$fn$;

drop trigger if exists subsidy_draws_to_money on public.subsidy_draws;
create trigger subsidy_draws_to_money
  after insert on public.subsidy_draws
  for each row execute function public.subsidy_draws_to_money();

-- ---------------------------------------------------------------------------
-- 補助額が変わったら（補助率アップ券）、記録の金額も合わせる
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_draws_to_money_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.money_items i
     set amount = new.subsidy,
         memo = '福引チャンス 補助率' || new.rate || '%（税込' || new.price || '円）'
    from public.money_records r
   where r.draw_id = new.id
     and i.record_id = r.id
     and i.family_id = r.family_id
     and (select count(*) from public.money_items x where x.record_id = r.id) = 1;
  return null;
end;
$fn$;

drop trigger if exists subsidy_draws_to_money_update on public.subsidy_draws;
create trigger subsidy_draws_to_money_update
  after update of subsidy on public.subsidy_draws
  for each row when (old.subsidy is distinct from new.subsidy)
  execute function public.subsidy_draws_to_money_update();

revoke execute on function public.subsidy_draws_to_money() from public, anon, authenticated;
revoke execute on function public.subsidy_draws_to_money_update() from public, anon, authenticated;
