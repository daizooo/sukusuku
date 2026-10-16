-- かぞく手帳: Amazon の注文メールの品目を覚え、カードの利用通知に割り振って記録にする（docs/kakei.md §9.7）
--
-- Amazon は発送した日にカードへ請求が立つので、メールは「注文メール → カードの利用通知」の順に届く。1回の注文でも
-- 発送が分かれると利用通知は何通かに分かれる。注文メールの品目（品名・個数・単価）を覚えておき、利用通知が届いたら
-- 請求額に合う品目を割り振って、品目つきの記録にする（残りの品目は次の利用通知に割り振る）。
--   - money_amazon_orders / money_amazon_lines: 注文と、その品目（まだ割り振っていない品目は feed_id が null）。
--     アプリからは読み書きしない（ポリシーを置かない＝service role だけ）。家族の同期には付ける（0078・0095 と同じ）
--   - money_feed に amazon_order_id・amazon_line_ids・amazon_with_adjust: Edge Function が決めた割り振り
--   - money_amazon_order_receive: 注文メールの注文を覚える（同じ注文番号は1回だけ）
--   - money_feed_amazon_create: 割り振りどおりの記録を作る（品目がまだ空いていて、額が合うときだけ）
--   - money_feed_receive: 割り振りを受け取る
--   - money_feed_process: 手入力との確認のあと、ルールで自動の記録を作る前に、割り振りがあれば品目つきの記録にする。ほかは 0107 と同じ
--   - 削除を含む文は無い（全部 MCP で適用してよい）

-- 1. 表 ----------------------------------------------------------------------

create table if not exists public.money_amazon_orders (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  order_no text not null,
  -- 注文メールの Gmail のメッセージID（1通に注文が何件か入る）
  source_id text not null,
  ordered_on date not null,
  -- メールの「合計」（値引き後の請求額）
  total integer not null check (total > 0),
  -- 合計 − 品目の和（値引きはマイナス・送料などはプラス）。どれかの請求に含めたら adjust_feed_id を入れる
  adjust integer not null default 0,
  adjust_feed_id uuid,
  created_at timestamptz not null default now(),
  constraint money_amazon_orders_no_key unique (family_id, order_no),
  constraint money_amazon_orders_id_family_key unique (id, family_id),
  constraint money_amazon_orders_adjust_feed_fkey foreign key (adjust_feed_id, family_id)
    references public.money_feed (id, family_id) on delete set null (adjust_feed_id)
);

comment on table public.money_amazon_orders is
  'Amazon の注文メールから覚えた注文。カードの利用通知（money_feed）に品目を割り振る。Edge Function money-feed-ingest だけが書く。docs/kakei.md §9.7';

create table if not exists public.money_amazon_lines (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  order_id uuid not null,
  position integer not null default 0,
  -- メールの品名そのまま（次の手本になる money_items.receipt_name に入れる）と、記録に付ける短い品名
  receipt_name text not null,
  name text not null default '',
  quantity integer not null default 1 check (quantity >= 1 and quantity <= 9999),
  unit_price integer not null check (unit_price >= 0),
  -- 個数 × 単価
  amount integer not null check (amount >= 0),
  -- 覚えておいた種類（過去の同じ品名 → AI）。決まらなければ null
  category_id uuid,
  -- どの利用通知の記録に割り振ったか。null ならまだ
  feed_id uuid,
  created_at timestamptz not null default now(),
  constraint money_amazon_lines_order_fkey foreign key (order_id, family_id)
    references public.money_amazon_orders (id, family_id) on delete cascade,
  constraint money_amazon_lines_category_fkey foreign key (category_id, family_id)
    references public.money_categories (id, family_id) on delete set null (category_id),
  constraint money_amazon_lines_feed_fkey foreign key (feed_id, family_id)
    references public.money_feed (id, family_id) on delete set null (feed_id)
);

comment on table public.money_amazon_lines is
  'Amazon の注文の品目。feed_id が null のものが、まだ記録に割り振っていない品目。docs/kakei.md §9.7';

create index if not exists idx_money_amazon_orders_family_ordered on public.money_amazon_orders (family_id, ordered_on);
create index if not exists idx_money_amazon_orders_adjust_feed_id on public.money_amazon_orders (adjust_feed_id);
create index if not exists idx_money_amazon_lines_order_id on public.money_amazon_lines (order_id);
create index if not exists idx_money_amazon_lines_family_open on public.money_amazon_lines (family_id) where feed_id is null;
create index if not exists idx_money_amazon_lines_feed_id on public.money_amazon_lines (feed_id);
create index if not exists idx_money_amazon_lines_category_id on public.money_amazon_lines (category_id);

