import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TemperatureLog } from '@/types/app';
import {
  CELSIUS_STEP,
  DEFAULT_CELSIUS,
  LOW_CELSIUS,
  MAX_CELSIUS,
  MIN_CELSIUS,
  URGENT_FEVER_CELSIUS,
  formatCelsius,
  isFever,
  roundCelsius,
} from '@/lib/careLogUtils';
import { formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { DeleteButton, FieldLabel, HintBanner, NoteField, SubmitButton } from '@/components/ui/form';
import DateTimeField from '@/components/ui/DateTimeField';

// 体温の記録。Web版には無い、ネイティブから足した記録（docs/what-to-record.md §4-1）。
//
// 入れるのは体温計に出た数字ひとつだけなので、入力もその1つに絞る。
// 熱があるときは何度も測ることになるため、前回の値から始められるようにしてある。

export interface TemperatureLogInput {
  celsius: number;
  time: Date;
  note: string;
}

interface TemperatureLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: TemperatureLog | null;
  /** 新規追加時に記録する日。過去の日を表示中でもその日に登録する。 */
  baseDate: Date;
  /** 表示中の日でいちばん新しい体温。新規追加のときの初期値と、比べる相手に使う。 */
  previous: TemperatureLog | null;
  onClose: () => void;
  onSubmit: (input: TemperatureLogInput) => void;
  onDelete: () => void;
}

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function TemperatureLogModal({
  show,
  ...props
}: TemperatureLogModalProps & { show: boolean }) {
  return (
    <Modal visible={show} animationType="slide" onRequestClose={props.onClose}>
      {show ? <TemperatureLogModalBody {...props} /> : null}
    </Modal>
  );
}

