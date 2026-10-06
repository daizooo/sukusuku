import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { lotteryHelp } from '@/lib/subsidyLotteryUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 補助くじのルール説明（くじ画面の「？」。docs/home.md §9）。PWA版の
// `src/components/sukusuku/living/LotteryHelpModal.tsx` と同じ文言（文言は subsidyLotteryUtils の lotteryHelp）。

export default function LotteryHelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title="補助くじのルール"
        onClose={onClose}
        footer={
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>とじる</Text>
          </Pressable>
        }
      >
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
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  heading: { fontSize: 14, fontWeight: '700', color: colors.text },
  line: { fontSize: 13, fontWeight: '500', color: colors.textSubtle, lineHeight: 19 },
  close: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.navActive },
  closeText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
});
