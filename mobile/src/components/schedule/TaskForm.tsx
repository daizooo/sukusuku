import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { BellRing, Clock, MapPin, Tag, Text as TextIcon } from 'lucide-react-native';
import type { AnchorType, Label, Task } from '@/types/app';
import { LABELS } from '@/types/app';
import {
  REMINDER_OPTIONS,
  formatDateWithWeekday,
  parseDateString,
  parseTimeInput,
  toDateString,
} from '@/lib/dateUtils';
import { getLabelColors } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';
import SelectField from '@/components/ui/SelectField';

// 予定の入力欄（追加・編集で共通）。Web版の
// `src/components/sukusuku/modals/TaskForm.tsx` を置き換えたもの。
// 項目の並び・既定値・保存する中身は同じにしてある。
//
// 日付・時刻・リマインダーはWeb版では <input>/<select> だが、React Nativeには無いので
// 端末のピッカーと選択欄で置き換えている（出す中身と並びは同じ）。

export type TaskDraft = Omit<Task, 'id' | 'done'>;

interface TaskFormProps {
  value: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  /** 誕生日が未登録のときだけ「生後日数で指定」を選べるようにする */
  allowBirthRelative: boolean;
}

const REMINDER_SELECT_OPTIONS = REMINDER_OPTIONS.map((option) => ({
  value: option.value === null ? '' : String(option.value),
  label: option.label,
}));

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

  const openDatePicker = () =>
    DateTimePickerAndroid.open({
      value: parseDateString(value.startDate ?? '') ?? new Date(),
      mode: 'date',
      onChange: (_event, picked) => {
        if (picked) set({ startDate: toDateString(picked) });
      },
    });

  const openTimePicker = (field: 'startTime' | 'endTime') =>
    DateTimePickerAndroid.open({
      value: parseTimeInput(value[field] ?? '09:00'),
      mode: 'time',
      is24Hour: true,
      onChange: (_event, picked) => {
        if (!picked) return;
        const time = `${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`;
        set({ [field]: time } as Partial<TaskDraft>);
      },
    });

  const startDate = parseDateString(value.startDate ?? '');

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.titleInput}
        value={value.title}
        onChangeText={(title) => set({ title })}
        placeholder="タイトルを入力"
        placeholderTextColor={colors.border}
      />

      {/* 日付 */}
      <View style={styles.block}>
        {showAnchorChoice && (
          <View style={styles.switcher}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: value.anchorType === 'absolute' }}
              onPress={() => setAnchorType('absolute')}
              style={[styles.switcherTab, value.anchorType === 'absolute' && styles.switcherTabOn]}
            >
              <Text
                style={[
                  styles.switcherText,
                  value.anchorType === 'absolute' && styles.switcherTextOn,
                ]}
              >
                日付を指定
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: value.anchorType === 'birth_relative' }}
              onPress={() => setAnchorType('birth_relative')}
              style={[
                styles.switcherTab,
                value.anchorType === 'birth_relative' && styles.switcherTabOn,
              ]}
            >
              <Text
                style={[
                  styles.switcherText,
                  value.anchorType === 'birth_relative' && styles.switcherTextOn,
                ]}
              >
                生後日数で指定
              </Text>
            </Pressable>
          </View>
        )}

        {value.anchorType === 'absolute' ? (
          <Pressable accessibilityRole="button" onPress={openDatePicker} style={styles.field}>
            <Text style={startDate ? styles.fieldText : styles.fieldPlaceholder}>
              {startDate ? formatDateWithWeekday(startDate) : '日付を選ぶ'}
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.field, styles.inlineField]}>
            <Text style={styles.inlineLabel}>生後</Text>
            <TextInput
              style={styles.inlineInput}
              value={String(value.daysAfterBirth)}
              onChangeText={(text) => set({ daysAfterBirth: Number(text) || 0 })}
              keyboardType="number-pad"
              inputMode="numeric"
              accessibilityLabel="生後日数"
            />
            <Text style={styles.inlineLabel}>日</Text>
          </View>
        )}
      </View>

      {/* 時刻 */}
      <View style={styles.block}>
        <View style={styles.row}>
          <View style={styles.iconLabel}>
            <Clock size={14} color={colors.textFaint} />
            <Text style={styles.iconLabelText}>終日</Text>
          </View>
          <Switch
            accessibilityLabel="終日の切り替え"
            value={isAllDay}
            onValueChange={toggleAllDay}
            trackColor={{ true: colors.navActive, false: colors.borderStrong }}
            thumbColor={colors.surface}
          />
        </View>
        {!isAllDay && (
          <View style={styles.timeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="始まりの時刻"
              onPress={() => openTimePicker('startTime')}
              style={[styles.field, styles.flex]}
            >
              <Text style={styles.fieldText}>{value.startTime ?? ''}</Text>
            </Pressable>
            <Text style={styles.dash}>-</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="終わりの時刻"
              onPress={() => openTimePicker('endTime')}
              style={[styles.field, styles.flex]}
            >
              <Text style={value.endTime ? styles.fieldText : styles.fieldPlaceholder}>
                {value.endTime ?? '未設定'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* ラベル */}
      <View>
        <View style={styles.iconLabel}>
          <Tag size={14} color={colors.textFaint} />
          <Text style={styles.iconLabelText}>ラベル</Text>
        </View>
        <View style={styles.labelRow}>
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
                  selected && { backgroundColor: tone.background, borderColor: tone.border },
                ]}
              >
                <Text style={[styles.labelText, selected && { color: tone.text }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 場所 */}
      <View>
        <View style={styles.iconLabel}>
          <MapPin size={14} color={colors.textFaint} />
          <Text style={styles.iconLabelText}>場所</Text>
        </View>
        <TextInput
          style={[styles.field, styles.fieldText]}
          value={value.place}
          onChangeText={(place) => set({ place })}
          placeholder="例: 城南まちづくりセンター"
          placeholderTextColor={colors.textFaint}
        />
      </View>

      {/* 詳細（持ち物もここにまとめて書く） */}
      <View>
        <View style={styles.iconLabel}>
          <TextIcon size={14} color={colors.textFaint} />
          <Text style={styles.iconLabelText}>詳細</Text>
        </View>
        <TextInput
          style={[styles.field, styles.fieldText, styles.noteInput]}
          value={value.note}
          onChangeText={(note) => set({ note })}
          placeholder="メモ・持ち物（母子手帳、印鑑など）を入力"
          placeholderTextColor={colors.textFaint}
          multiline
        />
      </View>

      {/* リマインダー */}
      <View>
        <View style={styles.iconLabel}>
          <BellRing size={14} color={colors.textFaint} />
          <Text style={styles.iconLabelText}>リマインダー</Text>
        </View>
        <SelectField
          accessibilityLabel="リマインダー"
          options={REMINDER_SELECT_OPTIONS}
          value={value.remindMinutesBefore === null ? '' : String(value.remindMinutesBefore)}
          onChange={(picked) =>
            set({ remindMinutesBefore: picked === '' ? null : Number(picked) })
          }
          style={styles.select}
          textStyle={styles.selectText}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  flex: { flex: 1 },
  block: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleInput: {
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    fontSize: 18,
    fontWeight: '500',
    color: colors.textSubtle,
  },
  switcher: {
    flexDirection: 'row',
    backgroundColor: colors.neutralSurface,
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  switcherTab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 6 },
  switcherTabOn: { backgroundColor: colors.surface },
  switcherText: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  switcherTextOn: { color: colors.navActiveText },
  field: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  fieldText: { fontSize: 14, color: colors.textSubtle },
  fieldPlaceholder: { fontSize: 14, color: colors.textFaint },
  inlineField: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineLabel: { fontSize: 14, color: colors.textMuted, flexShrink: 1 },
  inlineInput: { flex: 1, fontSize: 14, color: colors.textSubtle, paddingVertical: 0 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dash: { fontSize: 14, color: colors.textFaint, flexShrink: 1 },
  iconLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  iconLabelText: { fontSize: 12, fontWeight: '500', color: colors.textSubtle, flexShrink: 1 },
  labelRow: { flexDirection: 'row', gap: 8 },
  labelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  labelText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  noteInput: { minHeight: 96, textAlignVertical: 'top' },
  select: { borderColor: colors.borderStrong, borderRadius: 8, minHeight: 42 },
  selectText: { flex: 1, fontWeight: '400', fontSize: 14 },
});
