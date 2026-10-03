'use client';

import { useState } from 'react';
import { Clock, Lock, MapPin, Repeat, Star, Text, Users, X } from 'lucide-react';
import type { Participant, Task, TaskKind } from '@/types/app';
import { participantNames, useFamilyRoster } from '@/lib/familyRoster';
import { useBackLayer } from '@/lib/browserHistory';
import { parseDateString } from '@/lib/dateUtils';
import { getParticipantColor } from '@/lib/uiUtils';
import {
  defaultRecurrence,
  findPresetKey,
  recurrencePresets,
  summarizeRecurrence,
  type RecurrencePresetKey,
} from '@/lib/recurrence';
import RecurrenceModal from './RecurrenceModal';

// 予定・タスクの入力欄（追加・編集で共通）。Googleカレンダーの追加画面に
// ならい、種別（予定/タスク）をまず選び、予定のときだけ場所・参加者を持つ。
//
// 「ゲスト」にあたる欄は、外部の相手を招待する仕組みではなく、家族の誰の
// 予定かを複数選べる「参加者」にしている（この家族アプリでは招待する相手が
// 常に家族の誰かのため）。ビデオ会議の追加やカレンダー選択のような、
// この家族には要らない項目は作らない。
//
// 繰り返しはGoogleカレンダーと同じく、開始日から決まる定番の選択肢（毎日・毎週 金曜日・
// 毎月 第1金曜日・毎年 10月2日・毎週平日）＋「カスタム…」（RecurrenceModal）で選ぶ。
// 通知の設定は持たない。予定・タスクとも、設定した日時に必ず通知する（時刻が無い
// ものは終日として朝9時。docs/calendar.md §5）。
// 出す中身と並びはmobile版（mobile/src/components/schedule/TaskForm.tsx）と同じ。
export type TaskDraft = Omit<Task, 'id' | 'done' | 'doneDates'>;

interface TaskFormProps {
  value: TaskDraft;
  onChange: (draft: TaskDraft) => void;
}

const KIND_TABS: { value: TaskKind; label: string }[] = [
  { value: 'event', label: '予定' },
  { value: 'task', label: 'タスク' },
];

const SHARING_TABS: { value: boolean; label: string }[] = [
  { value: false, label: '共有（家族全員）' },
  { value: true, label: '自分だけ' },
];

const SWITCHER = 'flex bg-gray-100 p-1 rounded-lg';
const switcherTab = (selected: boolean) =>
  `flex-1 py-1.5 text-xs font-medium rounded-md transition ${
    selected ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
  }`;
const FIELD =
  'w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white text-gray-800';

