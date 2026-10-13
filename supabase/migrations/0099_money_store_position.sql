-- 家計の設定「よく行くお店」を並べ替えられるようにする（docs/kakei.md §3.5）。
--   - money_stores に position（並び順。小さいほど上）を足す。今の並び（名前順）で振る
--   - 新しく登録したお店（記録の保存で自動登録されるものを含む）は、いちばん下に付く
--   - money_bootstrap は stores を position 順で返す（0089 から、stores の並びだけ変える）
--   - 古いアプリは position を読まないだけで、今までどおり動く（名前順に並べ直す）
-- 削除を含む文は無い。

alter table public.money_stores
  add column if not exists position integer not null default 0;

comment on column public.money_stores.position is
  '並び順（小さいほど上）。家族ごとに 0 から。新しいお店は最後に付く。docs/kakei.md §3.5。';

-- 今の並び（名前順）を引き継ぐ。
update public.money_stores s
   set position = r.rn - 1
  from (
    select id, row_number() over (partition by family_id order by name, id) as rn
      from public.money_stores
  ) r
 where r.id = s.id;

-- 新しいお店は最後に付ける。保存関数（save_money_record）を変えずに済むよう、挿入の時点で決める。
create or replace function public.money_stores_set_position()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.position := coalesce(
    (select max(s.position) + 1 from public.money_stores s where s.family_id = new.family_id),
    0
  );
  return new;
end;
$function$;

create or replace trigger money_stores_set_position
  before insert on public.money_stores
  for each row
  execute function public.money_stores_set_position();

-- money_bootstrap（0089 から、stores を position 順にした）
create or replace function public.money_bootstrap(p_family_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                     from public.money_categories c where c.family_id = p_family_id),
    'budgets', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
                  from public.money_budgets b where b.family_id = p_family_id),
    'wallets', (select coalesce(jsonb_agg(to_jsonb(w) order by w.position), '[]'::jsonb)
                  from public.money_wallets w where w.family_id = p_family_id),
    'stores', (select coalesce(jsonb_agg(to_jsonb(s) order by s.position, s.name), '[]'::jsonb)
                 from public.money_stores s where s.family_id = p_family_id),
    'recurring', (select coalesce(jsonb_agg(to_jsonb(r) order by r.position), '[]'::jsonb)
                    from public.money_recurring r where r.family_id = p_family_id),
    'balances', (select coalesce(jsonb_agg(to_jsonb(wb)), '[]'::jsonb)
                   from public.money_wallet_balances wb where wb.family_id = p_family_id),
    'records', (
      select coalesce(jsonb_agg(
               to_jsonb(rec) || jsonb_build_object('money_items', coalesce(
                 (select jsonb_agg(to_jsonb(it) order by it.position)
                    from public.money_items it where it.record_id = rec.id),
                 '[]'::jsonb))
               order by rec.occurred_on, rec.created_at, rec.id), '[]'::jsonb)
        from public.money_records rec where rec.family_id = p_family_id),
    'securities', (select coalesce(jsonb_agg(to_jsonb(se) order by se.position), '[]'::jsonb)
                     from public.money_securities se where se.family_id = p_family_id),
    'holdings', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
                   from public.money_holdings h where h.family_id = p_family_id),
    'latest_values', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
                        from public.money_latest_holding_values(p_family_id) v)
  );
$function$;
