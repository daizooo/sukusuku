import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ChevronRight, Edit2, Home, Users } from 'lucide-react-native';
import type { Household, HouseholdDraft, Member, MemberDraft } from '@/types/app';
import { RELATION_LABEL } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { getHousehold, listMembers, updateHousehold, updateMember } from '@/lib/api/members';
import { canEditMember, formatAge, formatFullName } from '@/lib/memberUtils';
import { setFamilyRoster } from '@/lib/familyRoster';
import { formatDateString, parseDateString, toDateString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 設定タブの「家族」。世帯情報と、一家の3人の情報（docs/family-app.md §3.3・§4.3）。
//
// 以前の自由入力（お子様の情報・パパママ情報・緊急連絡先・カスタム項目）に代わるもの。
// 項目は決まった欄だけで、1人ずつ・世帯ごとに編集画面を開いて直す。
// メンバーの追加・削除はしない（一家の3人を固定で持つ）。

interface FamilySectionProps {
  familyId: string;
  userId: string;
}

type Editing = { kind: 'household' } | { kind: 'member'; member: Member } | null;

export default function FamilySection({ familyId, userId }: FamilySectionProps) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHousehold(supabase, familyId), listMembers(supabase, familyId)])
      .then(([nextHousehold, nextMembers]) => {
        if (cancelled) return;
        setHousehold(nextHousehold);
        setMembers(nextMembers);
        setFamilyRoster(nextMembers);
        setLoadError('');
      })
      .catch(() => {
        if (!cancelled) setLoadError('家族の情報を読み込めませんでした。');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, reloadKey]);

  const me = members.find((member) => member.userId === userId) ?? null;
  const isGuardian = me?.isGuardian ?? false;

  // 編集ボタンは見出しの右に1つだけ置く。押すと、直せる対象（自宅・家族それぞれ）を選ぶ。
  const targets: { key: string; label: string; target: Exclude<Editing, null> }[] = [
    ...(household && isGuardian
      ? [{ key: 'household', label: '自宅', target: { kind: 'household' } as const }]
      : []),
    ...members
      .filter((member) => canEditMember(member, me))
      .map((member) => ({
        key: member.id,
        label: formatFullName(member) || member.displayName,
        target: { kind: 'member', member } as const,
      })),
  ];
  const showEdit = !isLoading && loadError === '' && targets.length > 0;

  const startEdit = () => {
    // 直せる対象が1つだけなら、選ばせずにそのまま編集画面を開く。
    if (targets.length === 1) setEditing(targets[0].target);
    else setIsPicking(true);
  };

  const saveHousehold = async (draft: HouseholdDraft) => {
    const saved = await updateHousehold(supabase, familyId, draft);
    setHousehold(saved);
  };

  const saveMember = async (memberId: string, draft: MemberDraft) => {
    const saved = await updateMember(supabase, memberId, draft);
    const next = members.map((member) => (member.id === saved.id ? saved : member));
    setMembers(next);
    // 予定の参加者の名前・色にもすぐ反映する（表示名を変えた予定はDBが書き換える。0048）。
    setFamilyRoster(next);
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Users size={18} color={colors.navActive} />
        <Text style={styles.sectionTitle}>家族</Text>
        {showEdit && <EditButton label="家族の情報を編集" onPress={startEdit} />}
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.navActive} />
      ) : loadError !== '' ? (
        <View style={styles.errorBlock}>
          <Text style={styles.error}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setIsLoading(true);
              setReloadKey((key) => key + 1);
            }}
          >
            <Text style={styles.retry}>再読み込み</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.cards}>
          {household && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Home size={16} color={colors.textMuted} />
                <Text style={styles.cardTitle}>自宅</Text>
              </View>
              <InfoRow
                label="住所"
                value={[household.postalCode && `〒${household.postalCode}`, household.address]
                  .filter(Boolean)
                  .join(' ')}
              />
            </View>
          )}

          {members.map((member) => {
            const age = formatAge(member.birthDate);
            const birth = member.birthDate
              ? `${formatDateString(parseDateString(member.birthDate))}${age ? `（${age}）` : ''}`
              : '';
            const isChild = member.relation === 'child';
            return (
              <View key={member.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{formatFullName(member) || member.displayName}</Text>
                  <Text style={styles.badge}>{RELATION_LABEL[member.relation]}</Text>
                  {member.id === me?.id && <Text style={styles.badgeMe}>あなた</Text>}
                </View>
                <InfoRow label="生年月日" value={birth} />
                <InfoRow label="携帯電話" value={member.phone} />
                <InfoRow label={isChild ? '所属' : '勤務先'} value={member.workplace} />
                <InfoRow label={isChild ? '所属の電話' : '勤務先の電話'} value={member.workplacePhone} />
              </View>
            );
          })}

        </View>
      )}

      {isPicking && (
        <SheetModal visible onClose={() => setIsPicking(false)}>
          <View style={styles.pickHeader}>
            <Text style={styles.pickTitle}>編集する項目</Text>
          </View>
          {targets.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              onPress={() => {
                setIsPicking(false);
                setEditing(item.target);
              }}
              style={styles.pickRow}
            >
              <Text style={styles.pickLabel}>{item.label}</Text>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>
          ))}
        </SheetModal>
      )}

      {editing?.kind === 'household' && household && (
        <HouseholdEditSheet
          household={household}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            await saveHousehold(draft);
            setEditing(null);
          }}
        />
      )}
      {editing?.kind === 'member' && (
        <MemberEditSheet
          member={editing.member}
          otherNames={members.filter((m) => m.id !== editing.member.id).map((m) => m.displayName)}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            await saveMember(editing.member.id, draft);
            setEditing(null);
          }}
        />
      )}
    </View>
  );
}

function EditButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.editButton}
    >
      <Edit2 size={14} color={colors.navActiveText} />
      <Text style={styles.editText}>編集</Text>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, value === '' && styles.rowValueEmpty]} selectable={value !== ''}>
        {value || '未設定'}
      </Text>
    </View>
  );
}

// ---- 編集画面 ----

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'number-pad';
}

function Field({ label, value, onChange, placeholder, keyboardType = 'default' }: FieldProps) {
  return (
    <View style={styles.flex}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        autoCapitalize="none"
      />
    </View>
  );
}

function EditSheet({
  title,
  onClose,
  onSave,
  validate,
  children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => Promise<void>;
  /** 保存の前に確かめる。問題があれば画面に出す文言を返す。 */
  validate?: () => string;
  children: ReactNode;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const invalid = validate?.() ?? '';
    if (invalid !== '') {
      setError(invalid);
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await onSave();
    } catch {
      setError('保存できませんでした。もう一度お試しください。');
      setIsSaving(false);
    }
  };

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={title}
        onClose={onClose}
        footer={
          <>
            {error !== '' && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleSave()}
              disabled={isSaving}
              style={[styles.submit, isSaving && styles.submitDisabled]}
            >
              <Text style={styles.submitText}>{isSaving ? '保存中...' : '保存する'}</Text>
            </Pressable>
          </>
        }
      >
        {children}
      </LogModalShell>
    </SheetModal>
  );
}

