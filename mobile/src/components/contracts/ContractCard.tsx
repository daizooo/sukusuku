import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import type { Contract, ContractKind } from '@/types/app';
import { KIND_LABEL, amountText, renewalBadge, type RenewalTone } from '@/lib/contractUtils';
import { colors } from '@/lib/theme';

/**
 * 契約の一覧の1枚（docs/contracts.md §7.1）。種類・名称・（自分だけ／限られた人にだけ見せているときの錠前）、
 * 会社・契約者・金額、更新日のバッジ。Web版は `src/components/sukusuku/tabs/ContractCard.tsx`。
 */

const KIND_TONE: Record<ContractKind, { surface: string; text: string }> = {
  rent: { surface: colors.diaperBadge, text: colors.diaperText },
  insurance: { surface: colors.pumpingBadge, text: colors.pumpingText },
  subscription: { surface: '#ede9fe', text: '#6d28d9' }, // violet-100 / violet-700
  other: { surface: colors.neutralSurface, text: colors.neutralBadgeText },
};

const BADGE_TONE: Record<RenewalTone, { surface: string; text: string }> = {
  alert: { surface: colors.alertSurface, text: colors.alertText },
  warn: { surface: colors.temperatureBadge, text: colors.temperatureText },
  plain: { surface: colors.neutralSurface, text: colors.neutralBadgeText },
};

export default function ContractCard({
  contract,
  contractorName,
  lockLabel,
  today,
  onPress,
}: {
  contract: Contract;
  contractorName: string | null;
  /** 見せる相手が限られているときの添え書き（「自分だけ」「夫・妻」）。全員に見せているときは null。 */
  lockLabel: string | null;
  today: string;
  onPress: () => void;
}) {
  const kind = KIND_TONE[contract.kind];
  const badge = renewalBadge(contract.renewsOn, today);
  const amount = amountText(contract);
  const meta = [contract.company, contractorName, amount].filter((part): part is string => !!part).join(' ・ ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${contract.title}を開く`}
      onPress={onPress}
      style={[styles.card, badge?.overdue && styles.cardOverdue]}
    >
      <View style={styles.top}>
        <View style={[styles.kind, { backgroundColor: kind.surface }]}>
          <Text style={[styles.kindText, { color: kind.text }]}>{KIND_LABEL[contract.kind]}</Text>
        </View>
        <Text style={styles.title}>{contract.title}</Text>
        {lockLabel && (
          <View style={styles.lock}>
            <Lock size={12} color={colors.textFaint} />
            <Text style={styles.lockText}>{lockLabel}</Text>
          </View>
        )}
      </View>
      {meta !== '' && <Text style={styles.meta}>{meta}</Text>}
      {badge && (
        <View style={[styles.badge, { backgroundColor: BADGE_TONE[badge.tone].surface }]}>
          <View style={[styles.dot, { backgroundColor: BADGE_TONE[badge.tone].text }]} />
          <Text style={[styles.badgeText, { color: BADGE_TONE[badge.tone].text }]}>{badge.text}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardOverdue: { borderColor: colors.dangerBorder },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kind: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 1 },
  kindText: { fontSize: 11, fontWeight: '800' },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lockText: { fontSize: 11, fontWeight: '600', color: colors.textFaint },
  meta: { fontSize: 12, fontWeight: '400', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
