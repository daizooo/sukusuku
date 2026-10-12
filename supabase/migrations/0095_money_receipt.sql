-- かぞく手帳: レシートの読み取り（docs/kakei.md §10）
--
--   money_items.receipt_name    レシートに印字された品名そのまま（手入力の品目は null）。§10.3
--   money_records.receipt_store レシートに印字された店名そのまま（手入力の記録は null）。§10.3
--   money_receipt_scans         読み取った回数（家族ごとに月200枚までの歯止め。§10.1）。Edge Function だけが書く
--
-- 次に同じ表記が来たら、過去の品目・記録を表記で引き、直したあとの品名・種類・お店を入れる（Edge Function money-receipt-scan）。
--
-- 流し方（CLAUDE.md「本番DBへの migration の適用」）:
--   1. 〔MCPで適用〕列・索引・表（追加だけ）
--   2. 〔SQL Editor で流す〕save_money_record（本体に delete を含む）。表記の列を保存するようにする
--   アプリ（PWA・mobile）は 2 まで適用してから出す（2 の前は表記が保存されないだけで、記録は今までどおり保存できる）

-- 1. 追加だけ -----------------------------------------------------------------

alter table public.money_items
  add column if not exists receipt_name text;
alter table public.money_records
  add column if not exists receipt_store text;

comment on column public.money_items.receipt_name is
  'レシートに印字された品名そのまま（読み取りで入れた品目だけ）。次の読み取りの手本にする。docs/kakei.md §10.3';
comment on column public.money_records.receipt_store is
  'レシートに印字された店名そのまま（読み取りで入れた記録だけ）。次の読み取りの手本にする。docs/kakei.md §10.3';

create index if not exists idx_money_items_family_receipt_name
  on public.money_items (family_id, receipt_name)
  where receipt_name is not null;
create index if not exists idx_money_records_family_receipt_store
  on public.money_records (family_id, receipt_store)
  where receipt_store is not null;

create table if not exists public.money_receipt_scans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  -- 1回の読み取りで送った写真の枚数
  images integer not null default 1 check (images >= 1),
  created_at timestamptz not null default now()
);

comment on table public.money_receipt_scans is
  'レシートの読み取りの回数。家族ごとに月200枚までの歯止めに使う（Edge Function money-receipt-scan だけが書く）。docs/kakei.md §10.1';

create index if not exists idx_money_receipt_scans_family_created
  on public.money_receipt_scans (family_id, created_at);

-- アプリからは読み書きしない（ポリシーを置かない＝service role だけ）。
alter table public.money_receipt_scans enable row level security;

select public.attach_family_sync('public.money_receipt_scans');

-- 2. SQL Editor で流す（本体に delete を含む） -----------------------------------

-- save_money_record（0090 から、記録に receipt_store、品目に receipt_name を足した）
create or replace function public.save_money_record(p_record jsonb, p_items jsonb)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_family uuid := public.current_family_id();
  v_id uuid := nullif(p_record ->> 'id', '')::uuid;
  v_store text := btrim(coalesce(p_record ->> 'store', ''));
  v_estimate boolean := coalesce((p_record ->> 'is_estimate')::boolean, false);
  v_register boolean := coalesce((p_record ->> 'register_store')::boolean, false);
  v_receipt_store text := nullif(btrim(coalesce(p_record ->> 'receipt_store', '')), '');
begin
  if v_family is null then
    raise exception 'no family';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a record needs at least one item';
  end if;

  if v_id is null then
    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, created_by, is_estimate, receipt_store)
    values (
      v_family,
      p_record ->> 'kind',
      (p_record ->> 'occurred_on')::date,
      nullif(p_record ->> 'wallet_id', '')::uuid,
      nullif(p_record ->> 'to_wallet_id', '')::uuid,
      coalesce(p_record ->> 'store', ''),
      (select auth.uid()),
      v_estimate,
      v_receipt_store
    )
    returning id into v_id;
  else
    -- 表記は、読み取りで入れた記録を直すときにも残す（送られてこなければ今のまま）。
    update public.money_records
      set kind = p_record ->> 'kind',
          occurred_on = (p_record ->> 'occurred_on')::date,
          wallet_id = nullif(p_record ->> 'wallet_id', '')::uuid,
          to_wallet_id = nullif(p_record ->> 'to_wallet_id', '')::uuid,
          store = coalesce(p_record ->> 'store', ''),
          is_estimate = v_estimate,
          receipt_store = coalesce(v_receipt_store, receipt_store)
      where id = v_id;
    if not found then
      raise exception 'record not found';
    end if;
    delete from public.money_items where record_id = v_id;
  end if;

  -- 「お店に登録して使う」を選んだときだけ、お店の設定に登録する（使わなくしていれば、また使えるようにする）。
  if v_store <> '' and v_register then
    insert into public.money_stores (family_id, name)
    values (v_family, v_store)
    on conflict (family_id, name) do update set archived_at = null;
  end if;

  insert into public.money_items (
    family_id, record_id, amount, category_id, category_name,
    quantity, unit_price, name, memo, position, receipt_name
  )
  select
    v_family,
    v_id,
    (item ->> 'amount')::integer,
    nullif(item ->> 'category_id', '')::uuid,
    -- 削除したカテゴリの名前。カテゴリを選んでいる品目では持たない。
    case when nullif(item ->> 'category_id', '') is null then coalesce(item ->> 'category_name', '') else '' end,
    coalesce((item ->> 'quantity')::integer, 1),
    (item ->> 'unit_price')::integer,
    coalesce(item ->> 'name', ''),
    coalesce(item ->> 'memo', ''),
    (ordinality - 1)::integer,
    nullif(btrim(coalesce(item ->> 'receipt_name', '')), '')
  from jsonb_array_elements(p_items) with ordinality as entries (item, ordinality);

  return v_id;
end;
$function$;