function TemperatureLogModalBody({
  log,
  baseDate,
  previous,
  onClose,
  onSubmit,
  onDelete,
}: TemperatureLogModalProps) {
  // 値は入力欄の文字列だけで持つ（ボタンでの上げ下げもこの文字列を書き換える）。
  // 数値と文字列を別々に持つと、打ちかけの「37.」のような状態でずれるため。
  const [input, setInput] = useState(() =>
    (log?.celsius ?? previous?.celsius ?? DEFAULT_CELSIUS).toFixed(1),
  );
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  const [time, setTime] = useState(() => {
    if (log) return log.time;
    const now = new Date();
    const at = new Date(baseDate);
    at.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return at;
  });
  const [note, setNote] = useState(log?.note ?? '');

  const parsed = Number(input);
  const celsius = input !== '' && Number.isFinite(parsed) ? roundCelsius(parsed) : null;
  const outOfRange = celsius !== null && (celsius < MIN_CELSIUS || celsius > MAX_CELSIUS);
  // 保存できない理由は、押せないボタンの代わりに欄の下へ出す。
  const problem =
    celsius === null
      ? '数字で入れてください（例: 37.2）。'
      : outOfRange
        ? `${MIN_CELSIUS.toFixed(1)}〜${MAX_CELSIUS.toFixed(1)}℃ の間で入れてください。`
        : null;

  // 上げ下げは、読めない値を入れている途中なら初期値から始める。
  const step = (diff: number) => {
    const from = celsius ?? previous?.celsius ?? DEFAULT_CELSIUS;
    const next = Math.min(MAX_CELSIUS, Math.max(MIN_CELSIUS, roundCelsius(from + diff)));
    setInput(next.toFixed(1));
  };

  const handleSubmit = () => {
    if (celsius === null || problem !== null) return;
    onSubmit({ celsius, time, note });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{log ? '体温の記録を編集' : '体温を記録'}</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>閉じる</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!log && previous && (
          <HintBanner accent="temperature">
            前回は {formatCelsius(previous.celsius)}（{formatTimeString(previous.time)}）。
            その値から始めています。
          </HintBanner>
        )}

        <View>
          <FieldLabel>体温（℃）</FieldLabel>
          <View style={styles.stepper}>
            <StepButton label="−" accessibilityLabel="0.1℃下げる" onPress={() => step(-CELSIUS_STEP)} />
            <View style={styles.valueBox}>
              <TextInput
                style={styles.valueInput}
                value={input}
                // 端末によっては小数点がカンマで入るので、読める形に直しておく。
                onChangeText={(value) => setInput(value.replace(',', '.'))}
                keyboardType="decimal-pad"
                inputMode="decimal"
                selectTextOnFocus
                accessibilityLabel="体温"
              />
              <Text style={styles.unit}>℃</Text>
            </View>
            <StepButton label="＋" accessibilityLabel="0.1℃上げる" onPress={() => step(CELSIUS_STEP)} />
          </View>
          {problem ? (
            <Text style={styles.errorNote}>{problem}</Text>
          ) : (
            <Text style={styles.note}>体温計に出た数字をそのまま入れます。</Text>
          )}
        </View>

        {celsius !== null && problem === null && <Advice celsius={celsius} />}

        <DateTimeField label="日時" value={time} onChange={setTime} maximumDate={new Date()} />
        <NoteField value={note} onChange={setNote} placeholder="ぐったりしている / 厚着していた など" />
        <SubmitButton accent="temperature" onPress={handleSubmit} disabled={problem !== null}>
          保存する
        </SubmitButton>
        {log && <DeleteButton onPress={onDelete} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function StepButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.stepButton}
    >
      <Text style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

/**
 * 測ったその場で「様子見か、連れて行くか」まで出す。
 * 低月齢の発熱は、それ自体が受診の判断につながるため（docs/what-to-record.md §4-1）。
 */
function Advice({ celsius }: { celsius: number }) {
  if (celsius >= URGENT_FEVER_CELSIUS) {
    return (
      <AdviceBanner alert>
        {formatCelsius(celsius)}。生後3か月未満の 38.0℃ 以上は、それだけで受診の目安です。
        小児科の連絡先はPWA版の情報タブにあります。
      </AdviceBanner>
    );
  }
  if (celsius < LOW_CELSIUS) {
    return (
      <AdviceBanner alert>
        {formatCelsius(celsius)}。測り方が浅かった可能性もあるので測り直して、
        それでも低ければ受診の目安です。
      </AdviceBanner>
    );
  }
  if (isFever(celsius)) {
    return (
      <AdviceBanner>
        {formatCelsius(celsius)}。厚着や部屋の暑さを取ってから、30分ほどあけてもう一度測ります。
      </AdviceBanner>
    );
  }
  return null;
}

function AdviceBanner({ alert, children }: { alert?: boolean; children: ReactNode }) {
  return (
    <View style={[styles.advice, alert && styles.adviceAlert]}>
      <Text style={[styles.adviceText, alert && styles.adviceAlertText]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  close: { fontSize: 13, color: colors.textMuted },
  content: { padding: 16, gap: 16, paddingBottom: 48 },

  stepper: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  stepButton: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.temperatureBorder,
    backgroundColor: colors.temperatureSurface,
    borderRadius: 12,
  },
  stepButtonText: { fontSize: 24, fontWeight: '700', color: colors.temperatureText },
  valueBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingVertical: 10,
  },
  valueInput: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    minWidth: 110,
    padding: 0,
  },
  unit: { fontSize: 16, color: colors.textMuted },
  note: { fontSize: 11, color: colors.textFaint, marginTop: 6 },
  errorNote: { fontSize: 11, color: colors.danger, marginTop: 6 },

  advice: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderColor: colors.temperatureBorder,
    backgroundColor: colors.temperatureSurface,
  },
  adviceAlert: { borderColor: colors.danger, backgroundColor: colors.alertSurface },
  adviceText: { fontSize: 12, lineHeight: 18, color: colors.temperatureText },
  adviceAlertText: { color: colors.alertText },
});
