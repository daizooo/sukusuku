'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Edit2, Home, Users } from 'lucide-react';
import type { Household, HouseholdDraft, Member, MemberDraft } from '@/types/app';
import { RELATION_LABEL } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { getHousehold, listMembers, updateHousehold, updateMember } from '@/lib/api/members';
import { canEditMember, formatAge, formatFullName, formatFullNameKana } from '@/lib/memberUtils';
import { formatDateString, parseDateString, toDateString } from '@/lib/dateUtils';
import { LogModalShell } from '@/components/sukusuku/modals/logModalParts';

// 設定タブの「家族」。世帯情報と、一家の3人の情報（docs/family-app.md §3.3・§4.3）。
// mobile版の `mobile/src/components/info/FamilySection.tsx` と同じ項目・同じ文言にしてある。
//
// 以前の自由入力（お子様の情報・パパママ情報・緊急連絡先・カスタム項目）に代わるもの。
// メンバーの追加・削除はしない（一家の3人を固定で持つ）。

interface FamilySectionProps {
  familyId: string;
  userId: string;
  /** メンバーを読み込んだ・直したとき。子の誕生日（生後日数）をアプリ全体へ反映するのに使う。 */
  onMembersChange?: (members: Member[]) => void;
}

type Editing = { kind: 'household' } | { kind: 'member'; member: Member } | null;

export default function FamilySection({ familyId, userId, onMembersChange }: FamilySectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHousehold(supabase, familyId), listMembers(supabase, familyId)])
      .then(([nextHousehold, nextMembers]) => {
        if (cancelled) return;
        setHousehold(nextHousehold);
        setMembers(nextMembers);
        setLoadError('');
      })
      .catch((err) => {
        console.error('Failed to load family:', err);
        if (!cancelled) setLoadError('家族の情報を読み込めませんでした。');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId, reloadKey]);

  const me = members.find((member) => member.userId === userId) ?? null;
  const isGuardian = me?.isGuardian ?? false;

  const saveHousehold = async (draft: HouseholdDraft) => {
    setHousehold(await updateHousehold(supabase, familyId, draft));
  };

  const saveMember = async (memberId: string, draft: MemberDraft) => {
    const saved = await updateMember(supabase, memberId, draft);
    const next = members.map((member) => (member.id === saved.id ? saved : member));
    setMembers(next);
    onMembersChange?.(next);
  };

  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <h3 className="font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
        <Users size={18} className="mr-2 text-blue-500" /> 家族
      </h3>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center">読み込み中...</p>
      ) : loadError !== '' ? (
        <div className="space-y-2">
          <p className="text-xs text-red-600">{loadError}</p>
          <button
            onClick={() => {
              setIsLoading(true);
              setReloadKey((key) => key + 1);
            }}
            className="text-sm font-bold text-blue-600"
          >
            再読み込み
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {household && (
            <div className="border border-gray-200 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-2 mb-1">
                <Home size={16} className="text-gray-500" />
                <span className="font-bold text-gray-900">{household.name || '世帯'}</span>
                {isGuardian && (
                  <EditButton label="世帯の情報を編集" onClick={() => setEditing({ kind: 'household' })} />
                )}
              </div>
              <InfoRow
                label="住所"
                value={[household.postalCode && `〒${household.postalCode}`, household.address]
                  .filter(Boolean)
                  .join(' ')}
              />
              <InfoRow label="固定電話" value={household.homePhone} />
            </div>
          )}

          {members.map((member) => {
            const age = formatAge(member.birthDate);
            const birth = member.birthDate
              ? `${formatDateString(parseDateString(member.birthDate))}${age ? `（${age}）` : ''}`
              : '';
            const isChild = member.relation === 'child';
            return (
              <div key={member.id} className="border border-gray-200 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-gray-900">{member.displayName}</span>
                  <span className="text-[11px] font-semibold text-gray-500 bg-gray-50 rounded-md px-1.5">
                    {RELATION_LABEL[member.relation]}
                  </span>
                  {member.id === me?.id && (
                    <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 rounded-md px-1.5">
                      あなた
                    </span>
                  )}
                  {canEditMember(member, me) && (
                    <EditButton
                      label={`${member.displayName}の情報を編集`}
                      onClick={() => setEditing({ kind: 'member', member })}
                    />
                  )}
                </div>
                <InfoRow label="氏名" value={formatFullName(member)} />
                <InfoRow label="ふりがな" value={formatFullNameKana(member)} />
                <InfoRow label="生年月日" value={birth} />
                <InfoRow label="携帯電話" value={member.phone} />
                {!isChild && <InfoRow label="メール" value={member.email} />}
                <InfoRow label={isChild ? '所属' : '勤務先'} value={member.workplace} />
                <InfoRow label={isChild ? '所属の電話' : '勤務先の電話'} value={member.workplacePhone} />
              </div>
            );
          })}

          {!isGuardian && (
            <p className="text-xs text-gray-500">世帯の情報と他の家族の情報は、保護者だけが編集できます。</p>
          )}
        </div>
      )}

      {editing?.kind === 'household' && household && (
        <HouseholdEditModal
          household={household}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            await saveHousehold(draft);
            setEditing(null);
          }}
        />
      )}
      {editing?.kind === 'member' && (
        <MemberEditModal
          member={editing.member}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            await saveMember(editing.member.id, draft);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="ml-auto flex items-center gap-1 text-sm font-bold text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50"
    >
      <Edit2 size={14} /> 編集
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-24 shrink-0 text-xs font-medium text-gray-500 pt-0.5">{label}</span>
      <span className={`flex-1 min-w-0 break-words ${value ? 'text-gray-700' : 'text-gray-400'}`}>
        {value || '未設定'}
      </span>
    </div>
  );
}

