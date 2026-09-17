import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '@/lib/theme';
import TaskForm, { ModalShell, type TaskDraft } from './TaskForm';

export type { TaskDraft };

// 予定の追加。Web版の `src/components/sukusuku/modals/AddTaskModal.tsx` と同じで、
// 入力欄は編集と共通（TaskForm）。

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
  if (!show) return null;

  const canSubmit =
    newTask.title.trim() !== '' &&
    (newTask.anchorType === 'birth_relative' || newTask.startDate !== null);

  return (
    <ModalShell
      title="予定を追加"
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
      <TaskForm value={newTask} onChange={onChange} allowBirthRelative={allowBirthRelative} />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  submit: {
    backgroundColor: colors.accentBlue,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: colors.border },
  submitText: { fontSize: 15, fontWeight: '500', color: colors.primaryText },
  submitTextDisabled: { color: colors.textFaint },
});