export default function TaskForm({ value, onChange }: TaskFormProps) {
  // 参加者として選べるのは家族メンバー（設定タブの「家族」の表示名の並び）。
  const roster = useFamilyRoster();
  // 予定に入っているが家族にいない名前（前の名前など）も、外せるように並べておく。
  const participantOptions = [
    ...participantNames(roster),
    ...value.participants.filter((name) => !participantNames(roster).includes(name)),
  ];
  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });

  const isEvent = value.kind === 'event';
  const isAllDay = value.startTime === null;

  const setKind = (kind: TaskKind) => {
    // タスクは場所・参加者・終わりの時刻を持たない。予定へ戻したときのために
    // 参加者は残し、タスクにするときは終わりの時刻だけ外す（始まりの時刻は残る）。
    // 生後日数指定は新しく作れない（古いタスクに残るだけ）。予定に切り替えたときは日付指定へ戻す。
    if (kind === 'task') {
      set({ kind, endTime: null });
    } else {
      set(value.anchorType === 'birth_relative' ? { kind, anchorType: 'absolute' } : { kind });
    }
  };

  const toggleAllDay = () => {
    // 終日 <-> 時刻あり。時刻ありに切り替えたときは 09:00 を初期値にする。
    set(isAllDay ? { startTime: '09:00', endTime: null } : { startTime: null, endTime: null });
  };

  // 参加者欄は1つのボタン列で「未選択→参加者→主体→未選択」の3段階を順に切り替える。
  // 主体(owner)は色分けの基準になる1人だけ。既に主体の誰かがいるところで別の人を
  // 主体にすると、入れ替わった元の主体は参加者のまま残る（参加者からは外れない）。
  const cycleParticipant = (participant: Participant) => {
    const isOwner = value.owner === participant;
    const isParticipant = value.participants.includes(participant);
    if (isOwner) {
      set({ owner: null, participants: value.participants.filter((p) => p !== participant) });
    } else if (isParticipant) {
      set({ owner: participant });
    } else {
      set({ participants: [...value.participants, participant] });
    }
  };

  const startDate = parseDateString(value.startDate ?? '');

  // 繰り返し。null は「繰り返さない」。選択肢はGoogleカレンダーと同じ定番＋カスタム。
  const recurrence = value.recurrence;
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  // 日付が決まらない（古い生後日数指定のタスクで、まだ日付を選んでいない）ときは繰り返しの欄を出さない。
  const baseDate = startDate;
  const presets = baseDate ? recurrencePresets(baseDate) : [];
  const currentPresetKey = baseDate ? findPresetKey(recurrence, baseDate) : null;

  // 開始日を変えたとき、定番の選択肢（毎週 金曜日 など）を選んでいたなら、
  // 新しい日付の曜日・日付に合わせ直す（Googleカレンダーと同じ）。カスタムはそのまま。
  const setStartDate = (next: string | null) => {
    const nextDate = parseDateString(next ?? '');
    if (recurrence && baseDate && nextDate && currentPresetKey) {
      const preset = recurrencePresets(nextDate).find((p) => p.key === currentPresetKey);
      set({ startDate: next, anchorType: 'absolute', recurrence: preset?.recurrence ?? recurrence });
      return;
    }
    // 古い生後日数指定のタスクも、日付を選び直したら日付指定になる。
    set({ startDate: next, anchorType: 'absolute' });
  };

  // 選択欄には、定番に当たらないカスタムの設定も1行（現在の要約）として並べる。
  const recurrenceSelected: RecurrencePresetKey | 'current' = currentPresetKey ?? (recurrence ? 'current' : 'none');

  const pickRecurrence = (key: string) => {
    if (key === 'current') return;
    if (key === 'custom') {
      setIsCustomOpen(true);
      return;
    }
    set({ recurrence: presets.find((p) => p.key === key)?.recurrence ?? null });
  };

  return (
    <div className="space-y-4">
      {/* 種別（予定/タスク） */}
      <div className={SWITCHER}>
        {KIND_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={value.kind === tab.value}
            onClick={() => setKind(tab.value)}
            className={switcherTab(value.kind === tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        <input
          type="text"
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          className="w-full border-b-2 border-gray-200 pb-2 text-lg font-medium text-gray-800 outline-none focus:border-blue-500 placeholder:text-gray-300 bg-transparent"
          placeholder="タイトルを入力"
        />
      </div>

      {/* 日付 */}
      <div className="space-y-2">
        <input
          type="date"
          value={value.startDate ?? ''}
          onChange={(e) => setStartDate(e.target.value || null)}
          className={FIELD}
        />
      </div>

      {/* 繰り返し。予定・タスクどちらにも設定できる。Googleカレンダーと同じく、
          定番の選択肢と「カスタム…」から選ぶ。日付が決まらないときは出さない。 */}
      {baseDate && (
        <div>
          <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
            <Repeat size={14} className="mr-1.5 text-gray-400" /> 繰り返し
          </span>
          <select
            value={recurrenceSelected}
            onChange={(e) => pickRecurrence(e.target.value)}
            aria-label="繰り返し"
            className={FIELD}
          >
            {recurrence && currentPresetKey === null && (
              <option value="current">{summarizeRecurrence(recurrence, value.startDate)}</option>
            )}
            {presets.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
            <option value="custom">カスタム…</option>
          </select>
        </div>
      )}
      {isCustomOpen && (
        <RecurrenceModal
          initial={recurrence ?? defaultRecurrence(value.startDate)}
          startDate={value.startDate}
          onCancel={() => setIsCustomOpen(false)}
          onDone={(next) => {
            set({ recurrence: next });
            setIsCustomOpen(false);
          }}
        />
      )}

      {/* 時刻（予定・タスクとも）。タスクは終わりの時刻を持たず、始まりの時刻だけ。
          時刻を決めたものはその時刻に、終日のものは朝9時に通知する。 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs font-medium text-gray-700">
            <Clock size={14} className="mr-1.5 text-gray-400" /> 終日
          </span>
          <Toggle label="終日の切り替え" on={isAllDay} onClick={toggleAllDay} />
        </div>
        {!isAllDay && (
          <div className="flex items-center space-x-2">
            <input
              type="time"
              value={value.startTime ?? ''}
              onChange={(e) => set({ startTime: e.target.value || null })}
              aria-label="始まりの時刻"
              className={`flex-1 ${FIELD}`}
            />
            {isEvent && (
              <>
                <span className="text-gray-400 text-sm">-</span>
                <input
                  type="time"
                  value={value.endTime ?? ''}
                  onChange={(e) => set({ endTime: e.target.value || null })}
                  aria-label="終わりの時刻"
                  className={`flex-1 ${FIELD}`}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* 参加者（予定のみ）。1つのボタンで参加者/主体を兼ねる:
          タップで参加者に追加 → もう一度タップでその人を主体に(★付き・色付き) →
          もう一度タップで外れる。 */}
      {isEvent && (
        <div>
          <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
            <Users size={14} className="mr-1.5 text-gray-400" /> 参加者
          </span>
          <div className="flex space-x-2">
            {participantOptions.map((participant) => {
              const isOwner = value.owner === participant;
              const isParticipant = value.participants.includes(participant);
              return (
                <button
                  key={participant}
                  type="button"
                  aria-pressed={isParticipant}
                  aria-label={`${participant}${isOwner ? '（主体）' : ''}`}
                  onClick={() => cycleParticipant(participant)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border transition flex items-center justify-center gap-1 ${
                    isOwner
                      ? getParticipantColor(participant)
                      : isParticipant
                        ? 'bg-gray-100 text-gray-700 border-gray-300'
                        : 'bg-white text-gray-500 border-gray-200'
                  }`}
                >
                  {isOwner && <Star size={11} fill="currentColor" />}
                  {participant}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">タップで参加者に、もう一度タップで★主体に</p>
        </div>
      )}

      {/* 場所（予定のみ） */}
      {isEvent && (
        <div>
          <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
            <MapPin size={14} className="mr-1.5 text-gray-400" /> 場所
          </span>
          <input
            type="text"
            value={value.place}
            onChange={(e) => set({ place: e.target.value })}
            className={FIELD}
            placeholder="場所を入力"
          />
        </div>
      )}

      {/* 詳細（持ち物もここにまとめて書く） */}
      <div>
        <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
          <Text size={14} className="mr-1.5 text-gray-400" /> 詳細
        </span>
        <textarea
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none h-24 resize-none focus:border-blue-500 text-gray-800"
          placeholder="詳細を入力"
        />
      </div>

      {/* 共有設定。自分だけにすると、家族の他のメンバーには表示されなくなる。 */}
      <div>
        <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
          <Lock size={14} className="mr-1.5 text-gray-400" /> 共有設定
        </span>
        <div className={SWITCHER}>
          {SHARING_TABS.map((tab) => (
            <button
              key={String(tab.value)}
              type="button"
              aria-pressed={value.isPrivate === tab.value}
              onClick={() => set({ isPrivate: tab.value })}
              className={switcherTab(value.isPrivate === tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// オン/オフの切り替えスイッチ
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-blue-500' : 'bg-gray-300'}`}
    >
      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${on ? 'left-5.5' : 'left-0.5'}`} />
    </button>
  );
}

// 追加・編集モーダルの外枠
interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}

export function ModalShell({ title, onClose, children, footer }: ModalShellProps) {
  // 戻る操作（ブラウザ・スマホ）でこのモーダルを閉じる。
  useBackLayer(onClose);

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center px-5 py-3 border-b border-gray-100 flex-none">
          <h3 className="font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex-none px-5 py-3 border-t border-gray-100 pb-6 sm:pb-3">{footer}</div>
      </div>
    </div>
  );
}