// ---- 編集画面 ----

const INPUT_CLASS =
  'w-full border border-gray-300 rounded-lg px-2 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'tel' | 'email';
  inputMode?: 'text' | 'tel' | 'email' | 'numeric';
}

function Field({ label, value, onChange, placeholder, type = 'text', inputMode }: FieldProps) {
  return (
    <label className="block flex-1 min-w-0">
      <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
    </label>
  );
}

function EditModal({
  title,
  onClose,
  onSave,
  children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => Promise<void>;
  children: ReactNode;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    try {
      await onSave();
    } catch (err) {
      console.error('Failed to save family info:', err);
      setError('保存できませんでした。もう一度お試しください。');
      setIsSaving(false);
    }
  };

  return (
    // 戻る操作で閉じるのは LogModalShell の中（useBackLayer）。
    <LogModalShell
      title={title}
      onClose={onClose}
      footer={
        <>
          {error !== '' && (
            <p role="alert" className="text-xs text-red-600 pb-1">
              {error}
            </p>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl"
          >
            {isSaving ? '保存中...' : '保存する'}
          </button>
        </>
      }
    >
      {children}
    </LogModalShell>
  );
}

function HouseholdEditModal({
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
    <EditModal title="世帯の情報" onClose={onClose} onSave={() => onSave(draft)}>
      <Field label="家名" value={draft.name} onChange={(name) => update({ name })} placeholder="例: 白石家" />
      <Field
        label="郵便番号"
        value={draft.postalCode}
        onChange={(postalCode) => update({ postalCode })}
        placeholder="例: 123-4567"
        inputMode="numeric"
      />
      <Field label="住所" value={draft.address} onChange={(address) => update({ address })} />
      <Field
        label="固定電話"
        value={draft.homePhone}
        onChange={(homePhone) => update({ homePhone })}
        type="tel"
        inputMode="tel"
      />
    </EditModal>
  );
}

function MemberEditModal({
  member,
  onClose,
  onSave,
}: {
  member: Member;
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

  return (
    <EditModal title={`${member.displayName}の情報`} onClose={onClose} onSave={() => onSave(draft)}>
      {/* 表示名は予定の参加者・主体と同じ値で突き合わせているため、予定を
          メンバーのidで持つように切り替える（docs/family-app.md §5 の5）までは変えさせない。 */}
      <div>
        <span className="block text-xs font-medium text-gray-700 mb-1">表示名</span>
        <p className="text-sm text-gray-700">{member.displayName}</p>
        <p className="text-[10px] text-gray-400 mt-1">予定やリストに出る名前です。いまは変更できません。</p>
      </div>
      <div className="flex gap-3">
        <Field label="姓" value={draft.familyName} onChange={(familyName) => update({ familyName })} />
        <Field label="名" value={draft.givenName} onChange={(givenName) => update({ givenName })} />
      </div>
      <div className="flex gap-3">
        <Field
          label="せい"
          value={draft.familyNameKana}
          onChange={(familyNameKana) => update({ familyNameKana })}
        />
        <Field
          label="めい"
          value={draft.givenNameKana}
          onChange={(givenNameKana) => update({ givenNameKana })}
        />
      </div>
      <label className="block">
        <span className="block text-xs font-medium text-gray-700 mb-1">生年月日</span>
        <input
          type="date"
          value={draft.birthDate}
          max={toDateString(new Date())}
          onChange={(e) => update({ birthDate: e.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      <Field label="携帯電話" value={draft.phone} onChange={(phone) => update({ phone })} type="tel" inputMode="tel" />
      {!isChild && (
        <Field label="メール" value={draft.email} onChange={(email) => update({ email })} type="email" inputMode="email" />
      )}
      <Field
        label={isChild ? '所属（保育園・学校）' : '勤務先'}
        value={draft.workplace}
        onChange={(workplace) => update({ workplace })}
      />
      <Field
        label={isChild ? '所属の電話' : '勤務先の電話'}
        value={draft.workplacePhone}
        onChange={(workplacePhone) => update({ workplacePhone })}
        type="tel"
        inputMode="tel"
      />
    </EditModal>
  );
}
