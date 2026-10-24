import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { CATEGORY_ICON_COLORS, MONEY_ICONS } from '@/lib/moneyUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { CategoryIcon, PrimaryButton } from '@/components/money/moneyVisual';

// 大分類のアイコン（絵と色）を選ぶシート（年間予算の変動費の枠。docs/kakei.md §0.8）。
// アイコンをタップすると色を選べる（出金元のアイコンの色と同じ候補）。選んだものは「決める」で返す（保存は呼び出し側）。
// 家計の設定の「カテゴリ」の `CategorySheet` と同じ見た目。

export default function CategoryIconPicker({
  icon: initialIcon,
  iconColor: initialColor,
  onClose,
  onSubmit,
}: {
  /** アイコンの key（moneyUtils の MONEY_ICONS）。 */
  icon: string;
  /** 色（#rrggbb）。null は標準（アイコンごとの色）。 */
  iconColor: string | null;
  onClose: () => void;
  onSubmit: (icon: string, iconColor: string | null) => void;
}) {
  const [icon, setIcon] = useState(initialIcon);
  const [iconColor, setIconColor] = useState<string | null>(initialColor);
  const [pickingColor, setPickingColor] = useState(false);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell title="アイコンと色" onClose={onClose} footer={<PrimaryButton label="決める" onPress={() => onSubmit(icon, iconColor)} />}>
        <View style={styles.field}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="アイコンの色を選ぶ"
            accessibilityState={{ expanded: pickingColor }}
            onPress={() => setPickingColor((open) => !open)}
            style={styles.preview}
          >
            <CategoryIcon iconKey={iconColor ? `${icon}|${iconColor}` : icon} size={48} />
            <Text style={styles.previewText}>タップして色を選ぶ</Text>
          </Pressable>
          {pickingColor && (
            <View style={styles.colors}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="標準の色"
                accessibilityState={{ selected: iconColor === null }}
                onPress={() => setIconColor(null)}
                style={[styles.swatch, styles.swatchDefault, iconColor === null && styles.swatchSelected]}
              >
                <CategoryIcon iconKey={icon} size={26} />
              </Pressable>
              {CATEGORY_ICON_COLORS.map((entry) => (
                <Pressable
                  key={entry.color}
                  accessibilityRole="button"
                  accessibilityLabel={entry.label}
                  accessibilityState={{ selected: iconColor === entry.color }}
                  onPress={() => setIconColor(entry.color)}
                  style={[styles.swatch, { backgroundColor: entry.color }, iconColor === entry.color && styles.swatchSelected]}
                >
                  {iconColor === entry.color && <Check size={18} color="#ffffff" />}
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.icons}>
            {MONEY_ICONS.map((entry) => (
              <Pressable
                key={entry.key}
                accessibilityRole="button"
                accessibilityLabel={entry.label}
                accessibilityState={{ selected: icon === entry.key }}
                onPress={() => setIcon(entry.key)}
                style={[styles.iconChoice, icon === entry.key && styles.iconChoiceSelected]}
              >
                <CategoryIcon iconKey={iconColor ? `${entry.key}|${iconColor}` : entry.key} size={34} />
              </Pressable>
            ))}
          </View>
        </View>
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  iconChoice: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChoiceSelected: { borderColor: colors.money },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  previewText: { fontSize: 13, fontWeight: '600', color: colors.money },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 4 },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchDefault: { backgroundColor: colors.neutralSurface },
  swatchSelected: { borderWidth: 3, borderColor: colors.text },
});
