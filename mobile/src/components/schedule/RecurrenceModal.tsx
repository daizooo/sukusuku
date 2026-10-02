import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { Recurrence, RecurrenceFreq } from '@/types/app';
import { WEEKDAY_LABELS, formatDateString, parseDateString, toDateString } from '@/lib/dateUtils';
import {
  END_TYPE_OPTIONS,
  FREQ_OPTIONS,
  type EndType,
  monthlyOptions,
  monthlyValueOf,
  normalizeRecurrence,
  withFreq,
  withMonthlyValue,
} from '@/lib/recurrence';
import { colors } from '@/lib/theme';
import SelectField from '@/components/ui/SelectField';

// 「カスタムの繰り返し」。Googleカレンダーの同名の画面と同じ並び:
// 繰り返す間隔（数＋単位）→ 曜日（週間ごと）／毎月の数え方（か月ごと）→ 終了日（なし／終了日／回数）。
// 開いている間の入力は手元の下書きで持ち、「完了」で初めて予定へ反映する
// （「キャンセル」なら何も変えない）。閉じたあとは中身を捨てるので、開くたびに
// 現在の設定から始まる（呼び出し側は開いているときだけこの部品を出す）。

interface RecurrenceModalProps {
  /** いまの設定（「カスタム…」を開いた直後は defaultRecurrence の値）。 */
  initial: Recurrence;
  /** 開始日 'YYYY-MM-DD'。曜日や「毎月 2日」の既定になる。 */
  startDate: string | null;
  onCancel: () => void;
  onDone: (recurrence: Recurrence) => void;
}

// 終了日の初期値は開始日の1年後、回数の初期値は13回（Googleカレンダーと同じ）。
const DEFAULT_END_COUNT = 13;

const oneYearAfter = (date: Date): string =>
  toDateString(new Date(date.getFullYear() + 1, date.getMonth(), date.getDate()));

