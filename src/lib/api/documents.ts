import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/types/supabase';
import type { DocumentItem } from '@/types/app';

type DocumentRow = Tables<'documents'>;
type SupabaseDb = SupabaseClient<Database>;

const BUCKET = 'documents';

export const rowToDocument = (row: DocumentRow): DocumentItem => ({
  id: row.id,
  title: row.title,
  date: row.uploaded_at,
  type: 'image',
  filePath: row.file_url,
});

export async function listDocuments(supabase: SupabaseDb, familyId: string): Promise<DocumentItem[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('family_id', familyId)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToDocument);
}

// storage.objectsのRLSは先頭フォルダ名 = family_id を要求するため、そのパスにアップロードする
export async function uploadDocument(
  supabase: SupabaseDb,
  familyId: string,
  file: File,
  title: string,
): Promise<DocumentItem> {
  const path = `${familyId}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('documents')
    .insert({ family_id: familyId, title, file_url: path })
    .select('*')
    .single();
  if (error) throw error;
  return rowToDocument(data);
}

export async function deleteDocument(supabase: SupabaseDb, doc: DocumentItem): Promise<void> {
  await supabase.storage.from(BUCKET).remove([doc.filePath]);
  const { error } = await supabase.from('documents').delete().eq('id', doc.id);
  if (error) throw error;
}

export async function getDocumentSignedUrl(supabase: SupabaseDb, filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}
