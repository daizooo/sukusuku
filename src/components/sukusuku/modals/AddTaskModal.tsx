'use client';

import TaskForm, { ModalShell, type TaskDraft } from './TaskForm';

export type { TaskDraft };

interface AddTaskModalProps {
  show: boolean;
  newTask: TaskDraft;
  onChange: (task: TaskDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export default function AddTaskModal({
  show,
  newTask,
  onChange,
  onClose,
  onSubmit,
}: AddTaskModalProps) {
  if (!show) return null;

  const canSubmit =
    newTask.title.trim() !== '' &&
    (newTask.anchorType === 'birth_relative' || newTask.startDate !== null);

  return (
    <ModalShell
      title={newTask.kind === 'task' ? 'タスクを追加' : '予定を追加'}
      onClose={onClose}
      footer={
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl shadow-sm transition active:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400"
        >
          追加する
        </button>
      }
    >
      <TaskForm value={newTask} onChange={onChange} />
    </ModalShell>
  );
}
