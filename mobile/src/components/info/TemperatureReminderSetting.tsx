import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Thermometer } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import {
  saveTemperatureReminderSettings,
  type TemperatureReminderSettings,
} from '@/lib/api/temperatureReminderSettings';
import { parseTimeInput } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';

// 検温のお知らせの設定。Web版の
// `src/components/sukusuku/TemperatureReminderSetting.tsx` を置き換えたもの。
// 家族で共通の設定なので、どちらが変えても両方の端末に同じ時刻で届く。

interface TemperatureReminderSettingProps {
  familyId: string;
  settings: TemperatureReminderSettings;
  onChange: (settings: TemperatureReminderSettings) => void;
}

export default function TemperatureReminderSetting({
  familyId,
  settings,
  onChange,
}: TemperatureReminderSettingProps) {
  const [error, setError] = useState<string | null>(null);

  // 画面には先に反映し、保存に失敗したら元へ戻す（設定タブの他の項目と同じ考え方）。
  const apply = async (next: TemperatureReminderSettings) => {
    const previous = settings;
    onChange(next);
    setError(null);
    try {
      await saveTemperatureReminderSettings(supabase, familyId, next);
    } catch {
      onChange(previous);
      setError('設定を保存できませんでした。もう一度お試しください。');
    }
  };

  // Web版は <input type="time"> なので打ち間違いの途中も起こるが、
  // こちらは端末のピッカーで選ぶので、返ってくる時刻はいつも形が整っている。
  const openTimePicker = (key: 'morningTime' | 'eveningTime') =>
    DateTimePickerAndroid.open({
      value: parseTimeInput(settings[key]),
      mode: 'time',
      is24Hour: true,
      onChange: (_event, picked) => {
        if (!picked) return;
        const time = `${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`;
        // お知らせは「通知」のトグル（端末ごと）で切り替えるので、ここでは常にオン。
        void apply({ ...settings, enabled: true, [key]: time });
      },
    });

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Thermometer size={16} color={colors.temperature} />
        <Text style={styles.label}>検温</Text>
        {(
          [
            { key: 'morningTime', label: '朝' },
            { key: 'eveningTime', label: '夕' },
          ] as const
        ).map(({ key, label }) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`${label}の検温の時刻`}
            onPress={() => openTimePicker(key)}
            style={styles.timeField}
          >
            <Text style={styles.timeLabel}>{label}</Text>
            <Text style={styles.timeText}>{settings[key]}</Text>
          </Pressable>
        ))}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // 「通知」の枠（NotificationSetting）の中に置く。上の項目とは線で区切る。
  section: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
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
  error: { fontSize: 12, fontWeight: '400', color: colors.danger, marginTop: 8 },
});
