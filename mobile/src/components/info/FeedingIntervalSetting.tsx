import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { saveFeedingSettings, type FeedingSettings } from '@/lib/api/feedingSettings';
import { FEEDING_INTERVAL_OPTIONS, formatMinutesText } from '@/lib/feedingSchedule';
import { colors } from '@/lib/theme';
import BabyBottleIcon from '@/components/ui/BabyBottleIcon';

// 「次の授乳の目安」の設定。Web版の
// `src/components/sukusuku/FeedingIntervalSetting.tsx` を置き換えたもの。
// 家族で共通の設定なので、どちらが変えても両方の画面に同じ目安が出る。

interface FeedingIntervalSettingProps {
  familyId: string;
  settings: FeedingSettings;
  onChange: (settings: FeedingSettings) => void;
}

export default function FeedingIntervalSetting({
  familyId,
  settings,
  onChange,
}: FeedingIntervalSettingProps) {
  const [error, setError] = useState<string | null>(null);

  // 画面には先に反映し、保存に失敗したら元へ戻す（設定タブの他の項目と同じ考え方）。
  const apply = async (next: FeedingSettings) => {
    const previous = settings;
    onChange(next);
    setError(null);
    try {
      await saveFeedingSettings(supabase, familyId, next);
    } catch {
      onChange(previous);
      setError('設定を保存できませんでした。もう一度お試しください。');
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <BabyBottleIcon size={16} color={colors.milk} />
        <Text style={styles.label}>授乳の間隔</Text>
        <View style={styles.options}>
          {FEEDING_INTERVAL_OPTIONS.map((minutes) => {
            const selected = settings.intervalMinutes === minutes;
            return (
              <Pressable
                key={minutes}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                // 目安の通知は「通知」のトグル（端末ごと）で切り替えるので、ここでは常にオン。
                onPress={() => void apply({ intervalMinutes: minutes, notifyEnabled: true })}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {formatMinutesText(minutes)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // 「通知」の枠（NotificationSetting）の中に置く。上の項目とは線で区切る。
  section: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  options: { flexDirection: 'row', gap: 6 },
  option: {
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.neutralSurface,
  },
  optionSelected: { backgroundColor: colors.milkMark },
  optionText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  optionTextSelected: { color: colors.primaryText },
  error: { fontSize: 12, fontWeight: '400', color: colors.danger, marginTop: 8 },
});
