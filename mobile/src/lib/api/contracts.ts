import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/types/supabase';
import type {
  Contract,
  ContractAmountCycle,
  ContractDraft,
  ContractField,
  ContractKind,
} from '@/types/app';

type ContractRow = Tables<'contracts'>;
type SupabaseDb = SupabaseClient<Database>;

// 契約（その他タブ。docs/contracts.md）。PWA版の `src/lib/api/contracts.ts` と同じ。
// 見える範囲（見せる相手）は DB のポリシーが決める。ここでは絞らない。

const toKind = (value: string): ContractKind =>
  value === 'rent' || value === 'insurance' || value === 'subscription' ? value : 'other';

const toCycle = (value: string | null): ContractAmountCycle | null =>
  value === 'monthly' || value === 'yearly' || value === 'once' ? value : null;

const rowToContract = (row: ContractRow): Contract => ({
  id: row.id,
  kind: toKind(row.kind),
  title: row.title,
  company: row.company,
  contractorId: row.contractor_id,
  startedOn: row.started_on,
  renewsOn: row.renews_on,
  termMonths: row.term_months,
  amount: row.amount,
  amountCycle: toCycle(row.amount_cycle),
  notifyDays: row.notify_days,
  memo: row.memo,
  visibleMemberIds: row.visible_member_ids,
  createdBy: row.created_by,
});

const draftToRow = (draft: ContractDraft) => ({
  kind: draft.kind,
  title: draft.title.trim(),
  company: draft.company.trim(),
  contractor_id: draft.contractorId,
  started_on: draft.startedOn,
  renews_on: draft.renewsOn,
  term_months: draft.termMonths,
  amount: draft.amount,
  amount_cycle: draft.amount === null ? null : draft.amountCycle,
  notify_days: draft.notifyDays,
  memo: draft.memo.trim(),
  visible_member_ids: draft.visibleMemberIds,
});

/** 一覧に要る要約（自由項目は含まない）。DB のポリシーで、見える契約だけが返る。 */
export async function loadContracts(supabase: SupabaseDb, familyId: string): Promise<Contract[]> {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('family_id', familyId)
    .order('renews_on', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToContract);
}

/** 契約を開いたときに読む自由項目。 */
export async function loadContractFields(supabase: SupabaseDb, contractId: string): Promise<ContractField[]> {
  const { data, error } = await supabase
    .from('contract_fields')
    .select('id,label,value,position')
    .eq('contract_id', contractId)
    .order('position', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

const rowsOf = (contractId: string, draft: ContractDraft): TablesInsert<'contract_fields'>[] =>
  draft.fields
    .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
    .filter((field) => field.label !== '')
    .map((field, position) => ({ contract_id: contractId, ...field, position }));

export async function insertContract(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
  draft: ContractDraft,
): Promise<Contract> {
  const { data, error } = await supabase
    .from('contracts')
    .insert({ ...draftToRow(draft), family_id: familyId, created_by: userId })
    .select('*')
    .single();
  if (error) throw error;
  const rows = rowsOf(data.id, draft);
  if (rows.length > 0) {
    const { error: fieldError } = await supabase.from('contract_fields').insert(rows);
    if (fieldError) throw fieldError;
  }
  return rowToContract(data);
}

/** 契約を直す。自由項目は入れ替える（今ある行を消して、入力の行を入れ直す）。 */
export async function updateContract(supabase: SupabaseDb, id: string, draft: ContractDraft): Promise<Contract> {
  const { data, error } = await supabase
    .from('contracts')
    .update(draftToRow(draft))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  const { error: clearError } = await supabase.from('contract_fields').delete().eq('contract_id', id);
  if (clearError) throw clearError;
  const rows = rowsOf(id, draft);
  if (rows.length > 0) {
    const { error: fieldError } = await supabase.from('contract_fields').insert(rows);
    if (fieldError) throw fieldError;
  }
  return rowToContract(data);
}

/** 「更新した」。更新日だけを進める。 */
export async function setContractRenewal(supabase: SupabaseDb, id: string, renewsOn: string): Promise<Contract> {
  const { data, error } = await supabase
    .from('contracts')
    .update({ renews_on: renewsOn })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToContract(data);
}

export async function deleteContract(supabase: SupabaseDb, id: string): Promise<void> {
  const { error } = await supabase.from('contracts').delete().eq('id', id);
  if (error) throw error;
}
