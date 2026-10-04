import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { AlarmClock, Moon } from 'lucide-react-native';
import { isNursingForegroundServiceAvailable, requestNursingNotificationPermission } from '@/lib/nursingAlarm';
import { formatDateTimeJst, formatMinutesOfDay, WAKE_LEAD_MINUTES } from '@/lib/wakeAlarmPlan';
import { useWakeAlarmStatus, type WakeAlarmStatus } from '@/lib/wakeAlarmStatus';
import { scheduleTestWakeAlarm } from '@/lib/wakeAlarm';
import { useWakeAlarmSettings } from '@/lib/wakeAlarmSettings';
import { colors } from '@/lib/theme';

// 夜間の起床アラームの設定（docs/night-wake-alarm.md §2）。
// ネイティブ版（Android）だけの機能で、Web版には出さない。
// **この端末だけの設定**。夜に授乳する側の端末でだけオンにする。

/** ピッカーに渡す日時。時刻だけが意味を持つので、日付は今日でよい。 */
const dateOfMinutes = (minutes: number): Date => {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
};

/** 予約の状態を、人が読む文にする。鳴らないときに理由が分かるようにするのが目的。 */
const describeStatus = (status: WakeAlarmStatus): { text: string; warn: boolean } => {
  switch (status.kind) {
    case 'pending':
      return { text: '予約の状態を確認しています…', warn: false };
    case 'no-family':
      return { text: '家族の情報が取れず、予約できません。通信できる状態で開き直してください。', warn: true };
    case 'error':
      return { text: `予約を組み直せませんでした（${status.message}）`, warn: true };
    case 'test':
      return { text: `テスト鳴動を ${formatDateTimeJst(status.triggerAt)} に予約しました`, warn: false };
    case 'evaluated': {
      const { evaluation, nativeTriggerAt } = status;
      if (evaluation.kind === 'off') return { text: 'オフです', warn: false };
      if (evaluation.kind === 'scheduled') {
        const text = `次のアラーム: ${formatDateTimeJst(evaluation.triggerAt)}（目安 ${formatDateTimeJst(evaluation.dueAt)}）`;
        // 予約したのに端末の目覚ましに入っていないときは、ここで気づけるようにする。
        return nativeTriggerAt === evaluation.triggerAt
          ? { text, warn: false }
          : { text: `${text} — 端末に予約できていません`, warn: true };
      }
      switch (evaluation.reason) {
        case 'nursing':
          return { text: '予約なし: 授乳中です（記録すると次の目安から予約します）', warn: false };
        case 'no-record':
          return { text: '予約なし: 授乳の記録がまだありません', warn: false };
        case 'outside-quiet':
          return {
            text: `予約なし: 次の目安 ${formatDateTimeJst(evaluation.dueAt)} はおやすみ時間の外です`,
            warn: false,
          };
        case 'too-late':
          return {
            text: `予約なし: 次の目安 ${formatDateTimeJst(evaluation.dueAt)} の${WAKE_LEAD_MINUTES}分前を過ぎています`,
            warn: false,
          };
      }
    }
  }
};

export default function WakeAlarmSetting() {
  const { settings, update } = useWakeAlarmSettings();
  const status = useWakeAlarmStatus();
  const [error, setError] = useState<string | null>(null);

  // 前面サービスの無い環境（Expo Go など）では、予約そのものができないので出さない。
  if (!isNursingForegroundServiceAvailable() || !settings) return null;

  const toggle = async (enabled: boolean) => {
    setError(null);
    try {
      await update({ ...settings, enabled });
      if (enabled && !(await requestNursingNotificationPermission())) {
        // 音は鳴るが、止めるボタンの出る通知が見えない。
        setError('通知が許可されていません。端末の設定から許可すると「起きた」ボタンが使えます。');
      }
    } catch {
      setError('設定を保存できませんでした。もう一度お試しください。');
    }
  };

  const pickTime = (key: 'startMinutes' | 'endMinutes') =>
    DateTimePickerAndroid.open({
      value: dateOfMinutes(settings.quiet[key]),
      mode: 'time',
      is24Hour: true,
      onChange: (_event, picked) => {
        if (!picked) return;
        const minutes = picked.getHours() * 60 + picked.getMinutes();
        void update({ ...settings, quiet: { ...settings.quiet, [key]: minutes } }).catch(() =>
          setError('設定を保存できませんでした。もう一度お試しください。'),
        );
      },
    });

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <AlarmClock size={16} color={colors.milk} />
        <Text style={styles.label}>夜の起床アラーム</Text>
        <Switch
          accessibilityLabel="夜の起床アラームの切り替え"
          value={settings.enabled}
          onValueChange={(value) => void toggle(value)}
          trackColor={{ true: colors.navActive, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>

      <View style={styles.row}>
        <Moon size={16} color={colors.milk} />
        <Text style={styles.label}>おやすみ時間は授乳の通知を止める</Text>
        <Switch
          accessibilityLabel="おやすみ時間は授乳の通知を止める"
          value={settings.muteFeedingNotifications}
          onValueChange={(value) =>
            void update({ ...settings, muteFeedingNotifications: value }).catch(() =>
              setError('設定を保存できませんでした。もう一度お試しください。'),
            )
          }
          trackColor={{ true: colors.navActive, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>

      {(settings.enabled || settings.muteFeedingNotifications) && (
        <View style={styles.row}>
          <Text style={styles.label}>おやすみ時間</Text>
          {(
            [
              { key: 'startMinutes', label: '開始' },
              { key: 'endMinutes', label: '終了' },
            ] as const
          ).map(({ key, label }) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`おやすみ時間の${label}`}
              onPress={() => pickTime(key)}
              style={styles.timeField}
            >
              <Text style={styles.timeLabel}>{label}</Text>
              <Text style={styles.timeText}>{formatMinutesOfDay(settings.quiet[key])}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {settings.enabled && (
        <>
          <Text style={[styles.status, describeStatus(status).warn && styles.statusWarn]}>
            {describeStatus(status).text}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void scheduleTestWakeAlarm().catch(() =>
                setError('テスト鳴動を予約できませんでした。'),
              )
            }
            style={styles.testButton}
          >
            <Text style={styles.testButtonText}>10秒後に鳴らして試す</Text>
          </Pressable>
        </>
      )}

      <Text style={styles.note}>
        {`次の授乳の目安がおやすみ時間のときだけ、${WAKE_LEAD_MINUTES}分前に起きるための音で知らせます。この端末だけの設定です。`}
        {'\n'}
        端末のおやすみモードで「アラームも止める」にしていると鳴りません。
        {'\n'}
        「通知を止める」は夜に授乳しない側の端末向けです（目安の時刻がおやすみ時間のとき、この端末には「そろそろ次の授乳」が届きません）。
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // 「通知」の枠（NotificationSetting）の中に置く。上の項目とは線で区切る。
  section: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  timeField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  timeLabel: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  timeText: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  status: { fontSize: 13, fontWeight: '500', color: colors.textSubtle, lineHeight: 19 },
  statusWarn: { color: colors.danger },
  testButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  testButtonText: { fontSize: 13, fontWeight: '500', color: colors.navActiveText },
  note: { fontSize: 12, fontWeight: '400', color: colors.textFaint, lineHeight: 18 },
  error: { fontSize: 12, fontWeight: '400', color: colors.danger },
});
