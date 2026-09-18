import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TemperatureLog } from '@/types/app';
import {
  BASELINE_NOTABLE_DIFF,
  CELSIUS_STEP,
  DEFAULT_CELSIUS,
  LOW_CELSIUS,
  MAX_CELSIUS,
  MIN_CELSIUS,
  URGENT_FEVER_CELSIUS,
  celsiusFromBaseline,
  formatCelsius,
  formatCelsiusDiff,
  formatNormalRange,
  isFever,
  roundCelsius,
  type TemperatureBaseline,
} from '@/lib/careLogUtils';
import { formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { DeleteButton, FieldLabel, HintBanner, NoteField, SubmitButton } from '@/components/ui/form';
import DateTimeField from '@/components/ui/DateTimeField';
import LogModalShell from '@/components/log/LogModalShell';

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
  /** この子の平熱。記録がまだ少なければ null。 */
  baseline: TemperatureBaseline | null;
  /** プロフィールに登録された子の名前。平熱を「岳の平熱」の形で出すのに使う。 */
  babyName?: string;
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
  baseline,
  babyName,
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
    <LogModalShell
      title={log ? '体温の記録を編集' : '体温を記録'}
      onClose={onClose}
      footer={
        <>
          <SubmitButton accent="temperature" onPress={handleSubmit} disabled={problem !== null}>
            保存する
          </SubmitButton>
          {log && <DeleteButton onPress={onDelete} />}
        </>
      }
    >
      {/* 何度なら高いのかは子どもによって違うので、入力欄より先にものさしを出す。 */}
      <Yardstick baseline={baseline} babyName={babyName} />

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

      {celsius !== null && problem === null && <Advice celsius={celsius} baseline={baseline} />}

      <DateTimeField label="日時" value={time} onChange={setTime} maximumDate={new Date()} />
      <NoteField value={note} onChange={setNote} placeholder="ぐったりしている / 厚着していた など" />
    </LogModalShell>
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
 * 何度なら高いのかのものさし。正常範囲と、その子自身の平熱を並べる。
 *
 * 同じ 37.2℃ でも、平熱 36.6℃ の子には高く、平熱 37.1℃ の子にはいつもどおり。
 * 一般の正常範囲だけでは足りないので、その子の平熱と2つ並べて置く。
 */
function Yardstick({
  baseline,
  babyName,
}: {
  baseline: TemperatureBaseline | null;
  babyName?: string;
}) {
  return (
    <View style={styles.yardstick}>
      <View style={[styles.yardstickBox, styles.normalBox]}>
        <Text style={styles.normalLabel}>正常範囲</Text>
        <Text style={styles.normalValue}>{formatNormalRange()}</Text>
      </View>
      <View style={[styles.yardstickBox, styles.baselineBox]}>
        <Text style={styles.baselineLabel}>{babyName ? `${babyName}の平熱` : '平熱'}</Text>
        {baseline ? (
          <Text style={styles.baselineValue}>
            {formatCelsius(baseline.celsius)}
            <Text style={styles.baselineCount}> 直近{baseline.count}回</Text>
          </Text>
        ) : (
          // 平熱が出るまでは、何回ぶん足りないのかではなく「これから分かる」ことを伝える。
          <Text style={styles.baselineEmpty}>記録が増えると出ます</Text>
        )}
      </View>
    </View>
  );
}

/**
 * 測ったその場で「様子見か、連れて行くか」まで出す。
 * 低月齢の発熱は、それ自体が受診の判断につながるため（docs/what-to-record.md §4-1）。
 */
function Advice({
  celsius,
  baseline,
}: {
  celsius: number;
  baseline: TemperatureBaseline | null;
}) {
  if (celsius >= URGENT_FEVER_CELSIUS) {
    return (
      <AdviceBanner alert>
        {formatCelsius(celsius)}。生後3か月未満の 38.0℃ 以上は、それだけで受診の目安です。
        小児科の連絡先は情報タブにあります。
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
  // ここから下は正常範囲の内。それでも平熱から離れていれば、そのことだけ伝える。
  if (baseline) {
    const diff = celsiusFromBaseline(celsius, baseline.celsius);
    if (diff >= BASELINE_NOTABLE_DIFF) {
      return (
        <AdviceBanner>
          正常範囲の内ですが、平熱より {formatCelsiusDiff(diff)} 高めです。
          機嫌と飲みっぷりを見て、気になるようならもう一度測ります。
        </AdviceBanner>
      );
    }
    if (diff <= -BASELINE_NOTABLE_DIFF) {
      return (
        <AdviceBanner>
          正常範囲の内ですが、平熱より {formatCelsiusDiff(diff)} 低めです。
          薄着や測り方が浅かったことでも下がるので、気になるようならもう一度測ります。
        </AdviceBanner>
      );
    }
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

  // 何度なら高いのかのものさし。正常範囲とその子の平熱を横に並べる。
  yardstick: { flexDirection: 'row', gap: 8 },
  yardstickBox: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  normalBox: { borderColor: colors.border, backgroundColor: colors.neutralSurface },
  normalLabel: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  normalValue: { fontSize: 13, fontWeight: '700', color: colors.textSubtle, marginTop: 1 },
  baselineBox: { borderColor: colors.temperatureBorder, backgroundColor: colors.temperatureSurface },
  baselineLabel: { fontSize: 11, fontWeight: '500', color: colors.temperature },
  baselineValue: { fontSize: 13, fontWeight: '700', color: colors.temperatureText, marginTop: 1 },
  baselineCount: { fontSize: 11, fontWeight: '500', color: colors.temperature },
  baselineEmpty: { fontSize: 11, color: colors.temperature, lineHeight: 16, marginTop: 2 },

  stepper: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  stepButton: {
    width: 56,
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
    minWidth: 88,
    flexShrink: 1,
    padding: 0,
  },
  unit: { fontSize: 16, color: colors.textMuted, flexShrink: 1 },
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
