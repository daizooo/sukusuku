import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CareLog, SpitupAmount, SpitupLog } from '@/types/app';
import {
  SPITUP_AMOUNT_OPTIONS,
  SPITUP_REPEAT_COUNT,
  findMilkBefore,
  formatMinutesAfterMilk,
  getLogTitle,
  needsSpitupAttention,
} from '@/lib/careLogUtils';
import { formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import { DeleteButton, FieldLabel, NoteField, SubmitButton } from '@/components/ui/form';
import DateTimeField from '@/components/ui/DateTimeField';

// 吐き戻しの記録。メモ欄にいちばん多く書かれていた中身を形にしたもの
// （docs/what-to-record.md §11-3）。
//
// 入れるのは量の3択ひとつだけ。3つのうち1つを押すことが「吐き戻しがあった」の入力を
// 兼ねているので、選ばずに保存はできない（既定値を置くと、押されないまま保存されて
// うんちのかたさ3択と同じことになる）。
//
// 直前の授乳との間隔は、こちらで数えて添える。ゲップや抱き方を変えた効きめを
// 見るときの手がかりになる。

export interface SpitupLogInput {
  amount: SpitupAmount;
  minutesAfterMilk?: number;
  time: Date;
  note: string;
}

interface SpitupLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: SpitupLog | null;
  /** 新規追加時に記録する日。過去の日を表示中でもその日に登録する。 */
  baseDate: Date;
  /** 表示中の日の記録。直前の授乳と、その日の何回目かを数えるのに使う。 */
  dayLogs: CareLog[];
  onClose: () => void;
  onSubmit: (input: SpitupLogInput) => void;
  onDelete: () => void;
}

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function SpitupLogModal({
  show,
  ...props
}: SpitupLogModalProps & { show: boolean }) {
  return (
    <Modal visible={show} animationType="slide" onRequestClose={props.onClose}>
      {show ? <SpitupLogModalBody {...props} /> : null}
    </Modal>
  );
}

function SpitupLogModalBody({
  log,
  baseDate,
  dayLogs,
  onClose,
  onSubmit,
  onDelete,
}: SpitupLogModalProps) {
  // 新規は選ばれていない状態から始める（押すこと自体が「吐き戻しがあった」の入力）。
  const [amount, setAmount] = useState<SpitupAmount | null>(log?.amount ?? null);
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  const [time, setTime] = useState(() => {
    if (log) return log.time;
    const now = new Date();
    const at = new Date(baseDate);
    at.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return at;
  });
  const [note, setNote] = useState(log?.note ?? '');

  // 時刻を動かせば結び付く授乳も変わるので、そのつど探し直す。
  const candidate = useMemo(() => findMilkBefore(dayLogs, time), [dayLogs, time]);
  const [linked, setLinked] = useState(
    log ? log.minutesAfterMilk !== undefined : candidate !== null,
  );
  // 編集で、結び付いていた授乳が表示中の日に見つからないとき（日をまたいだ授乳）は、
  // 保存されている間隔をそのまま残す。
  const storedMinutes = log?.minutesAfterMilk;
  const minutesAfterMilk = linked ? (candidate?.minutesAfter ?? storedMinutes) : undefined;
  const showLink = candidate !== null || storedMinutes !== undefined;

  // この記録がその日の何回目になるか。時刻を動かせば順番も変わるので、そのつど数え直す。
  const ordinal = useMemo(
    () =>
      dayLogs.filter(
        (other) =>
          other.type === 'spitup' &&
          other.id !== log?.id &&
          other.time.getTime() <= time.getTime(),
      ).length + 1,
    [dayLogs, log, time],
  );

  const handleSubmit = () => {
    if (amount === null) return;
    onSubmit({ amount, minutesAfterMilk, time, note });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{log ? '吐き戻しの記録を編集' : '吐き戻しを記録'}</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>閉じる</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View>
          <FieldLabel>どれくらい吐いたか</FieldLabel>
          <View style={styles.choices}>
            {SPITUP_AMOUNT_OPTIONS.map((option) => {
              const selected = option.value === amount;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setAmount(option.value)}
                  style={[styles.choice, selected && styles.choiceSelected]}
                >
                  <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
                    {option.label}
                  </Text>
                  <Text style={styles.choiceDescription}>{option.description}</Text>
                </Pressable>
              );
            })}
          </View>
          {amount === null && <Text style={styles.note}>どれか1つを選ぶと保存できます。</Text>}
        </View>

        {showLink && (
          <View>
            <FieldLabel>直前の授乳</FieldLabel>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: linked }}
              onPress={() => setLinked((current) => !current)}
              style={[styles.link, linked && styles.linkOn]}
            >
              <View style={[styles.checkbox, linked && styles.checkboxOn]}>
                {linked && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.linkText, linked && styles.linkTextOn]}>
                {candidate
                  ? `${formatTimeString(candidate.log.time)} の${getLogTitle(candidate.log)}のあと` +
                    `（${candidate.minutesAfter}分後）`
                  : `${formatMinutesAfterMilk(storedMinutes ?? 0)}として記録されています`}
              </Text>
            </Pressable>
            <Text style={styles.note}>
              授乳と関係なく吐いたときは、外して保存します。
            </Text>
          </View>
        )}

        {amount !== null && <Advice amount={amount} ordinal={ordinal} />}

        <DateTimeField label="日時" value={time} onChange={setTime} maximumDate={new Date()} />
        <NoteField value={note} onChange={setNote} placeholder="ゲップは出ていた / 縦抱きにしていた など" />
        <SubmitButton accent="spitup" onPress={handleSubmit} disabled={amount === null}>
          保存する
        </SubmitButton>
        {log && <DeleteButton onPress={onDelete} />}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * 吐いたその場で「様子見か、連れて行くか」まで出す。体温と同じ扱い
 * （docs/what-to-record.md §4-1・§11-3）。
 */
