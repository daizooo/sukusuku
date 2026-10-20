import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronRight, Minus, Plus } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  editorGroupTotal,
  editorLineAmount,
  evaluateCalc,
  formatBalance,
  formatCalc,
  isBlankLine,
  pressCalcKey,
  sameGroupTarget,
  type EditorGroup,
  type EditorLine,
} from '@/lib/moneyUtils';
import Calculator from '@/components/money/Calculator';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 品目の画面（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/ItemsScreen.tsx` と同じ並び・文言。
//
// 記録の品目を、カテゴリごとのまとまりに分けて1つの画面でまとめて入れる（2026-10-20。カテゴリが分かれても、
// 保存して記録の編集に戻り、また追加して…と行き来しなくて済むように）。行＝品名・個数（−＋）・単価・金額。
// 見出しの下の中央に、全部の品目の合計を大きく出す（カテゴリごとの小計は出さない。2026-10-20）。
// まとまりの頭はカテゴリの見出し（太字。予算の残りは出さない。押すとカテゴリを変える）。まとまりの間は灰色の帯で区切り、品目は字下げして控えめに。
// 色は少なく（「−」「＋」は灰色・文字だけ。2026-10-20）。
// まとまりのいちばん下の「＋ 品目を追加」で新しい行を足し（品名の欄は開かない。キーボードが立ち上がらないように。2026-10-15）、
// 行の左の「−」でその行を消す（まとまりの最後の行を消すと、まとまりごと消える）。一覧のいちばん下の「＋ カテゴリを追加」で別のカテゴリのまとまりを足す。
// 電卓は行の金額を押したときだけ、画面の下に別枠で出す（暗い部分を押す・OK・戻る操作で閉じる。Zaim と同じ。2026-10-20）。
// 枠の上にその行の金額（式を打っているときは式も）、下に「マイナスにする」と OK。
// 値引き・割引・返金は「マイナスにする」で、選んだ行の金額をマイナスにする（docs/kakei.md §10.5）。

/** 品目の画面で書きかけのもの（記録の入力が持ち、ほかの画面へ行って戻っても消えない）。 */
export interface ItemsWork {
  /** 記録の品目のまとまり全部（保存すると記録の入力のまとまりと入れ替える）。 */
  groups: EditorGroup[];
  selected: string | null;
  /** 選んだ行の電卓の式。 */
  expr: string;
  /** 開いたときに見せるまとまり（一覧をそこまで送る）。 */
  focus: string | null;
  /** 電卓を出しているか（行の金額を押したときだけ）。 */
  calc: boolean;
}

type GroupTarget = Pick<EditorGroup, 'categoryId' | 'categoryName'>;

let lineSeq = 0;
export const newLineKey = () => `line-${(lineSeq += 1)}`;

export const blankLine = (): EditorLine => ({
  key: newLineKey(),
  name: '',
  quantity: 1,
  unitPrice: 0,
  memo: '',
});

/** カテゴリのまとまりを足す（同じカテゴリがあれば、そこに空の行を足す）。足した行を選ぶ。 */
export function addWorkGroup(work: ItemsWork, target: GroupTarget, groupKey: string): ItemsWork {
  const line = blankLine();
  const existing = work.groups.find((group) => sameGroupTarget(group, target));
  const groups = existing
    ? work.groups.map((group) =>
        group.key === existing.key ? { ...group, lines: [...group.lines.filter((entry) => !isBlankLine(entry)), line] } : group,
      )
    : [...work.groups, { key: groupKey, ...target, lines: [line] }];
  return { ...work, groups, selected: line.key, expr: '', focus: existing?.key ?? groupKey, calc: false };
}

/** まとまりのカテゴリを変える（変えた先と同じカテゴリのまとまりがあれば、そこへ行をまとめる）。 */
export function changeWorkGroup(work: ItemsWork, groupKey: string, target: GroupTarget): ItemsWork {
  const moving = work.groups.find((group) => group.key === groupKey);
  if (!moving) return work;
  const same = work.groups.find((group) => group.key !== groupKey && sameGroupTarget(group, target));
  const groups = same
    ? work.groups
        .filter((group) => group.key !== groupKey)
        .map((group) => (group.key === same.key ? { ...group, lines: [...group.lines, ...moving.lines] } : group))
    : work.groups.map((group) => (group.key === groupKey ? { ...group, ...target } : group));
  return { ...work, groups };
}

/** 保存する形にする（空の行と、行の無いまとまりは残さない）。 */
export const groupsFromWork = (work: ItemsWork): EditorGroup[] =>
  work.groups
    .map((group) => ({ ...group, lines: group.lines.filter((line) => !isBlankLine(line)) }))
    .filter((group) => group.lines.length > 0);

interface ItemsScreenProps {
  work: ItemsWork;
  onChange: (work: ItemsWork) => void;
  /** まとまりの見出し（「食費 › 食料品」）とアイコン。 */
  title: (group: EditorGroup) => string;
  iconKey: (group: EditorGroup) => string;
  onChangeCategory: (groupKey: string) => void;
  onAddCategory: () => void;
  onSave: () => void;
  onClose: () => void;
}

export default function ItemsScreen({
  work,
  onChange,
  title,
  iconKey,
  onChangeCategory,
  onAddCategory,
  onSave,
  onClose,
}: ItemsScreenProps) {
  const allLines = work.groups.flatMap((group) => group.lines);
  const filled = allLines.filter((line) => !isBlankLine(line));
  const total = work.groups.reduce((sum, group) => sum + editorGroupTotal(group), 0);

  const mapLines = (fn: (lines: EditorLine[], group: EditorGroup) => EditorLine[]) =>
    work.groups.map((group) => ({ ...group, lines: fn(group.lines, group) }));

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    onChange({ ...work, groups: mapLines((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line))) });

  // 行を選ぶ。金額を押したときだけ電卓を出す（品名・行のほかの所なら閉じる）。
  const select = (line: EditorLine, calc: boolean) =>
    onChange({ ...work, selected: line.key, expr: line.unitPrice !== 0 ? String(Math.abs(line.unitPrice)) : '', calc });

  // 開いたまとまり・足したまとまりが見える所まで一覧を送る。行を足したときは、いちばん下のまとまりなら下まで送る。
  const scrollRef = useRef<ScrollView>(null);
  const scrollToNew = useRef(false);
  const groupY = useRef(new Map<string, number>());
  const focused = useRef<string | null>(null);
  const scrollToFocus = () => {
    if (work.focus === null || work.focus === focused.current) return;
    const y = groupY.current.get(work.focus);
    if (y === undefined) return;
    focused.current = work.focus;
    scrollRef.current?.scrollTo({ y, animated: true });
  };
  useEffect(scrollToFocus);

  const addLine = (groupKey: string) => {
    // 書きかけの空の行は残さない（空の行は保存もしない）。
    // 品名の欄は開かない（キーボードが立ち上がって電卓と一覧が隠れるため。品名は欄を押して入れる）。
    const line = blankLine();
    scrollToNew.current = work.groups[work.groups.length - 1]?.key === groupKey;
    onChange({
      ...work,
      groups: mapLines((lines, group) =>
        group.key === groupKey ? [...lines.filter((entry) => !isBlankLine(entry)), line] : lines.filter((entry) => !isBlankLine(entry)),
      ),
      selected: line.key,
      expr: '',
      calc: false,
    });
  };

  // 電卓は行を選んでいるときだけ出す。
  const pressKey = (key: string) => {
    if (work.selected === null) return;
    const expr = pressCalcKey(work.expr, key);
    const value = evaluateCalc(expr) ?? 0;
    onChange({
      ...work,
      expr,
      // 電卓は金額の大きさだけを扱い、マイナスの行はマイナスのまま。
      groups: mapLines((lines) =>
        lines.map((line) => (line.key === work.selected ? { ...line, unitPrice: line.unitPrice < 0 ? -value : value } : line)),
      ),
    });
  };

  const selectedLine = allLines.find((line) => line.key === work.selected) ?? null;

  const toggleSign = () => {
    if (!selectedLine) return;
    updateLine(selectedLine.key, { unitPrice: -selectedLine.unitPrice });
  };

  // 行の左の「−」で、その行をすぐ消す（選んでいる行なら選びも外す）。行の無くなったまとまりは消す。
  const removeLine = (key: string) =>
    onChange({
      ...work,
      groups: mapLines((lines) => lines.filter((line) => line.key !== key)).filter((group) => group.lines.length > 0),
      selected: work.selected === key ? null : work.selected,
      expr: work.selected === key ? '' : work.expr,
    });

  const showExpr = /[+\-*/]/.test(work.expr);
  const closeCalc = () => onChange({ ...work, calc: false });

  return (
    <View style={styles.screen}>
      <ScreenHeader title="品目" onClose={onClose} closeAtEnd />
      <View style={styles.totalBox}>
        <Text style={styles.total}>{formatBalance(total)}</Text>
      </View>

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
        {work.groups.map((group) => {
          return (
            <View
              key={group.key}
              onLayout={(event) => {
                groupY.current.set(group.key, event.nativeEvent.layout.y);
                scrollToFocus();
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="カテゴリを変える"
                onPress={() => onChangeCategory(group.key)}
                style={styles.category}
              >
                <CategoryIcon iconKey={iconKey(group)} size={24} />
                <View style={styles.categoryText}>
                  <Text style={styles.categoryName} numberOfLines={1}>
                    {title(group)}
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.textFaint} />
              </Pressable>
              {group.lines.map((line) => {
                const selected = line.key === work.selected;
                return (
                  <Pressable
                    key={line.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => select(line, false)}
                    style={[styles.line, selected && work.calc && styles.lineSelected]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="この行を消す"
                      onPress={() => removeLine(line.key)}
                      hitSlop={8}
                      style={styles.removeButton}
                    >
                      <Minus size={12} color={colors.textMuted} />
                    </Pressable>
                    <TextInput
                      style={styles.lineName}
                      value={line.name}
                      onChangeText={(name) => updateLine(line.key, { name })}
                      onFocus={() => (selected && !work.calc ? undefined : select(line, false))}
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
                    {/* 入力した単価を主役に（太く大きく。選んでいる行は下線＝いま入力している数字）。
                        個数 × 単価 ＝ 金額は小さく添える（金額が目立って、入れた数字と食い違って見えないように）。 */}
                    <Pressable accessibilityRole="button" accessibilityLabel="金額を入れる" onPress={() => select(line, true)} hitSlop={6} style={styles.price}>
                      <Text style={[styles.unit, selected && work.calc && styles.unitSelected, line.unitPrice < 0 && styles.minus]}>
                        {formatBalance(line.unitPrice)}
                      </Text>
                      {line.quantity > 1 && (
                        <Text style={[styles.amount, line.unitPrice < 0 && styles.minus]}>
                          × {line.quantity} ＝ {formatBalance(editorLineAmount(line))}
                        </Text>
                      )}
                    </Pressable>
                  </Pressable>
                );
              })}
              <Pressable accessibilityRole="button" onPress={() => addLine(group.key)} style={styles.addLine}>
                <Plus size={14} color={colors.textMuted} />
                <Text style={styles.addLineText}>品目を追加</Text>
              </Pressable>
            </View>
          );
        })}
        <Pressable accessibilityRole="button" onPress={onAddCategory} style={styles.addCategory}>
          <Plus size={16} color={colors.money} />
          <Text style={styles.addCategoryText}>カテゴリを追加</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="保存" disabled={filled.length === 0} onPress={onSave} />
      </View>

      {work.calc && selectedLine !== null && (
        <View style={StyleSheet.absoluteFill}>
          <Pressable accessibilityRole="button" accessibilityLabel="電卓を閉じる" onPress={closeCalc} style={styles.backdrop} />
          <View style={styles.calcSheet} {...swipeBoundary}>
            <View style={styles.calcHead}>
              <View style={styles.currency}>
                <Text style={styles.yen}>¥</Text>
                <Text style={styles.jpy}>JPY</Text>
              </View>
              <View style={styles.calcValueBox}>
                {showExpr && <Text style={styles.expr}>{formatCalc(work.expr)} =</Text>}
                <Text style={[styles.calcValue, selectedLine.unitPrice < 0 && styles.minus]} numberOfLines={1}>
                  {(selectedLine.unitPrice < 0 ? '−' : '') + Math.abs(selectedLine.unitPrice).toLocaleString('ja-JP')}
                </Text>
              </View>
            </View>
            <Calculator onKey={pressKey} />
            <View style={styles.calcFooter}>
              {/* 金額を入れてから切り替える（0円の行には出さない）。 */}
              <View style={styles.signBox}>
                {selectedLine.unitPrice !== 0 && (
                  <Pressable accessibilityRole="button" onPress={toggleSign} hitSlop={6}>
                    <Text style={styles.signText}>{selectedLine.unitPrice < 0 ? 'プラスに戻す' : 'マイナスにする'}</Text>
                  </Pressable>
                )}
              </View>
              <Pressable accessibilityRole="button" onPress={closeCalc} style={styles.okButton}>
                <Text style={styles.okText}>OK</Text>
              </Pressable>
              <View style={styles.signBox} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  // カテゴリはまとまりの見出し（太字・右に小計）。まとまりの間は灰色の帯（上の余白）で区切る。
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryText: { flex: 1, gap: 1 },
  categoryName: { fontSize: 15, fontWeight: '700', color: colors.text },
  // 見出しの下の中央の合計。
  totalBox: { alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  total: { fontSize: 28, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  list: { paddingBottom: 8, backgroundColor: colors.background },
  // 品目は字下げして、カテゴリの見出しより控えめに。
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 24,
    paddingRight: 16,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  // 行の左端の「−」（灰色）。押すとその行を消す。
  removeButton: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutralSurface },
  lineSelected: { backgroundColor: colors.moneySurface },
  lineName: { flex: 1, paddingVertical: 6, fontSize: 14, fontWeight: '500', color: colors.textSubtle },
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
  price: { minWidth: 92, alignItems: 'flex-end', gap: 1 },
  unit: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], borderBottomWidth: 2, borderBottomColor: 'transparent' },
  unitSelected: { borderBottomColor: colors.money },
  amount: { fontSize: 11, fontWeight: '600', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  minus: { color: colors.danger },
  // まとまりのいちばん下の「＋ 品目を追加」（灰色の文字だけ）。
  addLine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 26, paddingVertical: 10, backgroundColor: colors.surface },
  addLineText: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  // 一覧のいちばん下の「＋ カテゴリを追加」。
  addCategory: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface },
  addCategoryText: { fontSize: 14, fontWeight: '600', color: colors.money },
  footer: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 },
  // 電卓の別枠（画面の下。上は暗くして、押すと閉じる）。
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  calcSheet: { backgroundColor: colors.surface, paddingBottom: 16 },
  calcHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  currency: { alignItems: 'center' },
  yen: { fontSize: 22, fontWeight: '800', color: colors.text },
  jpy: { fontSize: 11, fontWeight: '700', color: colors.text },
  calcValueBox: { flex: 1, alignItems: 'flex-end' },
  calcValue: { fontSize: 36, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  expr: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  calcFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 4 },
  signBox: { width: 96, alignItems: 'center' },
  signText: { fontSize: 12, fontWeight: '600', color: colors.money },
  okButton: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.money },
  okText: { fontSize: 18, fontWeight: '800', color: colors.primaryText },
});
