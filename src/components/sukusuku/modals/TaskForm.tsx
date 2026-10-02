'use client';

import { BellRing, Clock, Lock, MapPin, Repeat, Star, Text, Users, X } from 'lucide-react';
import type { AnchorType, Participant, Recurrence, RecurrenceFreq, Task, TaskKind } from '@/types/app';
import { participantNames, useFamilyRoster } from '@/lib/familyRoster';
import { useBackLayer } from '@/lib/browserHistory';
import { REMINDER_OPTIONS, WEEKDAY_LABELS, parseDateString, toDateString } from '@/lib/dateUtils';
import { getParticipantColor } from '@/lib/uiUtils';
import { END_TYPE_OPTIONS, FREQ_OPTIONS, defaultRecurrence, summarizeRecurrence } from '@/lib/recurrence';

// 予定・タスクの入力欄（追加・編集で共通）。Googleカレンダーの追加画面に
// ならい、種別（予定/タスク）をまず選び、予定のときだけ場所・参加者を持つ。
//
// 「ゲスト」にあたる欄は、外部の相手を招待する仕組みではなく、家族の誰の
// 予定かを複数選べる「参加者」にしている（この家族アプリでは招待する相手が
// 常に家族の誰かのため）。ビデオ会議の追加やカレンダー選択のような、
// この家族には要らない項目は作らない。
// 出す中身と並びはmobile版（mobile/src/components/schedule/TaskForm.tsx）と同じ。
export type TaskDraft = Omit<Task, 'id' | 'done'>;

