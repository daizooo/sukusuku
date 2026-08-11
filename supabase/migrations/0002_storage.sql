-- すくすく手帳: 書類箱用 Supabase Storage バケットとポリシー
-- 基本設計書 3章 Storage / 7章 Step5 に対応。
--
-- 運用ルール: アップロード時のパスを `{family_id}/{filename}` とすることで、
-- 先頭フォルダ名を family_id とみなしRLSと同様のアクセス制御をstorage.objectsに適用する。

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "documents_storage_select_own_family"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_family_id()::text
  );

create policy "documents_storage_insert_own_family"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_family_id()::text
  );

create policy "documents_storage_delete_own_family"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_family_id()::text
  );
