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

// アップロードはネイティブでは作り直しになるためここには持ってこない。
// Web版は <input type="file"> の File を Storage へ渡していたが、React Native に File は無い。
// expo-document-picker / expo-file-system で選んだファイルを渡す形になる
// （docs/native-app-rewrite.md §2）。情報タブを作るフェーズ2で足す。

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
