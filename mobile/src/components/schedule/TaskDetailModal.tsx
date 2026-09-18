import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BellRing,
  Calendar,
  CheckCircle2,
  Clock,
  Edit2,
  MapPin,
  Save,
  Text as TextIcon,
} from 'lucide-react-native';
import type { DynamicTask } from '@/types/app';
import { formatReminder, formatTimeRange } from '@/lib/dateUtils';
import { getLabelColors } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';
import TaskForm from './TaskForm';
import TaskModalShell from './TaskModalShell';

// 予定の詳細と編集。Web版の
// `src/components/sukusuku/modals/TaskDetailModal.tsx` を置き換えたもの。
// 出す項目・並び・文言は同じにしてある。

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

/** 詳細の1項目（日付・時刻・場所・リマインダー）。 */
function DetailRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View>
      <View style={styles.detailLabel}>
        {icon}
        <Text style={styles.detailLabelText}>{label}</Text>
      </View>
      <Text style={styles.detailValue}>{value}</Text>
      {sub && <Text style={styles.detailSub}>{sub}</Text>}
    </View>
  );
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
      <TaskModalShell
        show
        title="予定を編集"
        onClose={onClose}
        footer={
          <Pressable accessibilityRole="button" onPress={onSaveEdit} style={styles.primary}>
            <Save size={16} color={colors.primaryText} />
            <Text style={styles.primaryText}>保存する</Text>
          </Pressable>
        }
      >
        <TaskForm
          value={tempEditingTask}
          onChange={(draft) => onChangeTempEditingTask({ ...tempEditingTask, ...draft })}
          allowBirthRelative={allowBirthRelative}
        />
      </TaskModalShell>
    );
  }

  const label = getLabelColors(selectedTask.label);

  return (
    <TaskModalShell
      show
      title="予定の詳細"
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleDone}
            style={[styles.primary, selectedTask.done && styles.undo]}
          >
            {!selectedTask.done ? (
              <>
                <CheckCircle2 size={18} color={colors.primaryText} />
                <Text style={styles.primaryText}>完了にする</Text>
              </>
            ) : (
              <Text style={styles.undoText}>未完了に戻す</Text>
            )}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onDelete} style={styles.delete}>
            <Text style={styles.deleteText}>この予定を削除</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{selectedTask.title}</Text>
        <View style={styles.titleActions}>
          <View
            style={[styles.label, { backgroundColor: label.background, borderColor: label.border }]}
          >
            <Text style={[styles.labelText, { color: label.text }]}>{selectedTask.label}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="編集"
            onPress={onStartEdit}
            hitSlop={8}
          >
            <Edit2 size={18} color={colors.navActive} />
          </Pressable>
        </View>
      </View>

      {selectedTask.done && (
        <View style={styles.doneBadge}>
          <CheckCircle2 size={12} color={colors.doneText} />
          <Text style={styles.doneBadgeText}>完了済</Text>
        </View>
      )}

      <View style={styles.detailCard}>
        <DetailRow
          icon={<Calendar size={14} color={colors.textMuted} />}
          label="日付"
          value={selectedTask.targetDate}
          sub={
            selectedTask.anchorType === 'birth_relative'
              ? `生後${selectedTask.daysAfterBirth}日${selectedTask.timing ? `（${selectedTask.timing}）` : ''}`
              : undefined
          }
        />
        <DetailRow
          icon={<Clock size={14} color={colors.textMuted} />}
          label="時刻"
          value={formatTimeRange(selectedTask.startTime, selectedTask.endTime)}
        />
        <DetailRow
          icon={<MapPin size={14} color={colors.textMuted} />}
          label="場所"
          value={selectedTask.place || '未設定'}
        />
        <DetailRow
          icon={<BellRing size={14} color={colors.textMuted} />}
          label="リマインダー"
          value={formatReminder(selectedTask.remindMinutesBefore)}
        />
      </View>

      {selectedTask.note !== '' && (
        <View style={styles.noteCard}>
          <View style={styles.detailLabel}>
            <TextIcon size={14} color={colors.noteText} />
            <Text style={styles.noteLabel}>詳細</Text>
          </View>
          <Text style={styles.noteText}>{selectedTask.note}</Text>
        </View>
      )}
    </TaskModalShell>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 16 },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.textSubtle, lineHeight: 26 },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  labelText: { fontSize: 10, fontWeight: '700' },

  doneBadge: {
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
  doneBadgeText: { fontSize: 12, fontWeight: '500', color: colors.doneText, flexShrink: 1 },

  detailCard: {
    gap: 16,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
  },
  detailLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  detailLabelText: { fontSize: 12, color: colors.textMuted, flexShrink: 1 },
  detailValue: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  detailSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  noteCard: {
    marginTop: 16,
    backgroundColor: colors.noteSurface,
    borderWidth: 1,
    borderColor: colors.diaperBorder,
    borderRadius: 12,
    padding: 12,
  },
  noteLabel: { fontSize: 12, fontWeight: '700', color: colors.noteText, flexShrink: 1 },
  noteText: { fontSize: 14, color: colors.noteBody, lineHeight: 21 },

  footer: { gap: 8 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.navActive,
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryText: { fontSize: 15, fontWeight: '500', color: colors.primaryText, flexShrink: 1 },
  undo: { backgroundColor: colors.border },
  undoText: { fontSize: 15, fontWeight: '500', color: colors.textSubtle, flexShrink: 1 },
  delete: { alignItems: 'center', paddingVertical: 8 },
  deleteText: { fontSize: 12, fontWeight: '500', color: colors.danger },
});
