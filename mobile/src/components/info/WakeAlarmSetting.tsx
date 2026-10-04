import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { AlarmClock } from 'lucide-react-native';
import { isNursingForegroundServiceAvailable, requestNursingNotificationPermission } from '@/lib/nursingAlarm';
import { formatMinutesOfDay, WAKE_LEAD_MINUTES } from '@/lib/wakeAlarmPlan';
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

export default function WakeAlarmSetting() {
  const { settings, update } = useWakeAlarmSettings();
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

      {settings.enabled && (
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

      <Text style={styles.note}>
        {`次の授乳の目安がおやすみ時間のときだけ、${WAKE_LEAD_MINUTES}分前に起きるための音で知らせます。この端末だけの設定です。`}
        {'\n'}
        端末のおやすみモードで「アラームも止める」にしていると鳴りません。
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
  note: { fontSize: 12, fontWeight: '400', color: colors.textFaint, lineHeight: 18 },
  error: { fontSize: 12, fontWeight: '400', color: colors.danger },
});
