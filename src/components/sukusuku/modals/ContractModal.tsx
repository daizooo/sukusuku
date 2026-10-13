'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Contract, ContractDraft, ContractKind, Member } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { loadContractFields } from '@/lib/api/contracts';
import {
  CATEGORY_SUGGESTIONS,
  CONTRACT_KINDS,
  CYCLES,
  CYCLE_LABEL,
  DEFAULT_TERM_MONTHS,
  FIELD_SUGGESTIONS,
  FIELD_WARNING,
  KIND_LABEL,
  NOTIFY_DAY_OPTIONS,
  advanceRenewal,
  draftError,
  emptyContractDraft,
  parseCount,
} from '@/lib/contractUtils';
import { ModalShell } from './TaskForm';
import { Segmented } from './logModalParts';

// 契約の追加・編集（docs/contracts.md §7.2）。上から 種類 → 名称 → 会社 → 小分類 → 契約者 → 開始日・更新日 →
// 契約期間 → 金額と周期 → そのほかの項目（自由項目）→ お知らせ → メモ → 見せる相手。
// 編集では「更新した」（更新日を契約期間ぶん進める）と削除がある。
// mobile版は `mobile/src/components/contracts/ContractSheet.tsx` と同じ項目・同じ文言。

const MEMBER_DOT: Record<Member['color'], string> = {
  blue: 'bg-blue-500',
  pink: 'bg-red-500',
  emerald: 'bg-emerald-500',
  gray: 'bg-gray-400',
};

