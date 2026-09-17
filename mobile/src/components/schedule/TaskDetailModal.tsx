import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BellRing,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  Pencil,
  Save,
  Text as TextIcon,
} from 'lucide-react-native';
import type { DynamicTask } from '@/types/app';
import { formatReminder, formatTimeRange } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { getLabelColors } from '@/lib/uiUtils';
import TaskForm, { ModalShell } from './TaskForm';

// 予定の詳細と編集。Web版の `src/components/sukusuku/modals/TaskDetailModal.tsx` と同じで、
// 同じ外枠の中を「詳細」と「編集」で入れ替える。

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
    return (
      <ModalShell
        title="予定を編集"
        onClose={onClose}
        footer={
          <Pressable accessibilityRole="button" onPress={onSaveEdit} style={styles.primaryButton}>
            <Save size={16} color={colors.primaryText} />
            <Text style={styles.primaryButtonText}>保存する</Text>
          </Pressable>
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

  const label = getLabelColors(selectedTask.label);

  return (
    <ModalShell
      title="予定の詳細"
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleDone}
            style={[styles.primaryButton, selectedTask.done && styles.undoneButton]}
          >
            {!selectedTask.done ? (
              <>
                <CheckCircle2 size={18} color={colors.primaryText} />
                <Text style={styles.primaryButtonText}>完了にする</Text>
              </>
            ) : (
              <Text style={styles.undoneButtonText}>未完了に戻す</Text>
            )}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onDelete} style={styles.deleteButton}>
            <Text style={styles.deleteButtonText}>この予定を削除</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{selectedTask.title}</Text>
        <View style={styles.titleActions}>
          <View
            style={[styles.labelChip, { backgroundColor: label.background, borderColor: label.border }]}
          >
            <Text style={[styles.labelText, { color: label.text }]}>{selectedTask.label}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="編集"
            onPress={onStartEdit}
            hitSlop={8}
          >
            <Pencil size={18} color={colors.accentBlue} />
          </Pressable>
        </View>
      </View>

      {selectedTask.done && (
        <View style={styles.doneChip}>
          <CheckCircle2 size={12} color={colors.doneText} />
          <Text style={styles.doneChipText}>完了済</Text>
        </View>
      )}

      <View style={styles.detailCard}>
        <View>
          <View style={styles.detailLabel}>
            <Calendar size={14} color={colors.textMuted} />
            <Text style={styles.detailLabelText}>日付</Text>
          </View>
          <Text style={styles.detailValue}>{selectedTask.targetDate}</Text>
          {selectedTask.anchorType === 'birth_relative' && (
            <Text style={styles.detailNote}>
              生後{selectedTask.daysAfterBirth}日
              {selectedTask.timing !== '' ? `（${selectedTask.timing}）` : ''}
            </Text>
          )}
        </View>
        <View>
          <View style={styles.detailLabel}>
            <Clock size={14} color={colors.textMuted} />
            <Text style={styles.detailLabelText}>時刻</Text>
          </View>
          <Text style={styles.detailValue}>
            {formatTimeRange(selectedTask.startTime, selectedTask.endTime)}
          </Text>
        </View>
        <View>
          <View style={styles.detailLabel}>
            <MapPin size={14} color={colors.textMuted} />
            <Text style={styles.detailLabelText}>場所</Text>
          </View>
          <Text style={styles.detailValue}>{selectedTask.place || '未設定'}</Text>
        </View>
        <View>
          <View style={styles.detailLabel}>
            <BellRing size={14} color={colors.textMuted} />
            <Text style={styles.detailLabelText}>リマインダー</Text>
          </View>
          <Text style={styles.detailValue}>{formatReminder(selectedTask.remindMinutesBefore)}</Text>
        </View>
      </View>

      {selectedTask.note !== '' && (
        <View style={styles.noteCard}>
          <View style={styles.detailLabel}>
            <TextIcon size={14} color={colors.accentBlueText} />
            <Text style={styles.noteLabelText}>詳細</Text>
          </View>
          <Text style={styles.noteText}>{selectedTask.note}</Text>
        </View>
      )}
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 16 },
  title: { flex: 1, fontSize: 19, fontWeight: '700', color: colors.text, lineHeight: 26 },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelChip: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 },
  labelText: { fontSize: 10, fontWeight: '700' },
  doneChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.doneSurface,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 16,
  },
  doneChipText: { fontSize: 12, fontWeight: '500', color: colors.doneText },
  detailCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 16,
  },
  detailLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  detailLabelText: { fontSize: 12, color: colors.textMuted },
  detailValue: { fontSize: 13, fontWeight: '500', color: colors.text },
  detailNote: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  noteCard: {
    marginTop: 16,
    backgroundColor: colors.accentBlueSurface,
    borderWidth: 1,
    borderColor: colors.accentBlueBorder,
    borderRadius: 12,
    padding: 12,
  },
  noteLabelText: { fontSize: 12, fontWeight: '700', color: colors.accentBlueText },
  noteText: { fontSize: 13, color: colors.accentBlueText, lineHeight: 20 },
  footer: { gap: 8 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accentBlue,
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '500', color: colors.primaryText },
  undoneButton: { backgroundColor: colors.border },
  undoneButtonText: { fontSize: 15, fontWeight: '500', color: colors.textSubtle },
  deleteButton: { alignItems: 'center', paddingVertical: 8 },
  deleteButtonText: { fontSize: 12, fontWeight: '500', color: colors.danger },
});
