import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
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
        void apply({ ...settings, [key]: time });
      },
    });

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Thermometer size={18} color={colors.temperature} />
        <Text style={styles.sectionTitle}>検温のお知らせ</Text>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.flex}>
          <Text style={styles.label}>決まった時刻にお知らせする</Text>
          <Text style={styles.note}>
            毎日同じ時刻に測ると平熱が分かり、「この子にしては高い」に気づけます。
            通知をオンにしている家族の端末すべてに届きます（端末ごとの通知は上の「通知」でオンにしてください）。
          </Text>
        </View>
        <Switch
          accessibilityLabel="検温のお知らせの切り替え"
          value={settings.enabled}
          onValueChange={() => void apply({ ...settings, enabled: !settings.enabled })}
          trackColor={{ true: colors.navActive, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>

      <View style={styles.timeRow}>
        {(
          [
            { key: 'morningTime', label: '朝' },
            { key: 'eveningTime', label: '夕方' },
          ] as const
        ).map(({ key, label }) => (
          <View key={key} style={styles.flex}>
            <Text style={styles.timeLabel}>{label}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}の時刻`}
              disabled={!settings.enabled}
              onPress={() => openTimePicker(key)}
              style={[styles.timeField, !settings.enabled && styles.timeFieldDisabled]}
            >
              <Text style={[styles.timeText, !settings.enabled && styles.timeTextDisabled]}>
                {settings[key]}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>

      <Text style={styles.note}>
        その時刻の1時間前までに測っていれば、その回のお知らせは届きません。
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  label: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  note: { fontSize: 12, color: colors.textMuted, marginTop: 12, lineHeight: 18 },
  timeRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timeLabel: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginBottom: 4 },
  timeField: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  timeFieldDisabled: { backgroundColor: colors.background },
  timeText: { fontSize: 14, color: colors.textSubtle, fontWeight: '500' },
  timeTextDisabled: { color: colors.textFaint },
  error: { fontSize: 12, color: colors.danger, marginTop: 12 },
});
