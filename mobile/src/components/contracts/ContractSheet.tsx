import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import type { Contract, ContractDraft, ContractField, ContractKind, Member } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { loadContractFields } from '@/lib/api/contracts';
import {
  CONTRACT_KINDS,
  CYCLES,
  CYCLE_LABEL,
  FIELD_WARNING,
  KIND_LABEL,
  NOTIFY_DAY_OPTIONS,
  advanceRenewal,
  draftError,
  defaultVisibleMemberIds,
  emptyContractDraft,
  parseCount,
} from '@/lib/contractUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { FieldLabel, Segmented } from '@/components/ui/form';
import ContractDateField from './ContractDateField';

/**
 * 契約の追加・編集（docs/contracts.md §7.2）。上から 種類 → 名称 → 会社 → 契約者 → 開始日・更新日 →
 * 契約期間 → 金額と周期 → そのほかの項目（自由項目）→ お知らせ → メモ。
 * 見せる相手は画面で選ばせず、夫婦を裏で効かせる（defaultVisibleMemberIds）。
 * 更新日・契約期間は空でよい（県民共済のように無い契約。お知らせは更新日があるものだけ）。
 * 編集では「更新した」（更新日を契約期間ぶん進める）と削除がある。
 * Web版は `src/components/sukusuku/modals/ContractModal.tsx`。
 */

const toDraft = (contract: Contract): ContractDraft => ({
  kind: contract.kind,
  title: contract.title,
  company: contract.company,
  contractorId: contract.contractorId,
  startedOn: contract.startedOn,
  renewsOn: contract.renewsOn,
  termMonths: contract.termMonths,
  amount: contract.amount,
  amountCycle: contract.amountCycle,
  notifyDays: contract.notifyDays,
  memo: contract.memo,
  visibleMemberIds: contract.visibleMemberIds,
  fields: [],
});

interface ContractSheetProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  contract: Contract | null;
  members: Member[];
  /** 自分の family_members.id。新しい契約の契約者の初期値と、見せる相手（夫婦と本人）の初期値に使う。 */
  myMemberId: string | null;
  today: string;
  onClose: () => void;
  onSubmit: (draft: ContractDraft) => void;
  onDelete?: () => void;
  /** 「更新した」。新しい更新日を渡す。 */
  onRenew?: (renewsOn: string) => void;
}

