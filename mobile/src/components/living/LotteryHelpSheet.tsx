import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { lotteryHelp } from '@/lib/subsidyLotteryUtils';
import LotteryDialog from '@/components/living/LotteryDialog';
import LotteryTestBar from '@/components/living/LotteryTestBar';

// 補助くじの「ヘルプ」（ホームのボタンから中央の枠で開く。docs/home.md §9.5）。PWA版の
// `src/components/sukusuku/living/LotteryHelpModal.tsx` と同じ文言（文言は subsidyLotteryUtils の lotteryHelp）。
// 動作確認用のテストモードも、ホームをすっきりさせるためここに置く。
// 見出しは赤い印で目立たせ、各行は「・」付きの短い1行。「：」の前は太字にする。

/** 1行を「太字の頭」と「残り」に分ける（「：」が無ければ全部残り）。 */
const splitLine = (line: string) => {
  const index = line.indexOf('：');
  return index < 0 ? { head: null, rest: line } : { head: line.slice(0, index), rest: line.slice(index + 1) };
};

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
            <View style={styles.headingRow}>
              <View style={styles.headingMark} />
              <Text style={styles.heading}>{section.heading}</Text>
            </View>
            {section.lines.map((line) => {
              const { head, rest } = splitLine(line);
              return (
                <View key={line} style={styles.lineRow}>
                  <Text style={styles.bullet}>・</Text>
                  <Text style={styles.line}>
                    {head !== null && <Text style={styles.lineHead}>{head}　</Text>}
                    {rest}
                  </Text>
                </View>
              );
            })}
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
  content: { padding: 20, gap: 18 },
  section: { gap: 6 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  headingMark: { width: 4, height: 16, borderRadius: 2, backgroundColor: '#dc2626' },
  heading: { fontSize: 15, fontWeight: '800', color: colors.text },
  lineRow: { flexDirection: 'row', paddingLeft: 4 },
  bullet: { fontSize: 13, fontWeight: '500', color: colors.textFaint, lineHeight: 20 },
  line: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textSubtle, lineHeight: 20 },
  lineHead: { fontWeight: '800', color: colors.text },
});
