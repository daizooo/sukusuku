'use client';

import { BellRing, Briefcase, Calendar, CheckCircle2, Edit2, MapPin, Save, X } from 'lucide-react';
import type { Assignee, DynamicTask } from '@/types/app';
import { getAssigneeColor } from '@/lib/uiUtils';

interface TaskDetailModalProps {
  selectedTask: DynamicTask | null;
  isEditingTask: boolean;
  tempEditingTask: DynamicTask | null;
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
  onStartEdit,
  onChangeTempEditingTask,
  onSaveEdit,
  onClose,
  onToggleDone,
  onDelete,
}: TaskDetailModalProps) {
  if (!selectedTask) return null;

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-xl relative max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-2">
            <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md font-medium">{selectedTask.category}</span>
            {selectedTask.done && (
              <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-md font-medium flex items-center">
                <CheckCircle2 size={12} className="mr-1" />
                完了済
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {!isEditingTask ? (
              <button onClick={onStartEdit} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded-full transition">
                <Edit2 size={18} />
              </button>
            ) : (
              <button onClick={onSaveEdit} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded-full transition font-bold text-sm flex items-center">
                <Save size={16} className="mr-1" />
                保存
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:bg-gray-50 p-1.5 rounded-full transition">
              <X size={20} />
            </button>
          </div>
        </div>

        {!isEditingTask ? (
          <>
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-bold text-gray-800 text-xl leading-tight pr-2">{selectedTask.title}</h3>
              <div className="flex flex-col items-end space-y-1">
                <span className={`text-[10px] font-bold px-2 py-1 rounded border whitespace-nowrap ${getAssigneeColor(selectedTask.assignee)}`}>
                  {selectedTask.assignee}担当
                </span>
                {selectedTask.notification && (
                  <span className="flex items-center text-[10px] text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-200">
                    <BellRing size={10} className="mr-1" /> 通知ON
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-4 bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-1 flex items-center">
                  <Calendar size={14} className="mr-1" /> 目安時期
                </p>
                <p className="font-medium text-gray-800">{selectedTask.targetDate}</p>
                <p className="text-xs text-gray-500 mt-0.5">({selectedTask.timing})</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1 flex items-center">
                  <MapPin size={14} className="mr-1" /> 場所
                </p>
                <p className="font-medium text-gray-800">{selectedTask.place || '未定'}</p>
              </div>
            </div>

            {selectedTask.belongings && (
              <div className="mt-4 p-3 bg-orange-50/80 rounded-xl border border-orange-100 text-sm">
                <p className="font-bold text-orange-800 text-xs mb-1 flex items-center">
                  <Briefcase size={14} className="mr-1" />
                  持ち物
                </p>
                <p className="text-orange-900 leading-relaxed whitespace-pre-wrap">{selectedTask.belongings}</p>
              </div>
            )}

            {selectedTask.note && (
              <div className="mt-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100 text-sm">
                <p className="font-bold text-blue-800 text-xs mb-1">メモ</p>
                <p className="text-blue-900 leading-relaxed whitespace-pre-wrap">{selectedTask.note}</p>
              </div>
            )}

            <div className="mt-6 space-y-3">
              <button
                onClick={onToggleDone}
                className={`w-full flex items-center justify-center font-medium py-3 rounded-xl shadow-sm transition ${
                  !selectedTask.done ? 'bg-blue-500 text-white hover:bg-blue-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {!selectedTask.done ? (
                  <>
                    <CheckCircle2 size={18} className="mr-2" /> タスクを完了にする
                  </>
                ) : (
                  '未完了に戻す'
                )}
              </button>
              <button onClick={onDelete} className="w-full text-center text-xs text-red-500 font-medium py-2">
                タスクを削除
              </button>
            </div>
          </>
        ) : (
          tempEditingTask && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">タイトル</label>
                <input
                  type="text"
                  value={tempEditingTask.title}
                  onChange={(e) => onChangeTempEditingTask({ ...tempEditingTask, title: e.target.value })}
                  className="w-full border rounded-lg p-2 text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">カテゴリ</label>
                  <select
                    value={tempEditingTask.category}
                    onChange={(e) => onChangeTempEditingTask({ ...tempEditingTask, category: e.target.value })}
                    className="w-full border rounded-lg p-2 text-sm bg-white"
                  >
                    <option>手続き</option>
                    <option>健診</option>
                    <option>イベント</option>
                    <option>お買い物</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">担当</label>
                  <select
                    value={tempEditingTask.assignee}
                    onChange={(e) => onChangeTempEditingTask({ ...tempEditingTask, assignee: e.target.value as Assignee })}
                    className="w-full border rounded-lg p-2 text-sm bg-white"
                  >
                    <option>未定</option>
                    <option>パパ</option>
                    <option>ママ</option>
                    <option>二人で</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">場所</label>
                <input
                  type="text"
                  value={tempEditingTask.place}
                  onChange={(e) => onChangeTempEditingTask({ ...tempEditingTask, place: e.target.value })}
                  className="w-full border rounded-lg p-2 text-sm outline-none"
                />
              </div>

              <div className="flex items-center justify-between bg-gray-50 p-3 rounded-xl border border-gray-100">
                <div className="flex items-center space-x-2">
                  <BellRing size={16} className={`transition ${tempEditingTask.notification ? 'text-yellow-500' : 'text-gray-400'}`} />
                  <span className="text-sm font-medium text-gray-700">予定が近づいたら通知する</span>
                </div>
                <button
                  onClick={() => onChangeTempEditingTask({ ...tempEditingTask, notification: !tempEditingTask.notification })}
                  className={`w-11 h-6 rounded-full relative transition-colors ${tempEditingTask.notification ? 'bg-blue-500' : 'bg-gray-300'}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${tempEditingTask.notification ? 'translate-x-5.5 left-0.5' : 'left-0.5'}`} />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">メモ</label>
                <textarea
                  value={tempEditingTask.note || ''}
                  onChange={(e) => onChangeTempEditingTask({ ...tempEditingTask, note: e.target.value })}
                  className="w-full border rounded-lg p-2 text-sm outline-none h-20 resize-none"
                />
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
