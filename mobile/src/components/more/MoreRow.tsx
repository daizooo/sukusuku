import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors } from '@/lib/theme';

/**
 * その他タブの1行（docs/family-app.md §4.5）。色つきの丸いアイコン・名前・ひとこと・
 * 必要なら件数や期限のバッジ・右の矢印。押すとその画面へ。
 * Web版は `src/components/sukusuku/tabs/MoreRow.tsx`。
 */

export type MoreBadgeTone = 'alert' | 'warn' | 'ok' | 'plain';

const BADGE: Record<MoreBadgeTone, { surface: string; text: string }> = {
  alert: { surface: colors.alertSurface, text: colors.alertText },
  warn: { surface: colors.milestoneSurface, text: colors.milestoneText },
  ok: { surface: colors.doneSurface, text: colors.doneText },
  plain: { surface: colors.neutralSurface, text: colors.neutralBadgeText },
};

export default function MoreRow({
  icon,
  tintSurface,
  title,
  description,
  badge,
  badgeTone = 'plain',
  accessibilityLabel,
  onPress,
}: {
  icon: ReactNode;
  /** アイコンを載せる丸の地の色（アイコン自身の色は呼び出し側で付ける）。 */
  tintSurface: string;
  title: string;
  description: string;
  badge?: string;
  badgeTone?: MoreBadgeTone;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const tone = BADGE[badgeTone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (badge ? `${title}（${badge}）` : title)}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.chip, { backgroundColor: tintSurface }]}>{icon}</View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: tone.surface }]}>
            <View style={[styles.badgeDot, { backgroundColor: tone.text }]} />
            <Text style={[styles.badgeText, { color: tone.text }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <ChevronRight size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  rowPressed: { backgroundColor: colors.background },
  chip: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  description: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
