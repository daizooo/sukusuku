'use client';

import { BellRing, Clock, MapPin, Tag, Text, X } from 'lucide-react';
import type { AnchorType, Label, Task } from '@/types/app';
import { LABELS } from '@/types/app';
import { REMINDER_OPTIONS } from '@/lib/dateUtils';
import { getLabelColor } from '@/lib/uiUtils';

// 予定の入力欄（追加・編集で共通）
export type TaskDraft = Omit<Task, 'id' | 'done'>;

interface TaskFormProps {
  value: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  // 誕生日が未登録のときだけ「生後日数で指定」を選べるようにする
  allowBirthRelative: boolean;
}

export default function TaskForm({ value, onChange, allowBirthRelative }: TaskFormProps) {
  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });

  const isAllDay = value.startTime === null;
  const showAnchorChoice = allowBirthRelative || value.anchorType === 'birth_relative';

  const setAnchorType = (anchorType: AnchorType) => {
    set({ anchorType });
  };

  const toggleAllDay = () => {
    // 終日 <-> 時刻あり。時刻ありに切り替えたときは 09:00 を初期値にする。
    set(isAllDay ? { startTime: '09:00', endTime: null } : { startTime: null, endTime: null });
  };

  return (
    <div className="space-y-4">
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
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setAnchorType('absolute')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                value.anchorType === 'absolute' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              日付を指定
            </button>
            <button
              type="button"
              onClick={() => setAnchorType('birth_relative')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                value.anchorType === 'birth_relative' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
              }`}
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
            className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white text-gray-800"
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

      {/* 時刻 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center text-xs font-medium text-gray-700">
            <Clock size={14} className="mr-1.5 text-gray-400" /> 終日
          </span>
          <button
            type="button"
            onClick={toggleAllDay}
            aria-label="終日の切り替え"
            className={`w-11 h-6 rounded-full relative transition-colors ${isAllDay ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <div
              className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${isAllDay ? 'left-5.5' : 'left-0.5'}`}
            />
          </button>
        </div>
        {!isAllDay && (
          <div className="flex items-center space-x-2">
            <input
              type="time"
              value={value.startTime ?? ''}
              onChange={(e) => set({ startTime: e.target.value || null })}
              className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white text-gray-800"
            />
            <span className="text-gray-400 text-sm">-</span>
            <input
              type="time"
              value={value.endTime ?? ''}
              onChange={(e) => set({ endTime: e.target.value || null })}
              className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white text-gray-800"
            />
          </div>
        )}
      </div>

      {/* ラベル */}
      <div>
        <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
          <Tag size={14} className="mr-1.5 text-gray-400" /> ラベル
        </span>
        <div className="flex space-x-2">
          {LABELS.map((label: Label) => (
            <button
              key={label}
              type="button"
              onClick={() => set({ label })}
              className={`flex-1 py-2 rounded-lg text-xs font-bold border transition ${
                value.label === label ? getLabelColor(label) : 'bg-white text-gray-500 border-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 場所 */}
      <div>
        <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
          <MapPin size={14} className="mr-1.5 text-gray-400" /> 場所
        </span>
        <input
          type="text"
          value={value.place}
          onChange={(e) => set({ place: e.target.value })}
          className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 text-gray-800"
          placeholder="例: 城南まちづくりセンター"
        />
      </div>

      {/* 詳細（持ち物もここにまとめて書く） */}
      <div>
        <span className="flex items-center text-xs font-medium text-gray-700 mb-1.5">
          <Text size={14} className="mr-1.5 text-gray-400" /> 詳細
        </span>
        <textarea
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
          className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none h-24 resize-none focus:border-blue-500 text-gray-800"
          placeholder="メモ・持ち物（母子手帳、印鑑など）を入力"
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
          className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none bg-white text-gray-800 focus:border-blue-500"
        >
          {REMINDER_OPTIONS.map((option) => (
            <option key={option.label} value={option.value === null ? '' : String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
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
