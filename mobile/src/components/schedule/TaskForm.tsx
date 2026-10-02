import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Clock, Lock, MapPin, Repeat, Star, Users, Text as TextIcon } from 'lucide-react-native';
import type { AnchorType, Participant, Task, TaskKind } from '@/types/app';
import { participantNames, useFamilyRoster } from '@/lib/familyRoster';
import {
  formatDateWithWeekday,
  parseDateString,
  parseTimeInput,
  toDateString,
} from '@/lib/dateUtils';
import { getParticipantColor } from '@/lib/uiUtils';
import { colors } from '@/lib/theme';
import SelectField from '@/components/ui/SelectField';
import {
  defaultRecurrence,
  findPresetKey,
  recurrencePresets,
  summarizeRecurrence,
  type RecurrencePresetKey,
} from '@/lib/recurrence';
import RecurrenceModal from './RecurrenceModal';

// 予定・タスクの入力欄（追加・編集で共通）。Googleカレンダーの追加画面に
// ならい、種別（予定/タスク）をまず選び、予定のときだけ場所・参加者を持つ。
//
// 「ゲスト」にあたる欄は、外部の相手を招待する仕組みではなく、家族の誰の
// 予定かを複数選べる「参加者」にしている（この家族アプリでは招待する相手が
// 常に家族の誰かのため）。ビデオ会議の追加やカレンダー選択のような、
// この家族には要らない項目は作らない。
//
// 繰り返しはGoogleカレンダーと同じく、開始日から決まる定番の選択肢（毎日・毎週 金曜日・
// 毎月 第1金曜日・毎年 10月2日・毎週平日）＋「カスタム…」（RecurrenceModal）で選ぶ。
//
// 通知の設定は持たない。予定・タスクとも、設定した日時に必ず通知する（時刻が無い
// ものは終日として朝9時。docs/calendar.md §5）。
//
// 日付・時刻はWeb版では <input> だが、React Nativeには無いので
// 端末のピッカーと選択欄で置き換えている（出す中身と並びは同じ）。

export type TaskDraft = Omit<Task, 'id' | 'done'>;

interface TaskFormProps {
  value: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  /** 誕生日が未登録のときだけ「生後日数で指定」を選べるようにする */
  allowBirthRelative: boolean;
}

const KIND_TABS: { value: TaskKind; label: string }[] = [
  { value: 'event', label: '予定' },
  { value: 'task', label: 'タスク' },
];

const SHARING_TABS: { value: boolean; label: string }[] = [
  { value: false, label: '共有（家族全員）' },
  { value: true, label: '自分だけ' },
];

