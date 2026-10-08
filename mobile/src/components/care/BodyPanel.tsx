import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, Plus, Thermometer, TrendingUp } from 'lucide-react-native';
import type { GrowthRecord, TemperatureLog } from '@/types/app';
import { formatCelsius, isFever } from '@/lib/careLogUtils';
import { WEEKDAY_LABELS, formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import GrowthChart from '@/components/log/GrowthChart';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';

// 育児タブの「からだ」。体温と身長・体重（成長）を、1つの画面で記録して振り返る。
//
// 体温は日ごとの記録の中にも出るが、ここでは日をまたいで直近の測定をまとめて見られる。
// 身長・体重は以前の「成長」の切り替えにあったもの。どちらも体のことなので1か所にまとめた。
//
// 画面のデータと保存は育児タブ（app/(tabs)/care.tsx）が持つ。ここは表示と操作の受け口だけ。

type BodyView = 'temperature' | 'growth';

/** 一覧に出す体温の件数の上限（読み込みの上限と同じ。careLogs.ts の listRecentTemperatureLogs）。 */
const TEMPERATURE_LIST_LIMIT = 60;

interface BodyPanelProps {
  /** 体温の記録。新しい順。 */
  temperatureLogs: TemperatureLog[];
  growthData: GrowthRecord[];
  /** 成長曲線の点。横軸のラベル付き。 */
  growthChartData: (GrowthRecord & { axisLabel: string })[];
  isLoadingGrowth: boolean;
  memberLabel: (id: string | null) => string;
  onBack: () => void;
  onAddTemperature: () => void;
  onEditTemperature: (log: TemperatureLog) => void;
  onAddGrowth: () => void;
  onEditGrowth: (record: GrowthRecord) => void;
}

const formatLogDate = (date: Date): string =>
  `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]})`;

export default function BodyPanel({
  temperatureLogs,
  growthData,
  growthChartData,
  isLoadingGrowth,
  memberLabel,
  onBack,
  onAddTemperature,
  onEditTemperature,
  onAddGrowth,
  onEditGrowth,
}: BodyPanelProps) {
  const [view, setView] = useState<BodyView>('temperature');
  // 体温/身長・体重は、画面のどこでの左右スワイプでも切り替える。
  const swipeHandlers = useSwipeTabs<BodyView>(['temperature', 'growth'], view, setView);

  return (
    <View style={styles.screen} {...swipeHandlers}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeft size={24} color={colors.navActive} />
        </Pressable>
        <Text style={styles.title}>からだ</Text>
      </View>

      <View style={styles.switcher}>
        <SegmentedTabs
          accessibilityLabel="からだの表示"
          value={view}
          onChange={setView}
          options={[
            {
              id: 'temperature',
              label: '体温',
              icon: (
                <Thermometer
                  size={15}
                  color={view === 'temperature' ? colors.navActiveText : colors.textSubtle}
                />
              ),
            },
            {
              id: 'growth',
              label: '身長・体重',
              icon: (
                <TrendingUp
                  size={15}
                  color={view === 'growth' ? colors.navActiveText : colors.textSubtle}
                />
              ),
            },
          ]}
        />
      </View>

      {/* スクロールするのは中身だけ。 */}
      <ScrollView contentContainerStyle={styles.content}>
        {view === 'temperature' ? (
          <>
            <Pressable accessibilityRole="button" onPress={onAddTemperature} style={styles.add}>
              <Plus size={18} color={colors.navActiveText} />
              <Text style={styles.addText}>体温を記録する</Text>
            </Pressable>

            {temperatureLogs.length === 0 ? (
              <Text style={styles.message}>記録はまだありません</Text>
            ) : (
              <View style={styles.list}>
                {temperatureLogs.map((log, index) => (
                  <Pressable
                    key={log.id}
                    accessibilityRole="button"
                    onPress={() => onEditTemperature(log)}
                    style={[styles.row, index > 0 && styles.rowDivided]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.rowDate}>
                        {formatLogDate(log.time)} {formatTimeString(log.time)}
                      </Text>
                      <Text style={styles.rowWho}>{memberLabel(log.createdBy)}が記録</Text>
                    </View>
                    <Text style={[styles.rowValue, isFever(log.celsius) && styles.rowValueFever]}>
                      {formatCelsius(log.celsius)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {temperatureLogs.length >= TEMPERATURE_LIST_LIMIT && (
              <Text style={styles.note}>直近{TEMPERATURE_LIST_LIMIT}件を表示しています</Text>
            )}
          </>
        ) : (
          <>
            <Pressable accessibilityRole="button" onPress={onAddGrowth} style={styles.add}>
              <Plus size={18} color={colors.navActiveText} />
              <Text style={styles.addText}>身長・体重を記録する</Text>
            </Pressable>

            {isLoadingGrowth && <Text style={styles.message}>読み込み中...</Text>}

            {!isLoadingGrowth && growthData.length > 0 && (
              <>
                <GrowthChart
                  title="身長の推移 (cm)"
                  points={growthChartData.map((r) => ({ axisLabel: r.axisLabel, value: r.height }))}
                  color={colors.navActive}
                  padding={2}
                />
                <GrowthChart
                  title="体重の推移 (kg)"
                  points={growthChartData.map((r) => ({ axisLabel: r.axisLabel, value: r.weight }))}
                  color={colors.pumping}
                  padding={1}
                />

                <View style={styles.list}>
                  {growthData.map((record, index) => (
                    <Pressable
                      key={record.id}
                      accessibilityRole="button"
                      onPress={() => onEditGrowth(record)}
                      style={[styles.row, index > 0 && styles.rowDivided]}
                    >
                      <Text style={styles.rowDate}>
                        {record.recordedDate}
                        {record.month !== null ? ` (生後${record.month}ヶ月)` : ''}
                      </Text>
                      <Text style={styles.growthValue}>
                        {record.height !== null ? `${record.height}cm` : '-'} /{' '}
                        {record.weight !== null ? `${record.weight}kg` : '-'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {!isLoadingGrowth && growthData.length === 0 && (
              <Text style={styles.message}>記録はまだありません</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingTop: 8 },
  back: { padding: 4 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  switcher: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.diaperSurface,
    borderWidth: 1,
    borderColor: colors.diaperBorder,
    borderRadius: 12,
    paddingVertical: 14,
  },
  addText: { fontSize: 15, fontWeight: '500', color: colors.navActiveText },
  message: { fontSize: 14, fontWeight: '400', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  note: { fontSize: 11, fontWeight: '400', color: colors.textFaint, textAlign: 'center' },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 12,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.background },
  rowDate: { fontSize: 12, color: colors.textMuted, fontWeight: '500', fontVariant: ['tabular-nums'] },
  rowWho: { fontSize: 10, color: colors.textFaint, fontWeight: '500', marginTop: 2 },
  rowValue: { fontSize: 16, fontWeight: '700', color: colors.temperature, fontVariant: ['tabular-nums'] },
  // 熱の目安（37.5℃以上）は、ほかの体温と見分けがつくよう赤にする。
  rowValueFever: { color: colors.danger },
  growthValue: { fontSize: 14, fontWeight: '500', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
});
