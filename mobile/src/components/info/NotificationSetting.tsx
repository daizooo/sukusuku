import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { BellRing } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import {
  deletePushSubscription,
  hasPushSubscription,
  savePushSubscription,
} from '@/lib/api/pushSubscriptions';
import {
  getPushTokenIfAllowed,
  pushUnavailableReason,
  registerForPush,
  unregisterFromPush,
} from '@/lib/push';
import { colors } from '@/lib/theme';

// 予定のリマインダーをこの端末で受け取るかどうかの設定。
// Web版の `src/components/sukusuku/NotificationSetting.tsx` を置き換えたもので、
// 出す文言も同じにしてある（ルートの CLAUDE.md）。
//
// 受け取り方だけが違う。Web版はブラウザのWeb Push購読、こちらはFCMの登録トークン
// （src/lib/push.ts）。宛先の表は同じで、kind で見分けている。
//
// 授乳の計測中のお知らせはここの設定とは関係なく、前面サービスがそのまま出す
// （サーバーを通らないため。src/lib/nursingAlarm.ts）。

interface NotificationSettingProps {
  familyId: string;
  userId: string;
}

export default function NotificationSetting({ familyId, userId }: NotificationSettingProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const reason = pushUnavailableReason();
      if (reason) {
        if (!cancelled) {
          setUnavailableReason(reason);
          setIsChecking(false);
        }
        return;
      }

      try {
        // 端末に許可があってもDBから消えていることがある
        // (送信に失敗し続けた宛先はEdge Functionが削除するため)。
        // 両方そろっているときだけ「オン」とみなす。
        const token = await getPushTokenIfAllowed();
        const enabled = token !== null && (await hasPushSubscription(supabase, token));
        if (!cancelled) setIsEnabled(enabled);
      } catch {
        // 圏外なら分からないだけなので、オフのまま出す（触れば直る）。
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const token = await registerForPush();
      if (!token) {
        setError('通知が許可されていません。端末の設定から許可してください。');
        return;
      }
      await savePushSubscription(supabase, familyId, userId, token);
      setIsEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知をオンにできませんでした');
    } finally {
      setIsBusy(false);
    }
  }, [familyId, userId]);

  const disable = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const token = await getPushTokenIfAllowed();
      if (token) await deletePushSubscription(supabase, token);
      await unregisterFromPush();
      setIsEnabled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知をオフにできませんでした');
    } finally {
      setIsBusy(false);
    }
  }, []);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <BellRing size={18} color={colors.navActive} />
        <Text style={styles.sectionTitle}>通知</Text>
      </View>

      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.label}>この端末で予定の通知を受け取る</Text>
          <Text style={styles.note}>
            予定に設定したリマインダーの時刻に通知が届きます。端末ごとの設定なので、
            スマホとパソコンの両方で受け取るにはそれぞれでオンにしてください。
          </Text>
        </View>

        {!unavailableReason &&
          (isBusy ? (
            <ActivityIndicator color={colors.navActive} />
          ) : (
            <Switch
              accessibilityLabel="通知の切り替え"
              value={isEnabled}
              disabled={isChecking}
              onValueChange={() => void (isEnabled ? disable() : enable())}
              trackColor={{ true: colors.navActive, false: colors.borderStrong }}
              thumbColor={colors.surface}
            />
          ))}
      </View>

      {unavailableReason && <Text style={styles.note}>{unavailableReason}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  flex: { flex: 1 },
  label: { fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginTop: 4 },
  error: { fontSize: 12, color: colors.danger },
});