const toDraft = (contract: Contract): ContractDraft => ({
  kind: contract.kind,
  category: contract.category,
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

interface ContractModalProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  contract: Contract | null;
  members: Member[];
  /** 自分の family_members.id。新しい契約の見せる相手の初期値（自分だけ）。 */
  myMemberId: string | null;
  today: string;
  onClose: () => void;
  onSubmit: (draft: ContractDraft) => void;
  onDelete?: () => void;
  /** 「更新した」。新しい更新日を渡す。 */
  onRenew?: (renewsOn: string) => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

function Chip({ label, selected, onClick, dot }: { label: string; selected: boolean; onClick: () => void; dot?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-bold transition ${
        selected ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      {dot && <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />}
      {label}
    </button>
  );
}

export default function ContractModal({
  contract,
  members,
  myMemberId,
  today,
  onClose,
  onSubmit,
  onDelete,
  onRenew,
}: ContractModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState<ContractDraft>(() => (contract ? toDraft(contract) : emptyContractDraft(myMemberId)));
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
      .then((fields) => {
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
  }, [supabase, contractId]);

  const update = (patch: Partial<ContractDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const changeKind = (kind: ContractKind) => {
    // 新規のあいだだけ、種類に合わせて契約期間の初期値を入れる。
    if (!contract) {
      const term = DEFAULT_TERM_MONTHS[kind];
      setTermText(term === null ? '' : String(term));
      update({ kind, category: '', termMonths: term });
    } else {
      update({ kind, category: '' });
    }
  };

  const toggleNotifyDay = (day: number) =>
    update({
      notifyDays: draft.notifyDays.includes(day)
        ? draft.notifyDays.filter((value) => value !== day)
        : [...draft.notifyDays, day].sort((a, b) => b - a),
    });

  const toggleMember = (id: string) =>
    update({
      visibleMemberIds: draft.visibleMemberIds.includes(id)
        ? draft.visibleMemberIds.filter((value) => value !== id)
        : [...draft.visibleMemberIds, id],
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

  const handleDelete = () => {
    if (window.confirm('この契約を削除しますか？（そのほかの項目もすべて消えます）')) onDelete?.();
  };

  const termMonths = parseCount(termText);
  const canRenew = !!contract && !!onRenew && draft.renewsOn !== null && termMonths !== null;
  const unused = FIELD_SUGGESTIONS[draft.kind].filter((label) => !draft.fields.some((f) => f.label === label));

  return (
    <ModalShell
      title={contract ? '契約を編集' : '契約を追加'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!fieldsReady}
            className="w-full py-3 rounded-xl bg-teal-600 text-white font-bold hover:bg-teal-700 transition disabled:opacity-50"
          >
            {contract ? '保存する' : '追加する'}
          </button>
          {contract && onDelete && (
            <button type="button" onClick={handleDelete} className="w-full py-2 text-sm text-red-500">
              削除する
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <span className={labelClass}>種類</span>
          <Segmented
            options={CONTRACT_KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))}
            value={draft.kind}
            onChange={changeKind}
          />
        </div>

        <label className="block">
          <span className={labelClass}>名称</span>
          <input
            className={inputClass}
            value={draft.title}
            onChange={(event) => update({ title: event.target.value })}
            placeholder="例: ◯◯マンション 502"
          />
        </label>

        <label className="block">
          <span className={labelClass}>会社</span>
          <input
            className={inputClass}
            value={draft.company}
            onChange={(event) => update({ company: event.target.value })}
            placeholder="例: 管理会社・保険会社・サービス名"
          />
        </label>

        {CATEGORY_SUGGESTIONS[draft.kind].length > 0 && (
          <div>
            <label className="block">
              <span className={labelClass}>小分類</span>
              <input
                className={inputClass}
                value={draft.category}
                onChange={(event) => update({ category: event.target.value })}
                placeholder="例: 自動車"
              />
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CATEGORY_SUGGESTIONS[draft.kind].map((category) => (
                <Chip
                  key={category}
                  label={category}
                  selected={draft.category === category}
                  onClick={() => update({ category: draft.category === category ? '' : category })}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <span className={labelClass}>契約者</span>
          <div className="flex flex-wrap gap-1.5">
            <Chip label="指定なし" selected={draft.contractorId === null} onClick={() => update({ contractorId: null })} />
            {members.map((member) => (
              <Chip
                key={member.id}
                label={member.displayName}
                selected={draft.contractorId === member.id}
                onClick={() => update({ contractorId: member.id })}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <label className="block flex-1">
            <span className={labelClass}>開始日</span>
            <input
              type="date"
              className={inputClass}
              value={draft.startedOn ?? ''}
              onChange={(event) => update({ startedOn: event.target.value || null })}
            />
          </label>
          <label className="block flex-1">
            <span className={labelClass}>更新日</span>
            <input
              type="date"
              className={inputClass}
              value={draft.renewsOn ?? ''}
              onChange={(event) => update({ renewsOn: event.target.value || null })}
            />
          </label>
        </div>
        <p className="-mt-2 text-[11px] text-gray-400">
          更新日は、満了日・次の請求日でも構いません。空にするとお知らせは出ません。
        </p>

        <div className="flex items-end gap-3">
          <label className="block flex-1">
            <span className={labelClass}>契約期間（か月）</span>
            <input
              className={inputClass}
              value={termText}
              onChange={(event) => setTermText(event.target.value)}
              inputMode="numeric"
              placeholder="例: 24"
            />
          </label>
          {canRenew && (
            <button
              type="button"
              onClick={() => {
                const next = advanceRenewal(draft.renewsOn as string, termMonths as number, today);
                update({ renewsOn: next });
                onRenew?.(next);
              }}
              className="rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-2 text-[13px] font-bold text-teal-700 hover:bg-teal-100 transition"
            >
              更新した
            </button>
          )}
        </div>

        <div className="flex items-end gap-3">
          <label className="block flex-1">
            <span className={labelClass}>金額（円）</span>
            <input
              className={inputClass}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              inputMode="numeric"
              placeholder="例: 98000"
            />
          </label>
          <div className="w-36">
            <span className={labelClass}>周期</span>
            <Segmented
              options={CYCLES.map((cycle) => ({ value: cycle, label: CYCLE_LABEL[cycle] }))}
              value={draft.amountCycle ?? 'monthly'}
              onChange={(amountCycle) => update({ amountCycle })}
            />
          </div>
        </div>

        <div className="space-y-2 rounded-xl bg-gray-100 p-2.5">
          <span className={labelClass}>そのほかの項目</span>
          {draft.fields.map((field, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <input
                className={`${inputClass} !w-28 flex-none`}
                value={field.label}
                onChange={(event) => setField(index, { label: event.target.value })}
                placeholder="項目名"
              />
              <input
                className={inputClass}
                value={field.value}
                onChange={(event) => setField(index, { value: event.target.value })}
                placeholder="内容"
              />
              <button
                type="button"
                aria-label="この項目を消す"
                onClick={() => update({ fields: draft.fields.filter((_, i) => i !== index) })}
                className="flex-none p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {unused.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => addField(label)}
                className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[11px] font-bold text-teal-700 hover:bg-teal-100 transition"
              >
                ＋ {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => addField()}
              className="flex items-center gap-0.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[11px] font-bold text-teal-700 hover:bg-teal-100 transition"
            >
              <Plus size={12} />
              自由に追加
            </button>
          </div>
          <p className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">{FIELD_WARNING}</p>
        </div>

        <div>
          <span className={labelClass}>お知らせ（更新日の何日前）</span>
          <div className="flex flex-wrap gap-1.5">
            {NOTIFY_DAY_OPTIONS.map((day) => (
              <Chip
                key={day}
                label={`${day}日前`}
                selected={draft.notifyDays.includes(day)}
                onClick={() => toggleNotifyDay(day)}
              />
            ))}
          </div>
          {draft.notifyDays.length === 0 && <p className="mt-1 text-[11px] text-gray-400">お知らせは出しません。</p>}
        </div>

        <label className="block">
          <span className={labelClass}>メモ</span>
          <textarea
            className={`${inputClass} min-h-16`}
            value={draft.memo}
            onChange={(event) => update({ memo: event.target.value })}
          />
        </label>

        <div>
          <span className={labelClass}>見せる相手（複数選べます）</span>
          <div className="flex flex-wrap gap-1.5">
            {members.map((member) => (
              <Chip
                key={member.id}
                label={member.displayName}
                dot={MEMBER_DOT[member.color]}
                selected={draft.visibleMemberIds.includes(member.id)}
                onClick={() => toggleMember(member.id)}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            作った人は、選ばなくても見られます。子はアカウントを作るまで見られません。
          </p>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