-- アプリからは読み書きしない（ポリシーを置かない＝service role だけ）
alter table public.money_amazon_orders enable row level security;
alter table public.money_amazon_lines enable row level security;

select public.attach_family_sync('public.money_amazon_orders');
select public.attach_family_sync('public.money_amazon_lines');

alter table public.money_feed add column if not exists amazon_order_id uuid;
alter table public.money_feed add column if not exists amazon_line_ids uuid[] not null default '{}';
alter table public.money_feed add column if not exists amazon_with_adjust boolean not null default false;

comment on column public.money_feed.amazon_line_ids is
  'Edge Function が、Amazon の注文メールの品目からこの利用通知に割り振ると決めた品目（money_amazon_lines）。docs/kakei.md §9.7';

-- 2. 注文を覚える -------------------------------------------------------------
--   p_order: { order_no, source_id, received_at, ordered_on, total, adjust,
--              lines: [{ receipt_name, name, quantity, unit_price, amount, category_id }] }
create or replace function public.money_amazon_order_receive(p_family uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_start timestamptz;
begin
  select start_at into v_start from public.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_order ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into public.money_amazon_orders (family_id, order_no, source_id, ordered_on, total, adjust)
  values (p_family, p_order ->> 'order_no', p_order ->> 'source_id', (p_order ->> 'ordered_on')::date,
          (p_order ->> 'total')::integer, coalesce((p_order ->> 'adjust')::integer, 0))
  on conflict (family_id, order_no) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.money_amazon_lines (family_id, order_id, position, receipt_name, name, quantity, unit_price, amount, category_id)
  select p_family, v_id, (entries.ordinality - 1)::integer,
         entries.item ->> 'receipt_name', coalesce(entries.item ->> 'name', ''),
         coalesce((entries.item ->> 'quantity')::integer, 1), (entries.item ->> 'unit_price')::integer,
         (entries.item ->> 'amount')::integer,
         (select c.id from public.money_categories c
           where c.family_id = p_family and c.id = nullif(entries.item ->> 'category_id', '')::uuid)
    from jsonb_array_elements(p_order -> 'lines') with ordinality as entries (item, ordinality);

  return jsonb_build_object('status', 'saved', 'id', v_id);
end;
$function$;

revoke execute on function public.money_amazon_order_receive(uuid, jsonb) from public, anon, authenticated;

-- 3. 割り振りどおりの記録を作る -------------------------------------------------
-- 割り振った品目がまだ全部空いていて、額（品目の和 + 値引き・送料などの差）が明細の額と合うときだけ作る。作れなければ null
create or replace function public.money_feed_amazon_create(p_feed uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f public.money_feed;
  o public.money_amazon_orders;
  v_count integer;
  v_sum integer;
  v_adjust integer := 0;
  v_top uuid;
  v_record uuid;
begin
  select * into f from public.money_feed where id = p_feed for update;
  if not found or f.wallet_id is null or f.amazon_order_id is null then
    return null;
  end if;
  select * into o from public.money_amazon_orders where id = f.amazon_order_id and family_id = f.family_id for update;
  if not found then
    return null;
  end if;

  select count(*), coalesce(sum(amount), 0) into v_count, v_sum from public.money_amazon_lines
   where family_id = f.family_id and order_id = o.id and id = any (f.amazon_line_ids) and feed_id is null;
  if v_count = 0 or v_count <> array_length(f.amazon_line_ids, 1) then
    return null;
  end if;
  if f.amazon_with_adjust then
    if o.adjust_feed_id is not null then
      return null;
    end if;
    v_adjust := o.adjust;
  end if;
  if v_sum + v_adjust <> f.amount then
    return null;
  end if;

  insert into public.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id)
  values (f.family_id, 'expense', f.occurred_on, f.wallet_id, coalesce(nullif(btrim(f.store_hint), ''), 'Amazon'), f.id)
  returning id into v_record;

  insert into public.money_items (family_id, record_id, amount, category_id, quantity, unit_price, name, receipt_name, position)
  select f.family_id, v_record, l.amount, l.category_id, l.quantity, l.unit_price, l.name, l.receipt_name, l.position
    from public.money_amazon_lines l
   where l.family_id = f.family_id and l.id = any (f.amazon_line_ids)
   order by l.position;

  -- 値引き・送料などの差は、いちばん金額の大きい品目と同じ種類の1行にする（レシートの小計の値引きと同じ。docs/kakei.md §10.5）
  if v_adjust <> 0 then
    select l.category_id into v_top from public.money_amazon_lines l
     where l.family_id = f.family_id and l.id = any (f.amazon_line_ids)
     order by l.amount desc, l.position
     limit 1;
    insert into public.money_items (family_id, record_id, amount, category_id, quantity, unit_price, name, position)
    values (f.family_id, v_record, v_adjust, v_top, 1, v_adjust,
            case when v_adjust < 0 then '値引き・クーポン' else '送料など' end, 1000);
    update public.money_amazon_orders set adjust_feed_id = f.id where id = o.id;
  end if;

  update public.money_amazon_lines set feed_id = f.id
   where family_id = f.family_id and id = any (f.amazon_line_ids);
  update public.money_feed set status = 'created', record_id = v_record, candidate_record_ids = '{}' where id = f.id;
  return v_record;
end;
$function$;

revoke execute on function public.money_feed_amazon_create(uuid) from public, anon, authenticated;

-- 4. money_feed_receive（0105 に、割り振りを受け取る列を足した） ---------------------
create or replace function public.money_feed_receive(p_family uuid, p_feed jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_status text;
  v_start timestamptz;
  v_source text := coalesce(p_feed ->> 'source', 'zaim_mail');
begin
  select start_at into v_start from public.money_feed_settings where family_id = p_family;
  if v_start is not null and (p_feed ->> 'received_at')::timestamptz < v_start then
    return jsonb_build_object('status', 'before_start');
  end if;

  insert into public.money_feed (family_id, source, source_id, received_at, to_email, subject, raw_line,
                                 direction, occurred_on, amount, account_name, description, store_hint,
                                 amazon_order_id, amazon_line_ids, amazon_with_adjust, status)
  values (p_family, v_source, p_feed ->> 'source_id', (p_feed ->> 'received_at')::timestamptz,
          nullif(p_feed ->> 'to_email', ''), coalesce(p_feed ->> 'subject', ''), coalesce(p_feed ->> 'raw_line', ''),
          p_feed ->> 'direction', (p_feed ->> 'occurred_on')::date, (p_feed ->> 'amount')::integer,
          p_feed ->> 'account_name', coalesce(p_feed ->> 'description', ''), nullif(btrim(p_feed ->> 'store_hint'), ''),
          nullif(p_feed ->> 'amazon_order_id', '')::uuid,
          coalesce(array(select x::uuid from jsonb_array_elements_text(p_feed -> 'amazon_line_ids') as t(x)), '{}'::uuid[]),
          coalesce((p_feed ->> 'amazon_with_adjust')::boolean, false),
          case when p_feed ->> 'direction' is null then 'unreadable' else 'pending' end)
  on conflict (family_id, source, source_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id, status into v_id, v_status from public.money_feed
     where family_id = p_family and source = v_source and source_id = p_feed ->> 'source_id';
    return jsonb_build_object('id', v_id, 'status', v_status, 'duplicate', true);
  end if;

  v_status := public.money_feed_process(v_id);
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$function$;

-- 5. money_feed_process（0107 に、Amazon の割り振りで記録を作る分岐を足した） ----------
create or replace function public.money_feed_process(p_feed uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f public.money_feed;
  s public.money_feed_settings;
  v_wallets uuid[];
  v_requester text;
  v_pairs uuid[];
  g public.money_feed;
  v_out public.money_feed;
  v_in public.money_feed;
  v_cands uuid[];
  r public.money_feed_rules;
  v_record uuid;
  v_kind text;
begin
  select * into f from public.money_feed where id = p_feed for update;
  if not found or f.status not in ('pending') or f.direction is null then
    return coalesce(f.status, 'missing');
  end if;
  select * into s from public.money_feed_settings where family_id = f.family_id;
  if not found then
    insert into public.money_feed_settings (family_id) values (f.family_id) returning * into s;
  end if;

  if f.wallet_id is null then
    select array_agg(id) into v_wallets from public.money_wallets
     where family_id = f.family_id and archived_at is null and feed_name = f.account_name
       and (holder_zaim_email is null or f.to_email is null or lower(holder_zaim_email) = lower(f.to_email));
    if coalesce(array_length(v_wallets, 1), 0) > 1 then
      v_requester := public.money_feed_requester(f.description);
      if v_requester is not null then
        select array_agg(id) into v_wallets from public.money_wallets
         where id = any (v_wallets)
           and regexp_replace(normalize(coalesce(holder_kana, ''), NFKC), '\s+', ' ', 'g') = v_requester;
      end if;
    end if;
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      select array_agg(distinct fr.wallet_id) into v_wallets from public.money_feed_rules fr
       join public.money_wallets w on w.id = fr.wallet_id
       where fr.family_id = f.family_id and fr.match = 'key' and fr.wallet_id is not null
         and w.feed_name = f.account_name
         and (fr.direction is null or fr.direction = f.direction)
         and fr.pattern = public.money_feed_key(f.description);
    end if;
    if coalesce(array_length(v_wallets, 1), 0) <> 1 then
      return 'pending';
    end if;
    f.wallet_id := v_wallets[1];
    update public.money_feed set wallet_id = f.wallet_id where id = f.id;
  end if;

  -- 振替の組み合わせは Zaim の明細どうしだけ（カードの利用通知は組にしない。docs/kakei.md §9.6）
  select array_agg(id) into v_pairs from public.money_feed
   where family_id = f.family_id and id <> f.id and status in ('pending', 'confirm') and pair_id is null
     and f.source = 'zaim_mail' and source = 'zaim_mail'
     and direction is not null and direction <> f.direction and amount = f.amount
     and wallet_id is not null and wallet_id <> f.wallet_id
     and abs(occurred_on - f.occurred_on) <= s.pair_days;
  if coalesce(array_length(v_pairs, 1), 0) = 1 then
    select * into g from public.money_feed where id = v_pairs[1] for update;
    if f.direction = 'out' then v_out := f; v_in := g; else v_out := g; v_in := f; end if;
    update public.money_feed set pair_id = g.id where id = f.id;
    update public.money_feed set pair_id = f.id where id = g.id;

    select array_agg(rec.id) into v_cands from public.money_records rec
     where rec.family_id = f.family_id and rec.feed_id is null and rec.month is null
       and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
       and abs(rec.occurred_on - v_out.occurred_on) <= s.manual_days
       and public.money_record_amount(rec.id) = f.amount
       and ((rec.kind = 'transfer' and rec.wallet_id = v_out.wallet_id and rec.to_wallet_id = v_in.wallet_id)
            or (rec.kind = 'expense' and rec.wallet_id = v_out.wallet_id)
            or (rec.kind = 'income' and rec.wallet_id = v_in.wallet_id));
    if v_cands is not null and not (f.skip_manual or g.skip_manual) then
      update public.money_feed set status = 'confirm', candidate_record_ids = v_cands where id in (f.id, g.id);
      return 'confirm';
    end if;

    insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id)
    values (f.family_id, 'transfer', v_out.occurred_on, v_out.wallet_id, v_in.wallet_id, '', v_out.id)
    returning id into v_record;
    insert into public.money_items (family_id, record_id, amount) values (f.family_id, v_record, f.amount);
    update public.money_feed set status = 'created', record_id = v_record where id in (f.id, g.id);
    return 'created';
  end if;
  if coalesce(array_length(v_pairs, 1), 0) > 1 then
    update public.money_feed set candidate_record_ids = '{}' where id = f.id;
    return 'pending';
  end if;

  select * into r from public.money_feed_rules fr
   where fr.family_id = f.family_id
     and (fr.wallet_id is null or fr.wallet_id = f.wallet_id)
     and (fr.direction is null or fr.direction = f.direction)
     and (fr.amount_min is null or f.amount >= fr.amount_min)
     and (fr.amount_max is null or f.amount <= fr.amount_max)
     and case fr.match
           when 'key' then fr.pattern = public.money_feed_key(f.description)
           else fr.pattern = '' or position(normalize(fr.pattern, NFKC) in normalize(f.description, NFKC)) > 0
         end
   order by fr.position, fr.created_at
   limit 1;
  if found then
    update public.money_feed set rule_id = r.id where id = f.id;
    if r.action = 'ignore' then
      update public.money_feed set status = 'ignored' where id = f.id;
      return 'ignored';
    end if;
    if r.action in ('link_recurring', 'adjust_only') then
      select array_agg(rec.id order by abs(rec.occurred_on - f.occurred_on)) into v_cands
        from public.money_records rec
        left join public.money_wallets card on card.id = rec.to_wallet_id
       where rec.family_id = f.family_id and rec.month is not null and rec.feed_id is null
         and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
         and abs(rec.occurred_on - f.occurred_on) <= s.estimate_days
         and case r.action
               when 'link_recurring' then rec.recurring_id = r.recurring_id
                 and (rec.wallet_id = f.wallet_id or rec.to_wallet_id = f.wallet_id)
               else rec.kind = 'transfer' and rec.recurring_id is null and rec.wallet_id = f.wallet_id
                 and card.type = 'card'
             end;
      if r.action = 'adjust_only' and coalesce(array_length(v_cands, 1), 0) > 1 then
        select array_agg(id) into v_cands from unnest(v_cands) as c(id)
         where public.money_record_amount(c.id) = f.amount;
      end if;
      if coalesce(array_length(v_cands, 1), 0) >= 1 and (r.action = 'link_recurring' or array_length(v_cands, 1) = 1) then
        perform public.money_feed_link(f.id, v_cands[1]);
        return 'linked';
      end if;
      if r.action = 'adjust_only' and v_cands is null then
        update public.money_feed set status = 'ignored' where id = f.id;
        return 'ignored';
      end if;
      update public.money_feed set candidate_record_ids = coalesce(v_cands, '{}') where id = f.id;
      return 'pending';
    end if;
  end if;

  if r.id is null then
    select array_agg(rec.id) into v_cands from public.money_records rec
     where rec.family_id = f.family_id and rec.month is not null and rec.feed_id is null
       and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
       and abs(rec.occurred_on - f.occurred_on) <= s.estimate_days
       and public.money_record_amount(rec.id) = f.amount
       and case f.direction
             when 'out' then rec.wallet_id = f.wallet_id and rec.kind in ('expense', 'transfer')
             else (rec.kind = 'income' and rec.wallet_id = f.wallet_id) or (rec.kind = 'transfer' and rec.to_wallet_id = f.wallet_id)
           end;
    if coalesce(array_length(v_cands, 1), 0) = 1 then
      perform public.money_feed_link(f.id, v_cands[1]);
      return 'linked';
    end if;
  end if;

  v_kind := case f.direction when 'out' then 'expense' else 'income' end;
  select array_agg(rec.id) into v_cands from public.money_records rec
   where rec.family_id = f.family_id and rec.feed_id is null and rec.month is null
     and not exists (select 1 from public.money_feed x where x.record_id = rec.id)
     and abs(rec.occurred_on - f.occurred_on) <= s.manual_days
     and public.money_record_amount(rec.id) = f.amount
     and ((rec.kind = v_kind and rec.wallet_id = f.wallet_id)
          or (rec.kind = 'transfer' and f.direction = 'out' and rec.wallet_id = f.wallet_id)
          or (rec.kind = 'transfer' and f.direction = 'in' and rec.to_wallet_id = f.wallet_id));
  if v_cands is not null and not f.skip_manual then
    -- カードの利用通知で、当たった手入力がレシートから入れた記録1つだけ（前後1日）なら、確かめずに結ぶ（docs/kakei.md §9.6.5 の B）
    if f.source = 'card_mail' and array_length(v_cands, 1) = 1
       and exists (select 1 from public.money_records rec
                    where rec.id = v_cands[1] and rec.receipt_store is not null
                      and abs(rec.occurred_on - f.occurred_on) <= 1) then
      update public.money_records set feed_id = coalesce(feed_id, f.id) where id = v_cands[1];
      update public.money_feed set status = 'linked', record_id = v_cands[1], candidate_record_ids = '{}' where id = f.id;
      return 'linked';
    end if;
    update public.money_feed set status = 'confirm', candidate_record_ids = v_cands where id = f.id;
    return 'confirm';
  end if;

  -- Amazon の注文メールから覚えた品目を割り振れた利用通知は、品目つきの記録にする（docs/kakei.md §9.7）。
  -- 手入力の記録と同じ額・出金元のものがあれば上で確認に回している（二重に作らない）
  if f.source = 'card_mail' and f.direction = 'out' and f.amazon_order_id is not null
     and coalesce(array_length(f.amazon_line_ids, 1), 0) > 0 then
    v_record := public.money_feed_amazon_create(f.id);
    if v_record is not null then
      return 'created';
    end if;
  end if;

  if r.id is not null and r.action in ('record', 'transfer') then
    if r.action = 'record' then
      insert into public.money_records (family_id, kind, occurred_on, wallet_id, store, feed_id)
      values (f.family_id, r.record_kind, f.occurred_on, f.wallet_id, btrim(r.store), f.id)
      returning id into v_record;
      insert into public.money_items (family_id, record_id, amount, category_id)
      values (f.family_id, v_record, f.amount, r.category_id);
    else
      insert into public.money_records (family_id, kind, occurred_on, wallet_id, to_wallet_id, store, feed_id)
      values (f.family_id, 'transfer', f.occurred_on,
              case f.direction when 'out' then f.wallet_id else r.to_wallet_id end,
              case f.direction when 'out' then r.to_wallet_id else f.wallet_id end, '', f.id)
      returning id into v_record;
      insert into public.money_items (family_id, record_id, amount) values (f.family_id, v_record, f.amount);
    end if;
    update public.money_feed set status = 'created', record_id = v_record where id = f.id;
    return 'created';
  end if;

  return 'pending';
end;
$function$;
