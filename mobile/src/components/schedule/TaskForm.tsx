import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { BellRing, Clock, MapPin, Tag, Text as TextIcon, X } from 'lucide-react-native';
import type { AnchorType, Label, Task } from '@/types/app';
import { LABELS } from '@/types/app';
import {
  REMINDER_OPTIONS,
  formatDateWithWeekday,
  formatTimeString,
  parseDateString,
  parseTimeInput,
  toDateString,
} from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { getLabelColors } from '@/lib/uiUtils';

// 予定の入力欄（追加・編集で共通）。
// Web版の `src/components/sukusuku/modals/TaskForm.tsx` と同じ項目・同じ並び。
// 日付・時刻だけは <input type="date"/"time"> が無いので端末のピッカーを開く形にする。

export type TaskDraft = Omit<Task, 'id' | 'done'>;

interface TaskFormProps {
  value: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  /** 誕生日が未登録のときだけ「生後日数で指定」を選べるようにする。 */
  allowBirthRelative: boolean;
}

export default function TaskForm({ value, onChange, allowBirthRelative }: TaskFormProps) {
  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });

  const isAllDay = value.startTime === null;
  const showAnchorChoice = allowBirthRelative || value.anchorType === 'birth_relative';

  const setAnchorType = (anchorType: AnchorType) => set({ anchorType });

  const toggleAllDay = () => {
    // 終日 <-> 時刻あり。時刻ありに切り替えたときは 09:00 を初期値にする。
    set(isAllDay ? { startTime: '09:00', endTime: null } : { startTime: null, endTime: null });
  };

  const openDatePicker = () =>
    DateTimePickerAndroid.open({
      value: parseDateString(value.startDate ?? '') ?? new Date(),
      mode: 'date',
      onChange: (_event, picked) => picked && set({ startDate: toDateString(picked) }),
    });

  const openTimePicker = (key: 'startTime' | 'endTime') =>
    DateTimePickerAndroid.open({
      value: parseTimeInput(value[key] ?? '09:00'),
      mode: 'time',
      is24Hour: true,
      onChange: (_event, picked) => {
        if (!picked) return;
        const time = formatTimeString(picked);
        set(key === 'startTime' ? { startTime: time } : { endTime: time });
      },
    });

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.titleInput}
        value={value.title}
        onChangeText={(title) => set({ title })}
        placeholder="タイトルを入力"
        placeholderTextColor={colors.border}
        accessibilityLabel="タイトル"
      />

      {/* 日付 */}
      <View style={styles.group}>
        {showAnchorChoice && (
          <View style={styles.anchorTabs}>
            {(
              [
                { value: 'absolute', label: '日付を指定' },
                { value: 'birth_relative', label: '生後日数で指定' },
              ] as { value: AnchorType; label: string }[]
            ).map((option) => {
              const selected = value.anchorType === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setAnchorType(option.value)}
                  style={[styles.anchorTab, selected && styles.anchorTabSelected]}
                >
                  <Text style={[styles.anchorTabText, selected && styles.anchorTabTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {value.anchorType === 'absolute' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="日付を選ぶ"
            onPress={openDatePicker}
            style={styles.field}
          >
            <Text style={value.startDate !== null ? styles.fieldText : styles.fieldPlaceholder}>
              {value.startDate !== null
                ? formatDateWithWeekday(parseDateString(value.startDate))
                : '日付を選ぶ'}
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.field, styles.daysRow]}>
            <Text style={styles.fieldUnit}>生後</Text>
            <TextInput
              style={styles.daysInput}
              value={String(value.daysAfterBirth)}
              onChangeText={(text) => set({ daysAfterBirth: Number(text.replace(/\D/g, '')) || 0 })}
              keyboardType="number-pad"
              inputMode="numeric"
              accessibilityLabel="生後日数"
            />
            <Text style={styles.fieldUnit}>日</Text>
          </View>
        )}
      </View>

      {/* 時刻 */}
      <View style={styles.group}>
        <View style={styles.allDayRow}>
          <View style={styles.labelRow}>
            <Clock size={14} color={colors.textFaint} />
            <Text style={styles.fieldLabel}>終日</Text>
          </View>
          <Switch
            accessibilityLabel="終日の切り替え"
            value={isAllDay}
            onValueChange={toggleAllDay}
            trackColor={{ true: colors.accentBlue, false: colors.borderStrong }}
            thumbColor={colors.surface}
          />
        </View>
        {!isAllDay && (
          <View style={styles.timeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="開始の時刻"
              onPress={() => openTimePicker('startTime')}
              style={[styles.field, styles.timeField]}
            >
              <Text style={styles.fieldText}>{value.startTime ?? '--:--'}</Text>
            </Pressable>
            <Text style={styles.timeSeparator}>-</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="終わりの時刻"
              onPress={() => openTimePicker('endTime')}
              style={[styles.field, styles.timeField]}
            >
              <Text style={value.endTime !== null ? styles.fieldText : styles.fieldPlaceholder}>
                {value.endTime ?? '--:--'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* ラベル */}
      <View>
        <View style={styles.labelRow}>
          <Tag size={14} color={colors.textFaint} />
          <Text style={styles.fieldLabel}>ラベル</Text>
        </View>
        <View style={styles.labelButtons}>
          {LABELS.map((label: Label) => {
            const selected = value.label === label;
            const tone = getLabelColors(label);
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => set({ label })}
                style={[
                  styles.labelButton,
                  selected
                    ? { backgroundColor: tone.background, borderColor: tone.border }
                    : styles.labelButtonPlain,
                ]}
              >
                <Text
                  style={[
                    styles.labelButtonText,
                    selected ? { color: tone.text } : styles.labelButtonTextPlain,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 場所 */}
      <View>
        <View style={styles.labelRow}>
          <MapPin size={14} color={colors.textFaint} />
          <Text style={styles.fieldLabel}>場所</Text>
        </View>
        <TextInput
          style={[styles.field, styles.fieldText]}
          value={value.place}
          onChangeText={(place) => set({ place })}
          placeholder="例: 城南まちづくりセンター"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="場所"
        />
      </View>

      {/* 詳細（持ち物もここにまとめて書く） */}
      <View>
        <View style={styles.labelRow}>
          <TextIcon size={14} color={colors.textFaint} />
          <Text style={styles.fieldLabel}>詳細</Text>
        </View>
        <TextInput
          style={[styles.field, styles.fieldText, styles.noteInput]}
          value={value.note}
          onChangeText={(note) => set({ note })}
          placeholder="メモ・持ち物（母子手帳、印鑑など）を入力"
          placeholderTextColor={colors.textFaint}
          multiline
          accessibilityLabel="詳細"
        />
      </View>

      {/* リマインダー */}
      <View>
        <View style={styles.labelRow}>
          <BellRing size={14} color={colors.textFaint} />
          <Text style={styles.fieldLabel}>リマインダー</Text>
        </View>
        {/* Web版は選択（select）だが、React Nativeには同じものが無いので
            選択肢をそのまま並べる。数が少ないので1画面に収まる。 */}
        <View style={styles.reminderOptions}>
          {REMINDER_OPTIONS.map((option) => {
            const selected = value.remindMinutesBefore === option.value;
            return (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => set({ remindMinutesBefore: option.value })}
                style={[styles.reminderOption, selected && styles.reminderOptionSelected]}
              >
                <Text
                  style={[styles.reminderText, selected && styles.reminderTextSelected]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * 追加・編集・詳細の外枠。Web版の `TaskForm.tsx` の `ModalShell` にあたる。
 * 見出しと「閉じる」を上に、操作を下に固定し、スクロールするのは中身だけ。
 */
export function ModalShell({ title, onClose, children, footer }: ModalShellProps) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              onPress={onClose}
              hitSlop={8}
            >
              <X size={20} color={colors.textFaint} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          <View style={styles.sheetFooter}>{footer}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  titleInput: {
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    fontSize: 17,
    fontWeight: '500',
    color: colors.text,
  },
  group: { gap: 8 },
  anchorTabs: {
    flexDirection: 'row',
    backgroundColor: colors.neutralSurface,
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  anchorTab: { flex: 1, borderRadius: 6, paddingVertical: 7, alignItems: 'center' },
  anchorTabSelected: { backgroundColor: colors.surface },
  anchorTabText: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  anchorTabTextSelected: { color: colors.accentBlueStrong },
  field: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  fieldText: { fontSize: 13, color: colors.text },
  fieldPlaceholder: { fontSize: 13, color: colors.textFaint },
  fieldLabel: { fontSize: 12, fontWeight: '500', color: colors.textSubtle },
  fieldUnit: { fontSize: 13, color: colors.textMuted },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  daysRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  daysInput: { flex: 1, fontSize: 13, color: colors.text, padding: 0 },
  allDayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeField: { flex: 1 },
  timeSeparator: { fontSize: 13, color: colors.textFaint },
  labelButtons: { flexDirection: 'row', gap: 8 },
  labelButton: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  labelButtonPlain: { backgroundColor: colors.surface, borderColor: colors.border },
  labelButtonText: { fontSize: 12, fontWeight: '700' },
  labelButtonTextPlain: { color: colors.textMuted },
  noteInput: { minHeight: 90, textAlignVertical: 'top' },
  reminderOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reminderOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  reminderOptionSelected: {
    backgroundColor: colors.accentBlueSurface,
    borderColor: colors.accentBlue,
  },
  reminderText: { fontSize: 12, color: colors.textMuted },
  reminderTextSelected: { color: colors.accentBlueText, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  sheetBody: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: 20, paddingVertical: 16 },
  sheetFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
