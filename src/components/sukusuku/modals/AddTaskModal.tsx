'use client';

import { BellRing, X } from 'lucide-react';
import type { Assignee, TaskCategory } from '@/types/app';

export interface NewTaskDraft {
  title: string;
  category: TaskCategory | string;
  timing: string;
  daysAfterBirth: number | string;
  place: string;
  note: string;
  belongings: string;
  assignee: Assignee;
  notification: boolean;
}

interface AddTaskModalProps {
  show: boolean;
  newTask: NewTaskDraft;
  onChange: (task: NewTaskDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export default function AddTaskModal({ show, newTask, onChange, onClose, onSubmit }: AddTaskModalProps) {
  if (!show) return null;

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="font-bold text-gray-800">新規予定・ToDoを追加</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              タイトル <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newTask.title}
              onChange={(e) => onChange({ ...newTask, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder="例: ベビーカー購入"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">カテゴリ</label>
              <select
                value={newTask.category}
                onChange={(e) => onChange({ ...newTask, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none bg-white"
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
                value={newTask.assignee}
                onChange={(e) => onChange({ ...newTask, assignee: e.target.value as Assignee })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none bg-white"
              >
                <option>未定</option>
                <option>パパ</option>
                <option>ママ</option>
                <option>二人で</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">カレンダー目安</label>
              <div className="flex items-center">
                <span className="text-xs mr-2">生後</span>
                <input
                  type="number"
                  value={newTask.daysAfterBirth}
                  onChange={(e) => onChange({ ...newTask, daysAfterBirth: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
                />
                <span className="text-xs ml-2">日</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">時期メモ</label>
              <input
                type="text"
                value={newTask.timing}
                onChange={(e) => onChange({ ...newTask, timing: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
                placeholder="退院後など"
              />
            </div>
          </div>

          <div className="flex items-center justify-between bg-gray-50 p-3 rounded-xl border border-gray-100">
            <div className="flex items-center space-x-2">
              <BellRing size={16} className={`transition ${newTask.notification ? 'text-yellow-500' : 'text-gray-400'}`} />
              <span className="text-sm font-medium text-gray-700">予定が近づいたら通知する</span>
            </div>
            <button
              onClick={() => onChange({ ...newTask, notification: !newTask.notification })}
              className={`w-11 h-6 rounded-full relative transition-colors ${newTask.notification ? 'bg-blue-500' : 'bg-gray-300'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${newTask.notification ? 'translate-x-5.5 left-0.5' : 'left-0.5'}`} />
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">場所 / 持ち物</label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={newTask.place}
                onChange={(e) => onChange({ ...newTask, place: e.target.value })}
                className="w-1/2 border border-gray-300 rounded-lg p-2 text-sm outline-none"
                placeholder="場所"
              />
              <input
                type="text"
                value={newTask.belongings}
                onChange={(e) => onChange({ ...newTask, belongings: e.target.value })}
                className="w-1/2 border border-gray-300 rounded-lg p-2 text-sm outline-none"
                placeholder="持ち物"
              />
            </div>
          </div>
          <button onClick={onSubmit} className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl mt-4 shadow-sm active:bg-blue-600 transition">
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}
