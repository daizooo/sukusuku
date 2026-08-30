'use client';

import { useState } from 'react';
import { CalendarDays, Check, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import type { Nursery, NurseryChecklist } from '@/types/app';
import { checkGroupsFor, checkItemNumber, checkTotalFor, countChecked } from '@/lib/nurseryChecklist';
import { formatDateWithWeekday, parseDateString } from '@/lib/dateUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import NurseryFormModal, { type NurseryDraft } from '../modals/NurseryFormModal';

// 園ごとに「基本情報」と「見学チェックリスト」を分けて表示する。
// 見学当日はチェックリストだけを見たいので、連絡先や見学日時と同じ画面に混ぜない。
type HokatsuView = 'basic' | 'checklist';

interface HokatsuTabProps {
  nurseries: Nursery[];
  isLoadingNurseries?: boolean;
  onAddNursery: (draft: NurseryDraft) => void;
  onUpdateNursery: (nursery: Nursery, draft: NurseryDraft) => void;
  onDeleteNursery: (id: string) => void;
  onAddDefaultNurseries: () => void;
}

const toDraft = (nursery: Nursery): NurseryDraft => ({
  name: nursery.name,
  address: nursery.address,
  status: nursery.status,
  phone: nursery.phone,
  visitDate: nursery.visitDate,
  visitTime: nursery.visitTime,
  memo: nursery.memo,
  checklist: nursery.checklist,
});

const statusClass = (status: Nursery['status']) =>
  status === '見学済' ? 'bg-green-100 text-green-700' : status === '未見学' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700';

/**
 * 中身の切り替えに使う下線タブ。園の切り替え(SegmentedTabs)と重ねても、
 * どちらが上位の切り替えなのかが見た目で分かるように、こちらは帯を持たせない。
 */
function UnderlineTabs({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { id: HokatsuView; label: string; badge?: string; badgeDone?: boolean }[];
  value: HokatsuView;
  onChange: (id: HokatsuView) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex border-b border-gray-200">
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={`relative flex items-center min-h-9 pb-2 mr-6 text-sm font-bold transition ${
              selected ? 'text-blue-600' : 'text-gray-500'
            }`}
          >
            {option.label}
            {option.badge && (
              <span
                className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  option.badgeDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {option.badge}
              </span>
            )}
            {/* 下線は選んでいるタブの幅ぶんだけ引く。枠線(border-b)に重ねて太らせない。 */}
            <span className={`absolute left-0 right-0 -bottom-px h-0.5 rounded-full ${selected ? 'bg-blue-500' : 'bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
}

/** 基本情報の1行。値が空のときは「未登録」と分かるよう薄く出す。 */
function InfoRow({ icon, label, children, empty }: { icon: React.ReactNode; label: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="flex items-start px-4 py-3 border-b border-gray-100 last:border-b-0">
      <span className="w-5 mt-0.5 text-gray-400 shrink-0">{icon}</span>
      <span className="w-16 text-xs text-gray-500 shrink-0 mt-0.5">{label}</span>
      <span className={`flex-1 text-sm ${empty ? 'text-gray-400' : 'text-gray-800'}`}>{children}</span>
    </div>
  );
}

/**
 * チェックリストの1項目。メモは打つたびに保存すると重いので、入力中は手元で持ち、
 * 入力を終えた（フォーカスが外れた）ときにだけ保存する。
 * 園を切り替えたときに前の園のメモが残らないよう、呼び出し側で key に園のidを含める。
 */
function CheckItemCard({
  number,
  title,
  point,
  targetLabel,
  checked,
  memo,
  onToggle,
  onCommitMemo,
}: {
  number: number;
  title: string;
  point: string;
  /** この園だけで確認する項目のときの園名（例: 'くすのき・和光'） */
  targetLabel?: string;
  checked: boolean;
  memo: string;
  onToggle: () => void;
  onCommitMemo: (memo: string) => void;
}) {
  const [draftMemo, setDraftMemo] = useState(memo);

  return (
    <div className={`rounded-xl border p-3 transition ${checked ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
      <button onClick={onToggle} className="w-full flex items-start text-left">
        <span
          className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 mr-2 ${
            checked ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300 text-transparent'
          }`}
        >
          <Check size={14} strokeWidth={3} />
        </span>
        <span>
          <span className="block text-sm font-bold text-gray-800 leading-tight">
            <span className="text-gray-400 mr-1">{number}.</span>
            {title}
          </span>
          {targetLabel && (
            <span className="inline-block text-[10px] font-bold text-orange-600 bg-orange-50 rounded px-1.5 py-0.5 mt-1">
              {targetLabel}
            </span>
          )}
          <span className="block text-[11px] text-gray-500 leading-relaxed mt-1">{point}</span>
        </span>
      </button>
      <textarea
        value={draftMemo}
        onChange={(e) => setDraftMemo(e.target.value)}
        onBlur={() => {
          if (draftMemo !== memo) onCommitMemo(draftMemo);
        }}
        placeholder="聞いたこと・気になったこと"
        className="w-full mt-2 border border-gray-200 rounded-lg p-2 text-xs outline-none focus:border-blue-500 h-14 resize-none bg-white"
      />
    </div>
  );
}

export default function HokatsuTab({
  nurseries,
  isLoadingNurseries,
  onAddNursery,
  onUpdateNursery,
  onDeleteNursery,
  onAddDefaultNurseries,
}: HokatsuTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<HokatsuView>('basic');
  const [nurseryModal, setNurseryModal] = useState<{ mode: 'add' | 'edit'; nursery: Nursery | null } | null>(null);

  // 選んでいた園が消えた場合や、まだ何も選んでいない場合は先頭の園を出す。
  const selected = nurseries.find((n) => n.id === selectedId) ?? nurseries[0] ?? null;

  const saveChecklist = (nursery: Nursery, checklist: NurseryChecklist) => onUpdateNursery(nursery, { ...toDraft(nursery), checklist });

  const setCheck = (nursery: Nursery, itemId: string, patch: Partial<NurseryChecklist[string]>) => {
    const current = nursery.checklist[itemId] ?? { checked: false, memo: '' };
    saveChecklist(nursery, { ...nursery.checklist, [itemId]: { ...current, ...patch } });
  };

  const visitDate = selected ? parseDateString(selected.visitDate ?? '') : null;
  // チェックリストの項目は園ごとに変わる（浸水想定区域か、宗教行事があるか）ので、
  // 出す項目も分母も選んでいる園から決める。
  const checkGroups = selected ? checkGroupsFor(selected.name) : [];
  const checkedCount = selected ? countChecked(selected.checklist, selected.name) : 0;
  const checkTotal = selected ? checkTotalFor(selected.name) : 0;

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      {/* 上段は園の切り替え、下段は基本情報とチェックリストの切り替え。どちらも固定し、
          スクロールするのは中身だけにする。
          2つの切り替えは見た目を変える（上はピル、下は下線タブ）。同じ形の帯が2段並ぶと
          どちらが園でどちらが中身の切り替えなのか読み取れないため。 */}
      {nurseries.length > 0 && (
        <div className="shrink-0 space-y-2 mb-3">
          <div className="flex items-center gap-2">
            <SegmentedTabs
              ariaLabel="保育園の切り替え"
              value={selected?.id ?? ''}
              onChange={setSelectedId}
              className="flex-1 min-w-0"
              options={nurseries.map((nursery) => ({ id: nursery.id, label: nursery.name }))}
            />
            <button
              onClick={() => setNurseryModal({ mode: 'add', nursery: null })}
              aria-label="保育園を追加"
              className="flex-none text-blue-500 bg-blue-50 p-2 rounded-full hover:bg-blue-100 transition"
            >
              <Plus size={20} />
            </button>
          </div>
          <UnderlineTabs
            ariaLabel="保活の表示"
            value={view}
            onChange={setView}
            options={[
              { id: 'basic', label: '基本情報' },
              {
                id: 'checklist',
                label: '見学チェックリスト',
                // 進み具合はラベルに続けず、小さなバッジに逃がす（狭い画面で文字が詰まらないように）。
                badge: `${checkedCount}/${checkTotal}`,
                badgeDone: checkedCount === checkTotal,
              },
            ]}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoadingNurseries && <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>}

        {!isLoadingNurseries && nurseries.length === 0 && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-gray-400">保育園の記録はまだありません</p>
            <button
              onClick={onAddDefaultNurseries}
              className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 hover:bg-blue-100 transition"
            >
              見学候補の3園を追加
              <span className="block font-normal text-[10px] text-blue-400 mt-1">舞原保育園・くすのき保育園・和光こども園</span>
            </button>
            <button
              onClick={() => setNurseryModal({ mode: 'add', nursery: null })}
              className="block mx-auto text-xs font-bold text-gray-500 px-4 py-2"
            >
              自分で園を追加する
            </button>
          </div>
        )}

        {selected && view === 'basic' && (
          <div className="space-y-3 pb-6">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${statusClass(selected.status)}`}>{selected.status}</span>
                <button
                  onClick={() => setNurseryModal({ mode: 'edit', nursery: selected })}
                  className="flex items-center text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition"
                >
                  <Pencil size={13} className="mr-1" /> 編集
                </button>
              </div>
              <InfoRow icon={<MapPin size={14} />} label="住所" empty={!selected.address}>
                {selected.address || '未登録'}
              </InfoRow>
              <InfoRow icon={<Phone size={14} />} label="電話" empty={!selected.phone}>
                {selected.phone ? (
                  <a href={`tel:${selected.phone}`} className="text-blue-500 font-medium">
                    {selected.phone}
                  </a>
                ) : (
                  '未登録'
                )}
              </InfoRow>
              <InfoRow icon={<CalendarDays size={14} />} label="見学" empty={!visitDate}>
                {visitDate ? (
                  <span className="font-bold">{`${formatDateWithWeekday(visitDate)}${selected.visitTime ? ` ${selected.visitTime}〜` : ''}`}</span>
                ) : (
                  '日時は未定'
                )}
              </InfoRow>
            </div>
            {selected.memo && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <strong className="block text-[10px] text-gray-400 mb-1.5">メモ</strong>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{selected.memo}</p>
              </div>
            )}
          </div>
        )}

        {selected && view === 'checklist' && (
          <div className="space-y-4 pb-6">
            <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl text-xs text-orange-800 leading-relaxed">
              見学当日の流れ順に並べています。園によって確認する項目が変わります。チェックとメモはその場で保存されます。
            </div>
            {checkGroups.map((group) => (
              <div key={group.id} className="space-y-2">
                <p className="text-[11px] font-bold text-gray-400">{group.title}</p>
                {group.note && <p className="text-[10px] text-gray-400 -mt-1">{group.note}</p>}
                {group.items.map((item) => {
                  const state = selected.checklist[item.id];
                  const checked = state?.checked ?? false;
                  return (
                    <CheckItemCard
                      key={`${selected.id}-${item.id}`}
                      number={checkItemNumber(item.id, selected.name)}
                      title={item.title}
                      point={item.point}
                      targetLabel={item.target?.label}
                      checked={checked}
                      memo={state?.memo ?? ''}
                      onToggle={() => setCheck(selected, item.id, { checked: !checked })}
                      onCommitMemo={(memo) => setCheck(selected, item.id, { memo })}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <NurseryFormModal
        key={`nursery-${nurseryModal ? `${nurseryModal.mode}-${nurseryModal.nursery?.id ?? 'new'}` : 'none'}`}
        mode={nurseryModal?.mode ?? null}
        nursery={nurseryModal?.nursery ?? null}
        onClose={() => setNurseryModal(null)}
        onSubmit={(draft) => {
          if (nurseryModal?.mode === 'edit' && nurseryModal.nursery) {
            onUpdateNursery(nurseryModal.nursery, draft);
          } else {
            onAddNursery(draft);
          }
          setNurseryModal(null);
        }}
        onDelete={(id) => {
          onDeleteNursery(id);
          if (selectedId === id) setSelectedId(null);
          setNurseryModal(null);
        }}
      />
    </div>
  );
}
