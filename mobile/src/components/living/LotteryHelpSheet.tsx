import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { lotteryHelp } from '@/lib/subsidyLotteryUtils';
import LotteryDialog from '@/components/living/LotteryDialog';
import LotteryTestBar from '@/components/living/LotteryTestBar';

// 補助くじの「ヘルプ」（ホームのボタンから中央の枠で開く。docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryHelpModal.tsx` と同じ文言（文言は subsidyLotteryUtils の lotteryHelp）。
// 動作確認用のテストモードも、ホームをすっきりさせるためここに置く。

interface LotteryHelpSheetProps {
  onClose: () => void;
  testMode: boolean;
  onToggleTest: (value: boolean) => void;
  testCount: number;
  onDeleteTest: () => void;
  isDeletingTest: boolean;
}

export default function LotteryHelpSheet({
  onClose,
  testMode,
  onToggleTest,
  testCount,
  onDeleteTest,
  isDeletingTest,
}: LotteryHelpSheetProps) {
  return (
    <LotteryDialog title="ヘルプ" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.content}>
        {lotteryHelp().map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading}>{section.heading}</Text>
            {section.lines.map((line) => (
              <Text key={line} style={styles.line}>
                {line}
              </Text>
            ))}
          </View>
        ))}
        <LotteryTestBar
          testMode={testMode}
          onToggle={onToggleTest}
          testCount={testCount}
          onDelete={onDeleteTest}
          isDeleting={isDeletingTest}
        />
      </ScrollView>
    </LotteryDialog>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  section: { gap: 6 },
  heading: { fontSize: 14, fontWeight: '700', color: colors.text },
  line: { fontSize: 13, fontWeight: '500', color: colors.textSubtle, lineHeight: 19 },
});
