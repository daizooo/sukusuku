'use client';

import {
  BellRing,
  Calendar,
  CheckCircle2,
  Clock,
  Edit2,
  Lock,
  MapPin,
  Repeat,
  Save,
  Text,
  User,
  Users,
} from 'lucide-react';
import type { DynamicTask } from '@/types/app';
import { getOwnerTone } from '@/lib/uiUtils';
import { formatReminder, formatTimeRange } from '@/lib/dateUtils';
import { summarizeRecurrence } from '@/lib/recurrence';
import TaskForm, { ModalShell } from './TaskForm';

interface TaskDetailModalProps {
  selectedTask: DynamicTask | null;
  isEditingTask: boolean;
  tempEditingTask: DynamicTask | null;
  allowBirthRelative: boolean;
  onStartEdit: () => void;
  onChangeTempEditingTask: (task: DynamicTask) => void;
  onSaveEdit: () => void;
  onClose: () => void;
  onToggleDone: () => void;
  onDelete: () => void;
}

export default function TaskDetailModal({
  selectedTask,
  isEditingTask,
  tempEditingTask,
  allowBirthRelative,
  onStartEdit,
  onChangeTempEditingTask,
  onSaveEdit,
  onClose,
  onToggleDone,
  onDelete,
}: TaskDetailModalProps) {
  if (!selectedTask) return null;

  if (isEditingTask && tempEditingTask) {
    const canSubmit =
      tempEditingTask.title.trim() !== '' &&
      (tempEditingTask.anchorType === 'birth_relative' || tempEditingTask.startDate !== null);

    return (
      <ModalShell
        title={tempEditingTask.kind === 'task' ? 'タスクを編集' : '予定を編集'}
        onClose={onClose}
        footer={
          <button
            onClick={onSaveEdit}
            disabled={!canSubmit}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl shadow-sm transition active:bg-blue-600 flex items-center justify-center disabled:bg-gray-200 disabled:text-gray-400"
          >
            <Save size={16} className="mr-2" /> 保存する
          </button>
        }
      >
        <TaskForm
          value={tempEditingTask}
          onChange={(draft) => onChangeTempEditingTask({ ...tempEditingTask, ...draft })}
          allowBirthRelative={allowBirthRelative}
        />
      </ModalShell>
    );
  }

  const isEvent = selectedTask.kind === 'event';

  return (
    <ModalShell
      title={isEvent ? '予定の詳細' : 'タスクの詳細'}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <button
            onClick={onToggleDone}
            className={`w-full flex items-center justify-center font-medium py-3 rounded-xl shadow-sm transition ${
              !selectedTask.done ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {!selectedTask.done ? (
              <>
                <CheckCircle2 size={18} className="mr-2" /> 完了にする
              </>
            ) : (
              '未完了に戻す'
            )}
          </button>
          <button onClick={onDelete} className="w-full text-center text-xs text-red-500 font-medium py-2">
            {isEvent ? 'この予定を削除' : 'このタスクを削除'}
          </button>
        </div>
      }
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-bold text-gray-800 text-xl leading-tight pr-2">{selectedTask.title}</h3>
        <div className="flex items-center space-x-2 flex-none">
          {selectedTask.participants.length > 0 && (
            <span
              className={`text-[10px] font-bold px-2 py-1 rounded border whitespace-nowrap ${getOwnerTone(selectedTask.owner, selectedTask.participants)}`}
            >
              {selectedTask.participants.join('・')}
            </span>
          )}
          <button onClick={onStartEdit} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded-full transition" aria-label="編集">
            <Edit2 size={18} />
          </button>
        </div>
      </div>

      {(selectedTask.done || selectedTask.isPrivate) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {selectedTask.done && (
            <span className="inline-flex items-center text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-md font-medium">
              <CheckCircle2 size={12} className="mr-1" /> 完了済
            </span>
          )}
          {selectedTask.isPrivate && (
            <span className="inline-flex items-center text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md font-medium">
              <Lock size={12} className="mr-1" /> 自分だけ
            </span>
          )}
        </div>
      )}

      <div className="space-y-4 bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm">
        <div>
          <p className="text-gray-500 text-xs mb-1 flex items-center">
            <Calendar size={14} className="mr-1" /> 日付
          </p>
          <p className="font-medium text-gray-800">{selectedTask.targetDate}</p>
          {selectedTask.anchorType === 'birth_relative' && (
            <p className="text-xs text-gray-500 mt-0.5">
              生後{selectedTask.daysAfterBirth}日{selectedTask.timing && `（${selectedTask.timing}）`}
            </p>
          )}
        </div>
        {isEvent && (
          <div>
            <p className="text-gray-500 text-xs mb-1 flex items-center">
              <Clock size={14} className="mr-1" /> 時刻
            </p>
            <p className="font-medium text-gray-800">
              {formatTimeRange(selectedTask.startTime, selectedTask.endTime)}
            </p>
          </div>
        )}
        {isEvent && (
          <div>
            <p className="text-gray-500 text-xs mb-1 flex items-center">
              <MapPin size={14} className="mr-1" /> 場所
            </p>
            <p className="font-medium text-gray-800">{selectedTask.place || '未設定'}</p>
          </div>
        )}
        {isEvent && (
          <div>
            <p className="text-gray-500 text-xs mb-1 flex items-center">
              <User size={14} className="mr-1" /> 主体
            </p>
            <p className="font-medium text-gray-800">{selectedTask.owner ?? '未設定'}</p>
          </div>
        )}
        {isEvent && (
          <div>
            <p className="text-gray-500 text-xs mb-1 flex items-center">
              <Users size={14} className="mr-1" /> 参加者
            </p>
            <p className="font-medium text-gray-800">
              {selectedTask.participants.length > 0 ? selectedTask.participants.join('・') : '未設定'}
            </p>
          </div>
        )}
        <div>
          <p className="text-gray-500 text-xs mb-1 flex items-center">
            <BellRing size={14} className="mr-1" /> リマインダー
          </p>
          <p className="font-medium text-gray-800">{formatReminder(selectedTask.remindMinutesBefore)}</p>
        </div>
        {selectedTask.recurrence && (
          <div>
            <p className="text-gray-500 text-xs mb-1 flex items-center">
              <Repeat size={14} className="mr-1" /> 繰り返し
            </p>
            <p className="font-medium text-gray-800">{summarizeRecurrence(selectedTask.recurrence)}</p>
          </div>
        )}
      </div>

      {selectedTask.note !== '' && (
        <div className="mt-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100 text-sm">
          <p className="font-bold text-blue-800 text-xs mb-1 flex items-center">
            <Text size={14} className="mr-1" /> 詳細
          </p>
          <p className="text-blue-900 leading-relaxed whitespace-pre-wrap">{selectedTask.note}</p>
        </div>
      )}
    </ModalShell>
  );
}