export default function RecurrenceModal({ initial, startDate, onCancel, onDone }: RecurrenceModalProps) {
  const start = parseDateString(startDate ?? '') ?? new Date();

  const [rule, setRule] = useState<Recurrence>(initial);
  const [intervalText, setIntervalText] = useState(String(initial.interval));
  const [endType, setEndType] = useState<EndType>(initial.end.type);
  const [endDate, setEndDate] = useState(initial.end.type === 'until' ? initial.end.date : oneYearAfter(start));
  const [countText, setCountText] = useState(
    String(initial.end.type === 'count' ? initial.end.count : DEFAULT_END_COUNT),
  );

  const toggleWeekday = (day: number) => {
    const current = rule.byWeekday ?? [];
    // 曜日が1つも無い「週間ごと」は成り立たないので、最後の1つは外せない。
    if (current.includes(day) && current.length === 1) return;
    setRule({
      ...rule,
      byWeekday: current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    });
  };

  const openEndDatePicker = () =>
    DateTimePickerAndroid.open({
      value: parseDateString(endDate) ?? start,
      mode: 'date',
      onChange: (_event, picked) => {
        if (picked) setEndDate(toDateString(picked));
      },
    });

  const done = () => {
    const end: Recurrence['end'] =
      endType === 'never'
        ? { type: 'never' }
        : endType === 'until'
          ? { type: 'until', date: endDate }
          : { type: 'count', count: Number(countText) };
    onDone(normalizeRecurrence({ ...rule, interval: Number(intervalText), end }, start));
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>カスタムの繰り返し</Text>

            {/* 繰り返す間隔 */}
            <View style={styles.intervalRow}>
              <Text style={styles.label}>繰り返す間隔:</Text>
              <TextInput
                style={styles.numberInput}
                value={intervalText}
                onChangeText={(text) => setIntervalText(text.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={3}
                accessibilityLabel="繰り返す間隔"
              />
              <SelectField<RecurrenceFreq>
                accessibilityLabel="繰り返しの単位"
                options={FREQ_OPTIONS}
                value={rule.freq}
                onChange={(freq) => setRule(withFreq(rule, freq, start))}
                style={styles.freqSelect}
                textStyle={styles.selectText}
              />
            </View>

            {/* 曜日（週間ごと。複数選べる） */}
            {rule.freq === 'weekly' && (
              <View style={styles.block}>
                <Text style={styles.label}>曜日:</Text>
                <View style={styles.weekdayRow}>
                  {WEEKDAY_LABELS.map((label, day) => {
                    const selected = (rule.byWeekday ?? []).includes(day);
                    return (
                      <Pressable
                        key={day}
                        accessibilityRole="button"
                        accessibilityLabel={`${label}曜日`}
                        accessibilityState={{ selected }}
                        onPress={() => toggleWeekday(day)}
                        style={[styles.weekdayButton, selected && styles.weekdayButtonOn]}
                      >
                        <Text style={[styles.weekdayText, selected && styles.weekdayTextOn]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {/* 毎月の数え方（か月ごと）。「毎月 2日」か「毎月 第1金曜日」 */}
            {rule.freq === 'monthly' && (
              <SelectField
                accessibilityLabel="毎月の繰り返し"
                options={monthlyOptions(start)}
                value={monthlyValueOf(rule)}
                onChange={(value) => setRule(withMonthlyValue(rule, value, start))}
                style={styles.monthlySelect}
                textStyle={styles.selectText}
              />
            )}

            {/* 終了日。なし／終了日を指定／回数を指定。選んでいない項目の入力欄は薄くして押せなくする。 */}
            <View style={styles.block}>
              <Text style={styles.heading2}>終了日</Text>
              {END_TYPE_OPTIONS.map((option) => {
                const selected = endType === option.value;
                return (
                  <View key={option.value} style={styles.endRow}>
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setEndType(option.value)}
                      style={styles.radioRow}
                    >
                      <View style={[styles.radioDot, selected && styles.radioDotOn]}>
                        {selected && <View style={styles.radioDotInner} />}
                      </View>
                      <Text style={styles.radioText}>
                        {option.label}
                        {option.value === 'never' ? '' : ':'}
                      </Text>
                    </Pressable>

                    {option.value === 'until' && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="終了日"
                        disabled={!selected}
                        onPress={openEndDatePicker}
                        style={[styles.endField, !selected && styles.dimmed]}
                      >
                        <Text style={styles.endFieldText}>
                          {formatDateString(parseDateString(endDate))}
                        </Text>
                      </Pressable>
                    )}
                    {option.value === 'count' && (
                      <View style={[styles.countRow, !selected && styles.dimmed]}>
                        <TextInput
                          style={styles.numberInput}
                          value={countText}
                          onChangeText={(text) => setCountText(text.replace(/[^0-9]/g, ''))}
                          editable={selected}
                          keyboardType="number-pad"
                          inputMode="numeric"
                          maxLength={4}
                          accessibilityLabel="繰り返す回数"
                        />
                        <Text style={styles.countUnit}>回</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel}>
              <Text style={styles.cancelText}>キャンセル</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={done} style={styles.done}>
              <Text style={styles.doneText}>完了</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  content: { gap: 18, paddingBottom: 8 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  heading2: { fontSize: 14, fontWeight: '700', color: colors.text },
  label: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  block: { gap: 10 },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberInput: {
    width: 56,
    fontSize: 14,
    color: colors.textSubtle,
    fontWeight: '500',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'center',
  },
  freqSelect: { flex: 1, borderColor: colors.borderStrong, borderRadius: 8, minHeight: 42 },
  monthlySelect: { borderColor: colors.borderStrong, borderRadius: 8, minHeight: 42 },
  selectText: { flex: 1, fontWeight: '400', fontSize: 14 },
  weekdayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  weekdayButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.neutralSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayButtonOn: { backgroundColor: colors.navActive },
  weekdayText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  weekdayTextOn: { color: colors.primaryText },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 96 },
  radioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDotOn: { borderColor: colors.navActive },
  radioDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.navActive },
  radioText: { fontSize: 14, color: colors.textSubtle, fontWeight: '500' },
  endField: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  endFieldText: { fontSize: 14, color: colors.textSubtle, fontWeight: '500' },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countUnit: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  dimmed: { opacity: 0.4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 8 },
  cancel: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 },
  cancelText: { fontSize: 14, fontWeight: '700', color: colors.navActiveText },
  done: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: colors.navActive,
  },
  doneText: { fontSize: 14, fontWeight: '700', color: colors.primaryText },
});