function HouseholdEditSheet({
  household,
  onClose,
  onSave,
}: {
  household: Household;
  onClose: () => void;
  onSave: (draft: HouseholdDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<HouseholdDraft>({
    name: household.name,
    postalCode: household.postalCode,
    address: household.address,
    homePhone: household.homePhone,
  });
  const update = (patch: Partial<HouseholdDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <EditSheet title="自宅の情報" onClose={onClose} onSave={() => onSave(draft)}>
      <Field
        label="郵便番号"
        value={draft.postalCode}
        onChange={(postalCode) => update({ postalCode })}
        placeholder="例: 123-4567"
        keyboardType="number-pad"
      />
      <Field label="住所" value={draft.address} onChange={(address) => update({ address })} />
    </EditSheet>
  );
}

function MemberEditSheet({
  member,
  otherNames,
  onClose,
  onSave,
}: {
  member: Member;
  /** ほかの家族の表示名。同じ名前にはさせない（予定の参加者を名前で持つため）。 */
  otherNames: string[];
  onClose: () => void;
  onSave: (draft: MemberDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MemberDraft>({
    displayName: member.displayName,
    familyName: member.familyName,
    givenName: member.givenName,
    familyNameKana: member.familyNameKana,
    givenNameKana: member.givenNameKana,
    birthDate: member.birthDate,
    phone: member.phone,
    email: member.email,
    workplace: member.workplace,
    workplacePhone: member.workplacePhone,
  });
  const update = (patch: Partial<MemberDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const isChild = member.relation === 'child';

  const openDatePicker = () =>
    DateTimePickerAndroid.open({
      value: parseDateString(draft.birthDate) ?? new Date(),
      mode: 'date',
      maximumDate: new Date(),
      onChange: (_event, picked) => {
        if (picked) update({ birthDate: toDateString(picked) });
      },
    });

  return (
    <EditSheet
      title={`${formatFullName(member) || member.displayName}の情報`}
      onClose={onClose}
      onSave={() => onSave(draft)}
      validate={() => {
        const name = draft.displayName.trim();
        if (name === '') return '表示名を入れてください。';
        if (otherNames.includes(name)) return 'ほかの家族と同じ表示名にはできません。';
        return '';
      }}
    >
      <Field
        label="表示名（予定やリストに出る名前）"
        value={draft.displayName}
        onChange={(displayName) => update({ displayName })}
      />
      <View style={styles.pair}>
        <Field label="姓" value={draft.familyName} onChange={(familyName) => update({ familyName })} />
        <Field label="名" value={draft.givenName} onChange={(givenName) => update({ givenName })} />
      </View>
      <View>
        <Text style={styles.label}>生年月日</Text>
        <Pressable accessibilityRole="button" onPress={openDatePicker} style={styles.input}>
          <Text style={[styles.inputText, draft.birthDate === '' && styles.rowValueEmpty]}>
            {draft.birthDate ? formatDateString(parseDateString(draft.birthDate)) : '選ぶ'}
          </Text>
        </Pressable>
      </View>
      <Field
        label="携帯電話"
        value={draft.phone}
        onChange={(phone) => update({ phone })}
        keyboardType="phone-pad"
      />
      <Field
        label={isChild ? '所属（保育園・学校）' : '勤務先'}
        value={draft.workplace}
        onChange={(workplace) => update({ workplace })}
      />
      <Field
        label={isChild ? '所属の電話' : '勤務先の電話'}
        value={draft.workplacePhone}
        onChange={(workplacePhone) => update({ workplacePhone })}
        keyboardType="phone-pad"
      />
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  cards: { gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  badge: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: colors.background,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeMe: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.navActiveText,
    backgroundColor: colors.selectedSurface,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  editButton: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editText: { fontSize: 13, fontWeight: '700', color: colors.navActiveText },
  pickHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickLabel: { fontSize: 15, fontWeight: '500', color: colors.text },
  row: { flexDirection: 'row', gap: 12 },
  rowLabel: { width: 84, fontSize: 12, fontWeight: '500', color: colors.textMuted },
  rowValue: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textSubtle },
  rowValueEmpty: { color: colors.textFaint },
  errorBlock: { gap: 8, alignItems: 'flex-start' },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  retry: { fontSize: 13, fontWeight: '700', color: colors.navActiveText },

  pair: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 12, fontWeight: '500', color: colors.textSubtle, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 9,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSubtle,
    backgroundColor: colors.surface,
  },
  inputText: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  submit: {
    backgroundColor: colors.navActive,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { fontSize: 15, fontWeight: '700', color: colors.primaryText },
});
