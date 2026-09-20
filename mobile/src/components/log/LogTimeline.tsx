import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Droplet, Milk, Thermometer, User } from 'lucide-react-native';
import type { CareLog } from '@/types/app';
import {
  BADGE_TONE_COLORS,
  getLogBadges,
  getLogTimeText,
  getLogTitle,
  isAlertLog,
} from '@/lib/careLogUtils';
import { isLocalCareLogId } from '@/lib/offline/careLogs';
import { colors } from '@/lib/theme';
import BabyBottleIcon from '@/components/ui/BabyBottleIcon';

// その日の記録の一覧。Web版の記録タブのタイムライン
// （src/components/sukusuku/tabs/LogTab.tsx）と同じ形にしてある。
//
// 左に1本の縦線を通し、記録ごとに種類の印を丸で線の上に重ねる。
// どれもタップするとその種類の入力画面が開く。

/** 線の上に置く丸の大きさ。Web版の w-8 h-8。 */
const DOT = 32;
/** 丸を貫く縦線の位置。丸の中心に来るようにする。 */
const RAIL = DOT;

const TYPE_ICON: Record<CareLog['type'], React.ReactNode> = {
  milk: <BabyBottleIcon size={16} color={colors.milk} />,
  diaper: <Droplet size={16} color={colors.diaper} />,
  pumping: <Milk size={16} color={colors.pumping} />,
  temperature: <Thermometer size={16} color={colors.temperature} />,
};

/** 丸の地の色。Web版の getLogColor と同じ割り当て。 */
const TYPE_SURFACE: Record<CareLog['type'], string> = {
  milk: colors.milkBadge,
  diaper: colors.diaperBadge,
  pumping: colors.pumpingBadge,
  temperature: colors.temperatureBadge,
};

interface LogTimelineProps {
  logs: CareLog[];
  memberLabel: (id: string | null) => string;
  onSelect: (log: CareLog) => void;
}

export default function LogTimeline({ logs, memberLabel, onSelect }: LogTimelineProps) {
  if (logs.length === 0) return null;

  return (
    <View style={styles.list}>
      {/* 記録をつなぐ1本の線。間が空いても切れないよう、一覧の側に持たせる。 */}
      <View style={styles.rail} />

      {logs.map((log) => (
        <View key={log.id} style={styles.row}>
          <View style={styles.dotColumn}>
            <View style={[styles.dot, { backgroundColor: TYPE_SURFACE[log.type] }]}>
              {TYPE_ICON[log.type]}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => onSelect(log)}
            style={[styles.card, isAlertLog(log) && styles.alertCard]}
          >
            <View style={styles.titleRow}>
              <View style={styles.titleGroup}>
                <Text style={styles.title}>{getLogTitle(log)}</Text>
                <Badges log={log} />
              </View>
              <Text style={styles.time}>
                {getLogTimeText(log)}
              </Text>
            </View>

            <View style={styles.footer}>
              {/* メモは書いたときだけ出す。「メモなし」を並べても読むものが増えるだけなので出さない。 */}
              <Text style={styles.note} numberOfLines={1}>
                {log.note}
              </Text>
              <View style={styles.author}>
                <User size={11} color={colors.textFaint} />
                <Text style={styles.authorText}>
                  {memberLabel(log.createdBy)}が記録
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function Badges({ log }: { log: CareLog }) {
  const badges = getLogBadges(log);
  // まだ送れていない記録は、この端末の中にしか無いことが分かるようにしておく。
  const unsent = isLocalCareLogId(log.id);
  if (badges.length === 0 && !unsent) return null;

  return (
    <View style={styles.badges}>
      {badges.map((badge) => {
        const tone = BADGE_TONE_COLORS[badge.tone];
        return (
          <View key={badge.text} style={[styles.badge, { backgroundColor: tone.background }]}>
            {badge.swatch && <View style={[styles.swatch, { backgroundColor: badge.swatch }]} />}
            <Text
              style={[styles.badgeText, { color: tone.text }, tone.bold && styles.badgeTextBold]}
            >
              {badge.text}
            </Text>
          </View>
        );
      })}
      {unsent && (
        <View style={[styles.badge, { backgroundColor: colors.neutralSurface }]}>
          <Text style={[styles.badgeText, { color: colors.neutralBadgeText }]}>
            未送信
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 14, paddingBottom: 24 },
  rail: {
    position: 'absolute',
    top: 0,
    bottom: 24,
    left: RAIL / 2 - 1,
    width: 2,
    backgroundColor: colors.border,
  },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dotColumn: { width: RAIL, alignItems: 'center' },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // 線を隠すための縁。地と同じ色にして、丸のところで線が途切れて見えるようにする。
    borderWidth: 4,
    borderColor: colors.background,
  },

  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  alertCard: { borderColor: colors.dangerBorder, borderLeftWidth: 4, borderLeftColor: colors.danger },

  // 見出し・バッジ・時刻を1段にまとめて、バッジ専用の行を無くす。
  // これでバッジの有無によってカードの高さが変わらなくなる。
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleGroup: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  time: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeText: { fontSize: 10, fontWeight: '500', fontVariant: ['tabular-nums'] },
  badgeTextBold: { fontWeight: '700' },
  swatch: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: colors.borderStrong },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  note: { flex: 1, fontSize: 12, color: colors.textSubtle },
  author: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  authorText: { fontSize: 11, color: colors.textFaint, fontWeight: '500' },
});