export default function ContractSheet({
  contract,
  members,
  myMemberId,
  today,
  onClose,
  onSubmit,
  onDelete,
  onRenew,
}: ContractSheetProps) {
  const [draft, setDraft] = useState<ContractDraft>(() =>
    contract ? toDraft(contract) : emptyContractDraft(myMemberId, defaultVisibleMemberIds(members, myMemberId)),
  );
  const [amountText, setAmountText] = useState(contract?.amount != null ? String(contract.amount) : '');
  const [termText, setTermText] = useState(contract?.termMonths != null ? String(contract.termMonths) : '');
  const [error, setError] = useState<string | null>(null);
  const [fieldsReady, setFieldsReady] = useState(contract === null);

  // 自由項目は開いたときに読む（一覧には持たない）。読み終えるまで保存は押せない（空で上書きしないため）。
  const contractId = contract?.id ?? null;
  useEffect(() => {
    if (!contractId) return;
    let isMounted = true;
    loadContractFields(supabase, contractId)
      .then((fields: ContractField[]) => {
        if (!isMounted) return;
        setDraft((prev) => ({ ...prev, fields: fields.map(({ label, value }) => ({ label, value })) }));
        setFieldsReady(true);
      })
      .catch(() => {
        if (isMounted) setError('そのほかの項目を読み込めませんでした。閉じてもう一度開いてください。');
      });
    return () => {
      isMounted = false;
    };
  }, [contractId]);

  const update = (patch: Partial<ContractDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const toggleNotifyDay = (day: number) =>
    update({
      notifyDays: draft.notifyDays.includes(day)
        ? draft.notifyDays.filter((value) => value !== day)
        : [...draft.notifyDays, day].sort((a, b) => b - a),
    });

  const setField = (index: number, patch: Partial<ContractDraft['fields'][number]>) =>
    update({ fields: draft.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)) });

  const addField = (label = '') => update({ fields: [...draft.fields, { label, value: '' }] });

  const handleSubmit = () => {
    const amount = parseCount(amountText);
    const next: ContractDraft = {
      ...draft,
      amount,
      amountCycle: amount === null ? null : (draft.amountCycle ?? 'monthly'),
      termMonths: parseCount(termText),
    };
    const message = draftError(next);
    if (message) {
      setError(message);
      return;
    }
    onSubmit(next);
  };

  const handleDelete = () =>
    Alert.alert('この契約を削除しますか？', 'そのほかの項目もすべて消えます。', [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete?.() },
    ]);

  const termMonths = parseCount(termText);
  const canRenew = !!contract && onRenew && draft.renewsOn !== null && termMonths !== null;

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={contract ? '契約を編集' : '契約を追加'}
        onClose={onClose}
        footer={
          <>
            <Pressable
              accessibilityRole="button"
              onPress={handleSubmit}
              disabled={!fieldsReady}
              style={[styles.submit, !fieldsReady && styles.disabled]}
            >
              <Text style={styles.submitText}>{contract ? '保存する' : '追加する'}</Text>
            </Pressable>
            {contract && onDelete && (
              <Pressable accessibilityRole="button" onPress={handleDelete} style={styles.delete}>
                <Text style={styles.deleteText}>削除する</Text>
              </Pressable>
            )}
          </>
        }
      >
        <View style={styles.field}>
          <FieldLabel>種類</FieldLabel>
          <Segmented
            options={CONTRACT_KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))}
            value={draft.kind}
            onChange={(kind: ContractKind) => update({ kind })}
          />
        </View>

        <View style={styles.field}>
          <FieldLabel>名称</FieldLabel>
          <TextInput
            style={styles.input}
            value={draft.title}
            onChangeText={(title) => update({ title })}
          />
        </View>

        <View style={styles.field}>
          <FieldLabel>会社</FieldLabel>
          <TextInput
            style={styles.input}
            value={draft.company}
            onChangeText={(company) => update({ company })}
          />
        </View>

        <View style={styles.field}>
          <FieldLabel>契約者</FieldLabel>
          <View style={styles.chips}>
            {members.map((member) => (
              <Chip
                key={member.id}
                label={member.displayName}
                selected={draft.contractorId === member.id}
                onPress={() => update({ contractorId: member.id })}
              />
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <ContractDateField label="開始日" value={draft.startedOn} onChange={(startedOn) => update({ startedOn })} />
          <ContractDateField label="更新日" value={draft.renewsOn} onChange={(renewsOn) => update({ renewsOn })} />
        </View>

        <View style={styles.row}>
          <View style={styles.flex}>
            <FieldLabel>契約期間（か月）</FieldLabel>
            <TextInput
              style={styles.input}
              value={termText}
              onChangeText={setTermText}
              keyboardType="number-pad"
              inputMode="numeric"
            />
          </View>
          {canRenew && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const next = advanceRenewal(draft.renewsOn as string, termMonths as number, today);
                update({ renewsOn: next });
                onRenew?.(next);
              }}
              style={styles.renew}
            >
              <Text style={styles.renewText}>更新した</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.row}>
          <View style={styles.flex}>
            <FieldLabel>金額（円）</FieldLabel>
            <TextInput
              style={styles.input}
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="number-pad"
              inputMode="numeric"
            />
          </View>
          <View style={styles.cycleBox}>
            <FieldLabel>周期</FieldLabel>
            <Segmented
              options={CYCLES.map((cycle) => ({ value: cycle, label: CYCLE_LABEL[cycle] }))}
              value={draft.amountCycle ?? 'monthly'}
              onChange={(amountCycle) => update({ amountCycle })}
            />
          </View>
        </View>

        <View style={styles.customBox}>
          <FieldLabel>そのほかの項目</FieldLabel>
          {draft.fields.map((field, index) => (
            <View key={index} style={styles.customRow}>
              <TextInput
                style={[styles.input, styles.customLabel]}
                value={field.label}
                onChangeText={(label) => setField(index, { label })}
                placeholder="項目名"
                placeholderTextColor={colors.textFaint}
              />
              <TextInput
                style={[styles.input, styles.flex]}
                value={field.value}
                onChangeText={(value) => setField(index, { value })}
                placeholder="内容"
                placeholderTextColor={colors.textFaint}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="この項目を消す"
                onPress={() => update({ fields: draft.fields.filter((_, i) => i !== index) })}
                hitSlop={8}
              >
                <X size={16} color={colors.textFaint} />
              </Pressable>
            </View>
          ))}
          <View style={styles.chips}>
            <Pressable accessibilityRole="button" onPress={() => addField()} style={styles.suggest}>
              <Plus size={12} color={colors.contract} />
              <Text style={styles.suggestText}>自由に追加</Text>
            </Pressable>
          </View>
          {draft.fields.length > 0 && <Text style={styles.warning}>{FIELD_WARNING}</Text>}
        </View>

        {draft.renewsOn !== null && (
          <View style={styles.field}>
            <FieldLabel>お知らせ（更新日の何日前）</FieldLabel>
            <View style={styles.chips}>
              {NOTIFY_DAY_OPTIONS.map((day) => (
                <Chip
                  key={day}
                  label={`${day}日前`}
                  selected={draft.notifyDays.includes(day)}
                  onPress={() => toggleNotifyDay(day)}
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.field}>
          <FieldLabel>メモ</FieldLabel>
          <TextInput
            style={[styles.input, styles.memo]}
            value={draft.memo}
            onChangeText={(memo) => update({ memo })}
            multiline
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 6 },
  field: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  cycleBox: { width: 148, gap: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    backgroundColor: colors.surface,
    fontVariant: ['tabular-nums'],
  },
  memo: { minHeight: 64, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.contract, borderColor: colors.contract },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.neutralBadgeText },
  chipTextSelected: { color: colors.primaryText },
  customBox: { gap: 8 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customLabel: { width: 104 },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: '#99f6e4', // teal-200
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: colors.contractSurface,
  },
  suggestText: { fontSize: 11, fontWeight: '700', color: colors.contract },
  warning: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.alertText,
    backgroundColor: colors.dangerSurface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  renew: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: colors.contractSurface,
    borderWidth: 1,
    borderColor: '#99f6e4',
  },
  renewText: { fontSize: 13, fontWeight: '700', color: colors.contract },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.contract },
  submitText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  delete: { paddingVertical: 12, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