function Advice({ amount, ordinal }: { amount: SpitupAmount; ordinal: number }) {
  if (needsSpitupAttention(amount)) {
    return (
      <AdviceBanner alert>
        勢いよく飛ぶような吐き方は、1回だけでも受診の目安です。
        小児科の連絡先はPWA版の情報タブにあります。
      </AdviceBanner>
    );
  }
  if (ordinal >= SPITUP_REPEAT_COUNT) {
    return (
      <AdviceBanner alert>
        この日{ordinal}回目です。おしっこの回数が減っていないか見てください。
        足りているかはそこで分かります。減っていれば受診の目安です。
      </AdviceBanner>
    );
  }
  if (amount === 'lot') {
    return (
      <AdviceBanner>
        飲んだあと10〜15分は縦に抱いて、ゲップを待ってから寝かせます。
        機嫌がよくて体重が増えていれば、量が多くても心配は要りません。
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

  choices: { gap: 8 },
  choice: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  choiceSelected: { borderColor: colors.spitup, backgroundColor: colors.spitupSurface },
  choiceLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  choiceLabelSelected: { color: colors.spitupText },
  choiceDescription: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  note: { fontSize: 11, color: colors.textFaint, marginTop: 6 },

  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  linkOn: { borderColor: colors.spitup, backgroundColor: colors.spitupSurface },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: colors.spitup, backgroundColor: colors.spitup },
  checkmark: { fontSize: 12, fontWeight: '700', color: colors.primaryText },
  linkText: { flex: 1, fontSize: 13, color: colors.textSubtle },
  linkTextOn: { color: colors.spitupText, fontWeight: '700' },

  advice: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderColor: colors.spitupBorder,
    backgroundColor: colors.spitupSurface,
  },
  adviceAlert: { borderColor: colors.danger, backgroundColor: colors.alertSurface },
  adviceText: { fontSize: 12, lineHeight: 18, color: colors.spitupText },
  adviceAlertText: { color: colors.alertText },
});
