import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@/lib/theme';
import TaskForm, { type TaskDraft } from './TaskForm';
import TaskModalShell from './TaskModalShell';

export type { TaskDraft };

// 予定の追加。Web版の `src/components/sukusuku/modals/AddTaskModal.tsx` を置き換えたもの。

interface AddTaskModalProps {
  show: boolean;
  newTask: TaskDraft;
  allowBirthRelative: boolean;
  onChange: (task: TaskDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export default function AddTaskModal({
  show,
  newTask,
  allowBirthRelative,
  onChange,
  onClose,
  onSubmit,
}: AddTaskModalProps) {
  const canSubmit =
    newTask.title.trim() !== '' &&
    (newTask.anchorType === 'birth_relative' || newTask.startDate !== null);

  return (
    <TaskModalShell
      show={show}
      title={newTask.kind === 'task' ? 'タスクを追加' : '予定を追加'}
      onClose={onClose}
      footer={
        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={onSubmit}
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
        >
          <Text style={[styles.submitText, !canSubmit && styles.submitTextDisabled]}>追加する</Text>
        </Pressable>
      }
    >
      {show ? (
        <TaskForm value={newTask} onChange={onChange} allowBirthRelative={allowBirthRelative} />
      ) : null}
    </TaskModalShell>
  );
}

const styles = StyleSheet.create({
  submit: {
    backgroundColor: colors.navActive,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: colors.border },
  submitText: { fontSize: 15, fontWeight: '500', color: colors.primaryText },
  submitTextDisabled: { color: colors.textFaint },
});
