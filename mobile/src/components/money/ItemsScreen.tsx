import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronRight, Minus, Plus, Trash2 } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import {
  editorLineAmount,
  evaluateCalc,
  formatBalance,
  formatCalc,
  isBlankLine,
  pressCalcKey,
  type EditorLine,
} from '@/lib/moneyUtils';
import Calculator from '@/components/money/Calculator';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 品目の画面（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/ItemsScreen.tsx` と同じ並び・文言。
//
// 1つのカテゴリの品目を何行でもまとめて記録する。行＝品名・個数（−＋）・単価・金額。
// 一覧のいちばん下に空の行を置き、一覧の左端の「−」でその行を消し、いちばん下の「＋」で新しい行を足す（品名の欄は開かない。キーボードが立ち上がらないように。2026-10-15）。
// 選んだ行（青）の単価を下の電卓で直す（＋−×÷）。電卓はこの画面で初めて出る。
// 値引き・割引・返金は「マイナスにする」で、選んだ行の金額をマイナスにする（docs/kakei.md §10.5）。
// カテゴリは見出しの下に1行で小さく出す（押すと変えられる）。

/** 品目の画面で書きかけのもの（記録の入力が持ち、ほかの画面へ行って戻っても消えない）。 */
export interface ItemsWork {
  /** 直しているカテゴリのまとまり。新しいカテゴリなら null。 */
  groupKey: string | null;
  categoryId: string | null;
  /** 削除したカテゴリの名前（categoryId が null のとき）。 */
  categoryName: string;
  lines: EditorLine[];
  selected: string | null;
  /** 選んだ行の電卓の式。 */
  expr: string;
}

let lineSeq = 0;
export const newLineKey = () => `line-${(lineSeq += 1)}`;

export const blankLine = (): EditorLine => ({
  key: newLineKey(),
  name: '',
  quantity: 1,
  unitPrice: 0,
  memo: '',
});

interface ItemsScreenProps {
  work: ItemsWork;
  onChange: (work: ItemsWork) => void;
  /** カテゴリの見出し（「食費 › 食料品」）と、その下の一言（今月の残り）。 */
  title: string;
  /** カテゴリのアイコン。 */
  iconKey: string;
  subtitle: string;
  onChangeCategory: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export default function ItemsScreen({
  work,
  onChange,
  title,
  iconKey,
  subtitle,
  onChangeCategory,
  onSave,
  onDelete,
  onClose,
}: ItemsScreenProps) {
  const filled = work.lines.filter((line) => !isBlankLine(line));
  const subtotal = work.lines.reduce((sum, line) => sum + editorLineAmount(line), 0);

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    onChange({ ...work, lines: work.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) });

  const select = (line: EditorLine) =>
    onChange({ ...work, selected: line.key, expr: line.unitPrice !== 0 ? String(Math.abs(line.unitPrice)) : '' });

  // 行を足したとき、新しい行が見える所まで一覧を送る（品名の欄は開かない）。
  const scrollRef = useRef<ScrollView>(null);
  const scrollToNew = useRef(false);

  const addLine = () => {
    // 書きかけの空の行は残さない（空の行は保存もしない）。
    // 品名の欄は開かない（キーボードが立ち上がって電卓と一覧が隠れるため。品名は欄を押して入れる）。
    const line = blankLine();
    scrollToNew.current = !work.lines.some(isBlankLine);
    onChange({
      ...work,
      lines: [...work.lines.filter((entry) => !isBlankLine(entry)), line],
      selected: line.key,
      expr: '',
    });
  };

  const pressKey = (key: string) => {
    let current = work;
    if (current.selected === null || !current.lines.some((line) => line.key === current.selected)) {
      const line = blankLine();
      current = { ...current, lines: [...current.lines, line], selected: line.key, expr: '' };
    }
    const expr = pressCalcKey(current.expr, key);
    const value = evaluateCalc(expr) ?? 0;
    onChange({
      ...current,
      expr,
      // 電卓は金額の大きさだけを扱い、マイナスの行はマイナスのまま。
      lines: current.lines.map((line) =>
        line.key === current.selected ? { ...line, unitPrice: line.unitPrice < 0 ? -value : value } : line,
      ),
    });
  };

  const selectedLine = work.lines.find((line) => line.key === work.selected) ?? null;

  const toggleSign = () => {
    if (!selectedLine) return;
    updateLine(selectedLine.key, { unitPrice: -selectedLine.unitPrice });
  };

  // 行の左の「−」で、その行をすぐ消す（選んでいる行なら選びも外す）。
  const removeLine = (key: string) =>
    onChange({
      ...work,
      lines: work.lines.filter((line) => line.key !== key),
      selected: work.selected === key ? null : work.selected,
      expr: work.selected === key ? '' : work.expr,
    });

  const showExpr = /[+\-*/]/.test(work.expr);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="品目"
        onClose={onClose}
        closeAtEnd
        right={
          <View style={styles.headerRight}>
            {onDelete && (
              <Pressable accessibilityRole="button" accessibilityLabel="このカテゴリの品目を消す" onPress={onDelete} hitSlop={8}>
                <Trash2 size={20} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
        }
      />
      <Pressable accessibilityRole="button" accessibilityLabel="カテゴリを変える" onPress={onChangeCategory} style={styles.category}>
        <CategoryIcon iconKey={iconKey} size={20} />
        <Text style={styles.categoryName} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.flex} />
        {subtitle !== '' && <Text style={styles.categorySub}>{subtitle}</Text>}
        <ChevronRight size={16} color={colors.textFaint} />
      </Pressable>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (!scrollToNew.current) return;
          scrollToNew.current = false;
          scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="この行を消す"
                onPress={() => removeLine(line.key)}
                hitSlop={8}
                style={styles.removeButton}
              >
                <Minus size={12} color={colors.primaryText} />
              </Pressable>
              <TextInput
                style={styles.lineName}
                value={line.name}
                onChangeText={(name) => updateLine(line.key, { name })}
                onFocus={() => (selected ? undefined : select(line))}
                placeholder="品名"
                placeholderTextColor={colors.textFaint}
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
              <Text style={styles.unit}>
                @{line.unitPrice < 0 ? '−' : ''}
                {Math.abs(line.unitPrice).toLocaleString('ja-JP')}
              </Text>
              <Text style={[styles.amount, line.unitPrice < 0 && styles.minus]}>
                {formatBalance(editorLineAmount(line))}
              </Text>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" accessibilityLabel="品目を追加する" onPress={addLine} style={styles.blank}>
          <View style={styles.addButton}>
            <Plus size={14} color={colors.primaryText} />
          </View>
        </Pressable>
        <View style={styles.subtotalRow}>
          {selectedLine !== null && (
            <>
              {/* 金額を入れてから切り替える（0円の行には出さない）。 */}
              {selectedLine.unitPrice !== 0 && (
                <Pressable accessibilityRole="button" onPress={toggleSign} hitSlop={6}>
                  <Text style={styles.signText}>{selectedLine.unitPrice < 0 ? 'プラスに戻す' : 'マイナスにする'}</Text>
                </Pressable>
              )}
            </>
          )}
          <View style={styles.flex} />
          {showExpr && <Text style={styles.expr}>{formatCalc(work.expr)} =</Text>}
          <Text style={styles.subtotalLabel}>小計</Text>
          <Text style={styles.subtotal}>{formatBalance(subtotal)}</Text>
        </View>
      </ScrollView>

      <Calculator onKey={pressKey} />
      <View style={styles.footer}>
        <PrimaryButton
          label={filled.length === 0 ? '金額を入れてください' : `このカテゴリを保存（${filled.length}行 ${formatBalance(subtotal)}）`}
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
  // カテゴリは1行で小さく（品目と金額が主）。
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  categoryName: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  categorySub: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  list: { paddingBottom: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // 行の左端の「−」（赤い丸）。押すとその行を消す。
  removeButton: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger },
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
  minus: { color: colors.danger },
  // 一覧のいちばん下の「＋」だけの行（文字は無し）。
  blank: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  addButton: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.money },
  subtotalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 16, paddingTop: 10 },
  signText: { fontSize: 12, fontWeight: '600', color: colors.money },
  expr: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  subtotalLabel: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  subtotal: { fontSize: 22, fontWeight: '700', color: colors.text },
  footer: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4 },
});
