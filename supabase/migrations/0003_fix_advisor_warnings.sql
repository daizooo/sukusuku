-- Advisor警告の是正 (Supabase Security Advisor)
-- 1. set_updated_at: search_path を固定してmutable search path警告を解消
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. current_family_id: RLSポリシー内部でのみ使う想定のためPostgREST経由の直接RPC実行を禁止
revoke execute on function public.current_family_id() from public, anon, authenticated;
grant execute on function public.current_family_id() to postgres, service_role;
