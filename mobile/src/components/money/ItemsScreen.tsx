import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronRight, Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import {
  editorLineAmount,
  evaluateCalc,
  formatCalc,
  formatYen,
  isBlankLine,
  pressCalcKey,
  type EditorLine,
} from '@/lib/moneyUtils';
import Calculator from '@/components/money/Calculator';
import { CategoryBadge, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 品目の画面（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/ItemsScreen.tsx` と同じ並び・文言。
//
// 1つの種類の品目を何行でもまとめて記録する。行＝品名・個数（−＋）・単価・金額。
// 一覧のいちばん下に空の行を置き、押すとそこに新しく入力する（入れると次の空の行が出る）。
// 選んだ行（青）の単価を下の電卓で直す（＋−×÷）。電卓はこの画面で初めて出る。

/** 品目の画面で書きかけのもの（記録の入力が持ち、ほかの画面へ行って戻っても消えない）。 */
export interface ItemsWork {
  /** 直している種類のまとまり。新しい種類なら null。 */
  groupKey: string | null;
  categoryId: string | null;
  specialItemId: string | null;
  specialPlanId: string | null;
  lines: EditorLine[];
  selected: string | null;
  /** 選んだ行の電卓の式。 */
  expr: string;
  /** 品名の欄を開いたままにする行（空の行を押した直後）。 */
  focusKey: string | null;
}

let lineSeq = 0;
export const newLineKey = () => `line-${(lineSeq += 1)}`;

export const blankLine = (): EditorLine => ({
  key: newLineKey(),
  name: '',
  quantity: 1,
  unitPrice: 0,
  productId: null,
  memo: '',
});

interface ItemsScreenProps {
  work: ItemsWork;
  onChange: (work: ItemsWork) => void;
  /** 種類の見出し（「食費 › 食料品」）と、その下の一言（今月の残り）。 */
  title: string;
  subtitle: string;
  /** 日用品から選べるか（生活費の種類だけ）。 */
  canPickProducts: boolean;
  onChangeCategory: () => void;
  onPickProducts: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export default function ItemsScreen({
  work,
  onChange,
  title,
  subtitle,
  canPickProducts,
  onChangeCategory,
  onPickProducts,
  onSave,
  onDelete,
  onClose,
}: ItemsScreenProps) {
  const filled = work.lines.filter((line) => !isBlankLine(line));
  const subtotal = work.lines.reduce((sum, line) => sum + editorLineAmount(line), 0);

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    onChange({ ...work, lines: work.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) });

  const select = (line: EditorLine) =>
    onChange({ ...work, selected: line.key, expr: line.unitPrice > 0 ? String(line.unitPrice) : '', focusKey: null });

  const addLine = () => {
    // 書きかけの空の行は残さない（空の行は保存もしない）。
    const line = blankLine();
    onChange({
      ...work,
      lines: [...work.lines.filter((entry) => !isBlankLine(entry)), line],
      selected: line.key,
      expr: '',
      focusKey: line.key,
    });
  };

  const pressKey = (key: string) => {
    let current = work;
    if (current.selected === null || !current.lines.some((line) => line.key === current.selected)) {
      const line = blankLine();
      current = { ...current, lines: [...current.lines, line], selected: line.key, expr: '' };
    }
    const expr = pressCalcKey(current.expr, key);
    const unitPrice = evaluateCalc(expr) ?? 0;
    onChange({
      ...current,
      expr,
      focusKey: null,
      lines: current.lines.map((line) => (line.key === current.selected ? { ...line, unitPrice } : line)),
    });
  };

  const removeSelected = () =>
    onChange({ ...work, lines: work.lines.filter((line) => line.key !== work.selected), selected: null, expr: '' });

  const showExpr = /[+\-*/]/.test(work.expr);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="品目"
        onClose={onClose}
        right={
          onDelete && (
            <Pressable accessibilityRole="button" accessibilityLabel="この種類の品目を消す" onPress={onDelete} hitSlop={8}>
              <Trash2 size={20} color={colors.textMuted} />
            </Pressable>
          )
        }
      />
      <Pressable accessibilityRole="button" accessibilityLabel="種類を変える" onPress={onChangeCategory} style={styles.category}>
        <CategoryBadge label={title} />
        <View style={styles.flex}>
          <Text style={styles.categoryName}>{title}</Text>
          {subtitle !== '' && <Text style={styles.categorySub}>{subtitle}</Text>}
        </View>
        <ChevronRight size={18} color={colors.textFaint} />
      </Pressable>

      <ScrollView style={styles.flex} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {canPickProducts && (
          <Pressable accessibilityRole="button" onPress={onPickProducts} style={styles.pickProducts}>
            <ShoppingBasket size={16} color={colors.moneyText} />
            <Text style={styles.pickProductsText}>日用品から選ぶ</Text>
          </Pressable>
        )}
        {work.lines.map((line) => {
          const selected = line.key === work.selected;
          return (
            <Pressable
              key={line.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => select(line)}
              style={[styles.line, selected && styles.lineSelected]}
            >
              <TextInput
                style={styles.lineName}
                value={line.name}
                onChangeText={(name) => updateLine(line.key, { name })}
                onFocus={() => (selected ? undefined : select(line))}
                placeholder="品名"
                placeholderTextColor={colors.textFaint}
                autoFocus={line.key === work.focusKey}
                returnKeyType="done"
              />
              <View style={styles.stepper}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="1つ減らす"
                  onPress={() => updateLine(line.key, { quantity: Math.max(1, line.quantity - 1) })}
                  hitSlop={4}
                  style={styles.stepButton}
                >
                  <Minus size={13} color={colors.textMuted} />
                </Pressable>
                <Text style={styles.quantity}>{line.quantity}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="1つ増やす"
                  onPress={() => updateLine(line.key, { quantity: Math.min(9999, line.quantity + 1) })}
                  hitSlop={4}
                  style={styles.stepButton}
                >
                  <Plus size={13} color={colors.textMuted} />
                </Pressable>
              </View>
              <Text style={styles.unit}>@{line.unitPrice.toLocaleString('ja-JP')}</Text>
              <Text style={styles.amount}>{formatYen(editorLineAmount(line))}</Text>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" onPress={addLine} style={styles.blank}>
          <Text style={styles.blankText}>品名（押すと新しい行に入力）</Text>
          <Text style={styles.blankAmount}>¥0</Text>
        </Pressable>
        <View style={styles.subtotalRow}>
          {work.selected !== null && (
            <Pressable accessibilityRole="button" onPress={removeSelected} hitSlop={6}>
              <Text style={styles.removeText}>選んだ行を消す</Text>
            </Pressable>
          )}
          <View style={styles.flex} />
          {showExpr && <Text style={styles.expr}>{formatCalc(work.expr)} =</Text>}
          <Text style={styles.subtotalLabel}>小計</Text>
          <Text style={styles.subtotal}>{formatYen(subtotal)}</Text>
        </View>
      </ScrollView>

      <Calculator onKey={pressKey} />
      <View style={styles.footer}>
        <PrimaryButton
          label={filled.length === 0 ? '金額を入れてください' : `この種類を保存（${filled.length}行 ${formatYen(subtotal)}）`}
          disabled={filled.length === 0}
          onPress={onSave}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  categoryName: { fontSize: 16, fontWeight: '700', color: colors.text },
  categorySub: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
  list: { paddingBottom: 8 },
  pickProducts: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    margin: 12,
    marginLeft: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.moneySoft,
  },
  pickProductsText: { fontSize: 14, fontWeight: '700', color: colors.moneyText },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineSelected: { backgroundColor: colors.moneySurface },
  lineName: { flex: 1, paddingVertical: 6, fontSize: 15, fontWeight: '500', color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  quantity: { minWidth: 16, textAlign: 'center', fontSize: 14, fontWeight: '700', color: colors.text },
  unit: { width: 56, textAlign: 'right', fontSize: 12, fontWeight: '500', color: colors.textFaint },
  amount: { width: 72, textAlign: 'right', fontSize: 15, fontWeight: '700', color: colors.text },
  blank: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  blankText: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.textFaint },
  blankAmount: { fontSize: 15, fontWeight: '600', color: colors.borderStrong },
  subtotalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 16, paddingTop: 10 },
  removeText: { fontSize: 12, fontWeight: '600', color: colors.danger },
  expr: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  subtotalLabel: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  subtotal: { fontSize: 22, fontWeight: '700', color: colors.text },
  footer: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4 },
});
