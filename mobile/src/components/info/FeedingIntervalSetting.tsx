import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
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
      <View style={styles.sectionHeader}>
        <BabyBottleIcon size={18} color={colors.milk} />
        <Text style={styles.sectionTitle}>次の授乳の目安</Text>
      </View>

      <Text style={styles.label}>授乳の間隔</Text>
      <Text style={styles.note}>
        前回の授乳からこの時間が経った時刻を「次の目安」として、ホームと記録タブに出します。
        夫婦で共通の設定です。
      </Text>

      <View style={styles.grid}>
        {FEEDING_INTERVAL_OPTIONS.map((minutes) => {
          const selected = settings.intervalMinutes === minutes;
          return (
            <Pressable
              key={minutes}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => void apply({ ...settings, intervalMinutes: minutes })}
              style={styles.gridCell}
            >
              <View style={[styles.option, selected && styles.optionSelected]}>
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {formatMinutesText(minutes)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.flex}>
          <Text style={styles.label}>目安の時刻に通知する</Text>
          <Text style={styles.note}>
            通知をオンにしている家族の端末すべてに届きます（端末ごとの通知は上の「通知」でオンにしてください）。
            オフにしても画面の目安の表示は出ます。
          </Text>
        </View>
        <Switch
          accessibilityLabel="授乳の目安の通知の切り替え"
          value={settings.notifyEnabled}
          onValueChange={() => void apply({ ...settings, notifyEnabled: !settings.notifyEnabled })}
          trackColor={{ true: colors.navActive, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // 「通知」の枠（NotificationSetting）の中に置く。上の項目とは線で区切る。
  section: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
  label: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  note: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  gridCell: { width: '20%', padding: 3 },
  option: { borderRadius: 8, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.neutralSurface },
  optionSelected: { backgroundColor: colors.milkMark },
  optionText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  optionTextSelected: { color: colors.primaryText },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  error: { fontSize: 12, color: colors.danger, marginTop: 12 },
});