interface TaskFormProps {
  value: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  // 誕生日が未登録のときだけ「生後日数で指定」を選べるようにする
  allowBirthRelative: boolean;
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

export default function TaskForm({ value, onChange, allowBirthRelative }: TaskFormProps) {
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
  // 生後日数での指定は、誕生日登録前でも作れるタスク（例:「生後14日: 出生届提出」）のためのもの。
  // 予定はこの指定を持たない。
  const showAnchorChoice = !isEvent && (allowBirthRelative || value.anchorType === 'birth_relative');

  const setKind = (kind: TaskKind) => {
    // タスクは場所・参加者・時刻を持たないため、予定へ戻したときのために
    // 参加者は残すが、タスクにするときは終日へ寄せる。
    // 予定は生後日数指定を持たないため、予定に切り替えたときは日付指定へ戻す。
    if (kind === 'task') {
      set({ kind, startTime: null, endTime: null });
    } else {
      set(value.anchorType === 'birth_relative' ? { kind, anchorType: 'absolute' } : { kind });
    }
  };

  const setAnchorType = (anchorType: AnchorType) => {
    set({ anchorType });
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

  // 繰り返し。null は「繰り返さない」。オンにした瞬間だけ既定値を入れる。
  const recurrence = value.recurrence;

  const toggleRecurring = () => {
    set({ recurrence: recurrence ? null : defaultRecurrence(value.startDate) });
  };

  const setFreq = (freq: RecurrenceFreq) => {
    if (!recurrence) return;
    // 週間ごと以外は曜日選択を持たない。週間ごとへ戻したときのために
    // 選んでいた曜日が空なら、日付の曜日を初期値にする。
    const byWeekday =
      freq === 'weekly'
        ? recurrence.byWeekday && recurrence.byWeekday.length > 0
          ? recurrence.byWeekday
          : startDate
            ? [startDate.getDay()]
            : []
        : undefined;
    set({ recurrence: { ...recurrence, freq, byWeekday } });
  };

  const setIntervalValue = (text: string) => {
    if (!recurrence) return;
    const parsed = Math.floor(Number(text));
    set({ recurrence: { ...recurrence, interval: parsed > 0 ? parsed : 1 } });
  };

  const toggleWeekday = (day: number) => {
    if (!recurrence) return;
    const current = recurrence.byWeekday ?? [];
    const byWeekday = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    set({ recurrence: { ...recurrence, byWeekday } });
  };

  const setEndType = (type: Recurrence['end']['type']) => {
    if (!recurrence) return;
    const end: Recurrence['end'] =
      type === 'never'
        ? { type: 'never' }
        : type === 'until'
          ? {
              type: 'until',
              date: recurrence.end.type === 'until' ? recurrence.end.date : (value.startDate ?? toDateString(new Date())),
            }
          : { type: 'count', count: recurrence.end.type === 'count' ? recurrence.end.count : 1 };
    set({ recurrence: { ...recurrence, end } });
  };

  const setEndDate = (date: string) => {
    if (!recurrence || recurrence.end.type !== 'until' || !date) return;
    set({ recurrence: { ...recurrence, end: { type: 'until', date } } });
  };

  const setEndCount = (text: string) => {
    if (!recurrence || recurrence.end.type !== 'count') return;
    const parsed = Math.floor(Number(text));
    set({ recurrence: { ...recurrence, end: { type: 'count', count: parsed > 0 ? parsed : 1 } } });
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
        {showAnchorChoice && (
          <div className={SWITCHER}>
            <button
              type="button"
              onClick={() => setAnchorType('absolute')}
              className={switcherTab(value.anchorType === 'absolute')}
            >
              日付を指定
            </button>
            <button
              type="button"
              onClick={() => setAnchorType('birth_relative')}
              className={switcherTab(value.anchorType === 'birth_relative')}
            >
              生後日数で指定
            </button>
          </div>
        )}

        {value.anchorType === 'absolute' ? (
          <input
            type="date"
            value={value.startDate ?? ''}
            onChange={(e) => set({ startDate: e.target.value || null })}
            className={FIELD}
          />
        ) : (
          <div className="flex items-center border border-gray-300 rounded-lg p-2.5">
            <span className="text-sm text-gray-500 mr-2">生後</span>
            <input
              type="number"
              min={0}
              value={value.daysAfterBirth}
              onChange={(e) => set({ daysAfterBirth: Number(e.target.value) || 0 })}
              className="flex-1 text-sm outline-none text-gray-800 bg-transparent"
            />
            <span className="text-sm text-gray-500 ml-2">日</span>
          </div>
        )}
      </div>

      {/* 繰り返し。予定・タスクどちらにも設定できる。既定は「繰り返さない」で、
          オンのときだけ間隔・曜日・終了条件を出す（Googleカレンダーの
          「カスタムの繰り返し」と同じ形）。 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs font-medium text-gray-700">
            <Repeat size={14} className="mr-1.5 text-gray-400" /> 繰り返し
          </span>
          <Toggle label="繰り返しの切り替え" on={recurrence !== null} onClick={toggleRecurring} />
        </div>

        {recurrence && (
          <div className="border border-gray-200 rounded-lg p-3 space-y-3">
            {/* 繰り返す間隔 */}
            <div>
              <span className="block text-[11px] font-medium text-gray-500 mb-1">繰り返す間隔</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={recurrence.interval}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  aria-label="繰り返す間隔"
                  className="w-16 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 text-gray-800"
                />
                <select
                  value={recurrence.freq}
                  onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}
                  aria-label="繰り返しの単位"
                  className="flex-1 border border-gray-300 rounded-lg p-2 text-sm outline-none bg-white text-gray-800 focus:border-blue-500"
                >
                  {FREQ_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 曜日（週間ごとのときだけ。複数選べる） */}
            {recurrence.freq === 'weekly' && (
              <div>
                <span className="block text-[11px] font-medium text-gray-500 mb-1">曜日</span>
                <div className="flex gap-1">
                  {WEEKDAY_LABELS.map((label, day) => {
                    const selected = (recurrence.byWeekday ?? []).includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleWeekday(day)}
                        className={`flex-1 py-1.5 rounded-full text-xs font-bold border transition ${
                          selected ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-500 border-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 終了日。なし/終了日を指定/回数を指定の3択。 */}
            <div>
              <span className="block text-[11px] font-medium text-gray-500 mb-1">終了日</span>
              {END_TYPE_OPTIONS.map((option) => {
                const selected = recurrence.end.type === option.value;
                return (
                  <div key={option.value} className="mb-1">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="recurrence-end"
                        checked={selected}
                        onChange={() => setEndType(option.value)}
                      />
                      {option.label}
                    </label>
                    {option.value === 'until' && selected && recurrence.end.type === 'until' && (
                      <input
                        type="date"
                        value={recurrence.end.date}
                        onChange={(e) => setEndDate(e.target.value)}
                        aria-label="終了日"
                        className={`${FIELD} mt-1`}
                      />
                    )}
                    {option.value === 'count' && selected && recurrence.end.type === 'count' && (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="number"
                          min={1}
                          value={recurrence.end.count}
                          onChange={(e) => setEndCount(e.target.value)}
                          aria-label="繰り返す回数"
                          className="w-16 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 text-gray-800"
                        />
                        <span className="text-sm text-gray-500">回</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-gray-500">{summarizeRecurrence(recurrence)}</p>
          </div>
        )}
      </div>

      {/* 時刻（予定のみ。タスクは日付だけを持つ） */}
      {isEvent && (
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
              <span className="text-gray-400 text-sm">-</span>
              <input
                type="time"
                value={value.endTime ?? ''}
                onChange={(e) => set({ endTime: e.target.value || null })}
                aria-label="終わりの時刻"
                className={`flex-1 ${FIELD}`}
              />
            </div>
          )}
        </div>
      )}

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

      {/* リマインダー */}
      <div>
        <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
          <BellRing size={14} className="mr-1.5 text-gray-400" /> リマインダー
        </span>
        <select
          value={value.remindMinutesBefore === null ? '' : String(value.remindMinutesBefore)}
          onChange={(e) => set({ remindMinutesBefore: e.target.value === '' ? null : Number(e.target.value) })}
          className={FIELD}
        >
          {REMINDER_OPTIONS.map((option) => (
            <option key={option.label} value={option.value === null ? '' : String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
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
