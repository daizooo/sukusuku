import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StockItem } from '@/types/app';
import { formatExpiry, formatQuantity, parseExpiryInput } from '@/lib/stockUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 「買い替えた」（防災備蓄の要対応。docs/home.md §10.2）。同じ品の新しいロットを、
// 新しい期限・数・値段で作る。PWA版の `src/components/sukusuku/modals/StockRestockModal.tsx` と同じ項目・文言。

export interface RestockInput {
  expiresOn: string | null;
  expiresMonthOnly: boolean;
  quantity: number;
  price: number | null;
  /** 古いロットを処分（削除）する。 */
  discardOld: boolean;
}

interface StockRestockSheetProps {
  /** 買い替える元のロット。 */
  item: StockItem;
  /** 古いロットが期限切れか。切れていれば、処分を初めから選んでおく。 */
  expired: boolean;
  onClose: () => void;
  onSubmit: (input: RestockInput) => void;
}

export default function StockRestockSheet({ item, expired, onClose, onSubmit }: StockRestockSheetProps) {
  const [expiry, setExpiry] = useState('');
  const [quantity, setQuantity] = useState(formatQuantity(item.quantity));
  const [price, setPrice] = useState(item.price === null ? '' : formatQuantity(item.price));
  const [discardOld, setDiscardOld] = useState(expired);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const parsed = parseExpiryInput(expiry);
    if (!parsed || parsed.expiresOn === null) {
      setError('新しい期限を「2031.08.25」か「2027.06」の形で入れてください');
      return;
    }
    const count = Number(quantity.trim());
    if (quantity.trim() === '' || !Number.isFinite(count) || count <= 0) {
      setError('数は0より大きい数字で入れてください');
      return;
    }
    const amount = price.trim() === '' ? null : Number(price.trim());
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError('値段は0以上の数字で入れてください');
      return;
    }
    onSubmit({ ...parsed, quantity: count, price: amount, discardOld });
  };

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title="買い替えた"
        onClose={onClose}
        footer={
          <Pressable accessibilityRole="button" onPress={handleSubmit} style={styles.submit}>
            <Text style={styles.submitText}>新しいロットを追加する</Text>
          </Pressable>
        }
      >
        <Text style={styles.lead}>
          {item.name}
          {item.expiresOn ? `（いまの期限 ${formatExpiry(item)}）` : ''}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>新しい期限</Text>
          <TextInput
            style={styles.input}
            value={expiry}
            onChangeText={setExpiry}
            placeholder="2031.08.25 / 2027.06"
            placeholderTextColor={colors.textFaint}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="新しい期限"
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>
              数{item.unit ? `（${item.unit}）` : ''}
            </Text>
            <TextInput
              style={styles.input}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              inputMode="decimal"
              accessibilityLabel="数"
            />
          </View>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>値段（1つあたり・円）</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              placeholder="未登録"
              placeholderTextColor={colors.textFaint}
              keyboardType="decimal-pad"
              inputMode="decimal"
              accessibilityLabel="値段"
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: discardOld }}
          onPress={() => setDiscardOld((prev) => !prev)}
          style={styles.check}
        >
          <View style={[styles.box, discardOld && styles.boxChecked]}>
            {discardOld && <Text style={styles.boxMark}>✓</Text>}
          </View>
          <Text style={styles.checkText}>古いロットは処分する</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12 },
  field: { gap: 6 },
  lead: { fontSize: 14, fontWeight: '700', color: colors.text },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    backgroundColor: colors.surface,
    fontVariant: ['tabular-nums'],
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.navActive, borderColor: colors.navActive },
  boxMark: { fontSize: 13, fontWeight: '700', color: colors.primaryText },
  checkText: { fontSize: 14, fontWeight: '500', color: colors.text },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.navActive },
  submitText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
});