export default function TaskForm({ value, onChange, allowBirthRelative }: TaskFormProps) {
  // 参加者として選べるのは家族メンバー（設定タブの「家族」の表示名の並び）。
  const roster = useFamilyRoster();
  // 予定に入っているが家族にいない名前（前の名前など）も、外せるように並べておく。
  const participantOptions = [
    ...participantNames(roster),
    ...value.participants.filter((name) => !participantNames(roster).includes(name)),
  ];
  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });

  const isEvent = value.kind === 'event';
  const isAllDay = value.startTime === null;
  // 生後日数での指定は、誕生日登録前でも作れるタスク（例:「生後14日: 出生届提出」）のためのもの。
  // 予定はこの指定を持たない。
  const showAnchorChoice = !isEvent && (allowBirthRelative || value.anchorType === 'birth_relative');

  const setKind = (kind: TaskKind) => {
    // タスクは場所・参加者・終わりの時刻を持たない。予定へ戻したときのために
    // 参加者は残し、タスクにするときは終わりの時刻だけ外す（始まりの時刻は残る）。
    // 予定は生後日数指定を持たないため、予定に切り替えたときは日付指定へ戻す。
    if (kind === 'task') {
      set({ kind, endTime: null });
    } else {
      set(value.anchorType === 'birth_relative' ? { kind, anchorType: 'absolute' } : { kind });
    }
  };

  const setAnchorType = (anchorType: AnchorType) => {
    // 繰り返しは開始日の曜日・日付から決まるため、日付が決まらない生後日数指定では持てない。
    set(anchorType === 'birth_relative' ? { anchorType, recurrence: null } : { anchorType });
  };

  const toggleAllDay = () => {
    // 終日 <-> 時刻あり。時刻ありに切り替えたときは 09:00 を初期値にする。
    set(isAllDay ? { startTime: '09:00', endTime: null } : { startTime: null, endTime: null });
  };

  // 参加者欄は1つのボタン列で「未選択→参加者→主体→未選択」の3段階を順に切り替える。
  // 主体(owner)は色分けの基準になる1人だけ。既に主体の誰かがいるところで別の人を
  // 主体にすると、入れ替わった元の主体は参加者のまま残る（参加者からは外れない）。
  const cycleParticipant = (participant: Participant) => {
    const isOwner = value.owner === participant;
    const isParticipant = value.participants.includes(participant);
    if (isOwner) {
      set({
        owner: null,
        participants: value.participants.filter((p) => p !== participant),
      });
    } else if (isParticipant) {
      set({ owner: participant });
    } else {
      set({ participants: [...value.participants, participant] });
    }
  };

  const openDatePicker = () =>
    DateTimePickerAndroid.open({
      value: parseDateString(value.startDate ?? '') ?? new Date(),
      mode: 'date',
      onChange: (_event, picked) => {
        if (picked) setStartDate(toDateString(picked));
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

  // 繰り返し。null は「繰り返さない」。選択肢はGoogleカレンダーと同じ定番＋カスタム。
  const recurrence = value.recurrence;
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  // 日付が決まらない（生後日数指定）ときは繰り返しの欄そのものを出さない。
  const baseDate = startDate;
  const presets = baseDate ? recurrencePresets(baseDate) : [];
  const currentPresetKey = baseDate ? findPresetKey(recurrence, baseDate) : null;

  // 開始日を変えたとき、定番の選択肢（毎週 金曜日 など）を選んでいたなら、
  // 新しい日付の曜日・日付に合わせ直す（Googleカレンダーと同じ）。カスタムはそのまま。
  const setStartDate = (next: string) => {
    const nextDate = parseDateString(next);
    if (recurrence && baseDate && nextDate && currentPresetKey) {
      const preset = recurrencePresets(nextDate).find((p) => p.key === currentPresetKey);
      set({ startDate: next, recurrence: preset?.recurrence ?? recurrence });
      return;
    }
    set({ startDate: next });
  };

  // 選択欄には、定番に当たらないカスタムの設定も1行（現在の要約）として並べる。
  const recurrenceOptions: { value: RecurrencePresetKey | 'current' | 'custom'; label: string }[] = [
    ...(recurrence && currentPresetKey === null
      ? [{ value: 'current' as const, label: summarizeRecurrence(recurrence, value.startDate) }]
      : []),
    ...presets.map((p) => ({ value: p.key, label: p.label })),
    { value: 'custom', label: 'カスタム…' },
  ];
  const recurrenceSelected = currentPresetKey ?? (recurrence ? 'current' : 'none');

  const pickRecurrence = (key: RecurrencePresetKey | 'current' | 'custom') => {
    if (key === 'current') return;
    if (key === 'custom') {
      setIsCustomOpen(true);
      return;
    }
    set({ recurrence: presets.find((p) => p.key === key)?.recurrence ?? null });
  };

  return (
    <View style={styles.form}>
      {/* 種別（予定/タスク） */}
      <View style={styles.switcher}>
        {KIND_TABS.map((tab) => {
          const selected = value.kind === tab.value;
          return (
            <Pressable
              key={tab.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setKind(tab.value)}
              style={[styles.switcherTab, selected && styles.switcherTabOn]}
            >
              <Text style={[styles.switcherText, selected && styles.switcherTextOn]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

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

      {/* 繰り返し。予定・タスクどちらにも設定できる。Googleカレンダーと同じく、
          定番の選択肢と「カスタム…」から選ぶ。日付が決まらない生後日数指定では出さない。 */}
      {baseDate && (
        <View>
          <View style={styles.iconLabel}>
            <Repeat size={14} color={colors.textFaint} />
            <Text style={styles.iconLabelText}>繰り返し</Text>
          </View>
          <SelectField
            accessibilityLabel="繰り返し"
            options={recurrenceOptions}
            value={recurrenceSelected}
            onChange={pickRecurrence}
            style={styles.select}
            textStyle={styles.selectText}
          />
        </View>
      )}
      {isCustomOpen && (
        <RecurrenceModal
          initial={recurrence ?? defaultRecurrence(value.startDate)}
          startDate={value.startDate}
          onCancel={() => setIsCustomOpen(false)}
          onDone={(next) => {
            set({ recurrence: next });
            setIsCustomOpen(false);
          }}
        />
      )}

      {/* 時刻（予定・タスクとも）。タスクは終わりの時刻を持たず、始まりの時刻だけ。
          時刻を決めたものはその時刻に、終日のものは朝9時に通知する。 */}
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
            {isEvent && (
              <>
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
              </>
            )}
          </View>
        )}
      </View>

      {/* 参加者（予定のみ）。1つのボタンで参加者/主体を兼ねる:
          タップで参加者に追加 → もう一度タップでその人を主体に(★付き・色付き) →
          もう一度タップで外れる。 */}
      {isEvent && (
        <View>
          <View style={styles.iconLabel}>
            <Users size={14} color={colors.textFaint} />
            <Text style={styles.iconLabelText}>参加者</Text>
          </View>
          <View style={styles.labelRow}>
            {participantOptions.map((participant) => {
              const isOwner = value.owner === participant;
              const isParticipant = value.participants.includes(participant);
              const tone = getParticipantColor(participant);
              return (
                <Pressable
                  key={participant}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isParticipant }}
                  accessibilityLabel={`${participant}${isOwner ? '（主体）' : ''}`}
                  onPress={() => cycleParticipant(participant)}
                  style={[
                    styles.labelButton,
                    isParticipant && !isOwner && styles.labelButtonParticipant,
                    isOwner && { backgroundColor: tone.background, borderColor: tone.border },
                  ]}
                >
                  <View style={styles.labelButtonContent}>
                    {isOwner && <Star size={11} color={tone.text} fill={tone.text} />}
                    <Text style={[styles.labelText, isOwner && { color: tone.text }]}>
                      {participant}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hintText}>タップで参加者に、もう一度タップで★主体に</Text>
        </View>
      )}

      {/* 場所（予定のみ） */}
      {isEvent && (
        <View>
          <View style={styles.iconLabel}>
            <MapPin size={14} color={colors.textFaint} />
            <Text style={styles.iconLabelText}>場所</Text>
          </View>
          <TextInput
            style={[styles.field, styles.fieldText]}
            value={value.place}
            onChangeText={(place) => set({ place })}
            placeholder="場所を入力"
            placeholderTextColor={colors.textFaint}
          />
        </View>
      )}

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
          placeholder="詳細を入力"
          placeholderTextColor={colors.textFaint}
          multiline
        />
      </View>

      {/* 共有設定。自分だけにすると、家族の他のメンバーには表示されなくなる。 */}
      <View>
        <View style={styles.iconLabel}>
          <Lock size={14} color={colors.textFaint} />
          <Text style={styles.iconLabelText}>共有設定</Text>
        </View>
        <View style={styles.switcher}>
          {SHARING_TABS.map((tab) => {
            const selected = value.isPrivate === tab.value;
            return (
              <Pressable
                key={String(tab.value)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => set({ isPrivate: tab.value })}
                style={[styles.switcherTab, selected && styles.switcherTabOn]}
              >
                <Text style={[styles.switcherText, selected && styles.switcherTextOn]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
  fieldText: { fontSize: 14, color: colors.textSubtle, fontWeight: '500' },
  fieldPlaceholder: { fontSize: 14, color: colors.textFaint },
  inlineField: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineLabel: { fontSize: 14, color: colors.textMuted },
  inlineInput: { flex: 1, fontSize: 14, color: colors.textSubtle, paddingVertical: 0, fontWeight: '500' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dash: { fontSize: 14, color: colors.textFaint, fontWeight: '500' },
  iconLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  iconLabelText: { fontSize: 12, fontWeight: '500', color: colors.textSubtle },
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
  labelButtonParticipant: { backgroundColor: colors.neutralSurface, borderColor: colors.borderStrong },
  labelButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  labelText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  hintText: { fontSize: 11, color: colors.textFaint, marginTop: 6 },
  noteInput: { minHeight: 96, textAlignVertical: 'top' },
  select: { borderColor: colors.borderStrong, borderRadius: 8, minHeight: 42 },
  selectText: { flex: 1, fontWeight: '400', fontSize: 14 },
});
