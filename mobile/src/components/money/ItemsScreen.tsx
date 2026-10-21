import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View, type GestureResponderEvent } from 'react-native';
import { ChevronRight, GripVertical, Minus, Plus } from 'lucide-react-native';
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
// 行の左端の持ち手をつかんで別のまとまりへ落とすと、その行をそのカテゴリへ移す（2026-10-21。自動で取り込んだ記録の品目を
// 打ち直さずに分けられるように）。「＋ カテゴリを追加」へ落とすとカテゴリの選択へ行き、選んだカテゴリへ移す。

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

/** 一覧の中の縦の位置と高さ。 */
type Span = { y: number; height: number };
/** 行のドラッグ。over は落とし先（まとまりの key か ADD_CATEGORY。つかんだまとまりの上なら null）。 */
type Drag = { groupKey: string; lineKey: string; dy: number; over: string | null };
const ADD_CATEGORY = 'add-category';

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

/** 行を別のまとまりへ移す（左の持ち手でドラッグして落としたとき。2026-10-21）。移した先のいちばん下に足し、行の無くなったまとまりは消す。 */
export function moveWorkLine(work: ItemsWork, lineKey: string, toGroupKey: string): ItemsWork {
  const line = work.groups.flatMap((group) => group.lines).find((entry) => entry.key === lineKey);
  if (!line || !work.groups.some((group) => group.key === toGroupKey)) return work;
  const groups = work.groups
    .map((group) => {
      const lines = group.lines.filter((entry) => entry.key !== lineKey);
      return { ...group, lines: group.key === toGroupKey ? [...lines, line] : lines };
    })
    .filter((group) => group.lines.length > 0);
  return { ...work, groups };
}

/** 行を選んだカテゴリへ移す（「＋ カテゴリを追加」へ落としたとき）。同じカテゴリのまとまりがあればそこへ、無ければ新しいまとまりを足す。 */
export function moveWorkLineToCategory(work: ItemsWork, lineKey: string, target: GroupTarget, groupKey: string): ItemsWork {
  const existing = work.groups.find((group) => sameGroupTarget(group, target));
  if (existing) return moveWorkLine(work, lineKey, existing.key);
  return { ...moveWorkLine({ ...work, groups: [...work.groups, { key: groupKey, ...target, lines: [] }] }, lineKey, groupKey), focus: groupKey };
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
  /** 「＋ カテゴリを追加」。行を落としたときはその行の key を渡す（選んだカテゴリへ移す）。 */
  onAddCategory: (moveLineKey?: string) => void;
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
  // 電卓を出すときはキーボードを閉じる（品名を入れた直後に金額を押すと、両方が重なって画面が見えなくなるため。2026-10-21）。
  const select = (line: EditorLine, calc: boolean) => {
    if (calc) Keyboard.dismiss();
    onChange({ ...work, selected: line.key, expr: line.unitPrice !== 0 ? String(Math.abs(line.unitPrice)) : '', calc });
  };

  // 開いたまとまり・足したまとまりが見える所まで一覧を送る。行を足したときは、いちばん下のまとまりなら下まで送る。
  const scrollRef = useRef<ScrollView>(null);
  const scrollToNew = useRef(false);
  const groupY = useRef(new Map<string, Span>());
  const focused = useRef<string | null>(null);
  const scrollToFocus = () => {
    if (work.focus === null || work.focus === focused.current) return;
    const span = groupY.current.get(work.focus);
    if (span === undefined) return;
    focused.current = work.focus;
    scrollRef.current?.scrollTo({ y: span.y, animated: true });
  };

  // 行のドラッグ（左端の持ち手に触れると持ち上がり、指に付いて上下に動く。落とした先のまとまりへ移す）。
  // 指の居場所は「つかんだ行の真ん中 + 動かした量」（一覧の中の座標。持っているあいだはスクロールを止める）。
  const lineY = useRef(new Map<string, Span>());
  const addCategoryY = useRef<Span | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const dragOrigin = useRef(0);
  const dropTarget = (current: Drag, dy: number): string | null => {
    const from = groupY.current.get(current.groupKey);
    const line = lineY.current.get(current.lineKey);
    if (!from || !line) return null;
    const y = from.y + line.y + line.height / 2 + dy;
    const inside = (span: Span | null | undefined) => span != null && y >= span.y && y <= span.y + span.height;
    if (inside(addCategoryY.current)) return ADD_CATEGORY;
    const over = work.groups.find((group) => inside(groupY.current.get(group.key)));
    return over && over.key !== current.groupKey ? over.key : null;
  };
  const gripProps = (groupKey: string, lineKey: string) => ({
    onStartShouldSetResponder: () => dragRef.current === null,
    onResponderGrant: (event: GestureResponderEvent) => {
      Keyboard.dismiss();
      dragOrigin.current = event.nativeEvent.pageY;
      Vibration.vibrate(10);
      setDrag({ groupKey, lineKey, dy: 0, over: null });
      return true;
    },
    onResponderMove: (event: GestureResponderEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const dy = event.nativeEvent.pageY - dragOrigin.current;
      setDrag({ ...current, dy, over: dropTarget(current, dy) });
    },
    onResponderRelease: () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current || current.over === null) return;
      if (current.over === ADD_CATEGORY) onAddCategory(current.lineKey);
      else onChange(moveWorkLine(work, current.lineKey, current.over));
    },
    onResponderTerminate: () => setDrag(null),
    // 持ち上げたあとは、一覧のスクロールなどに持ち主を渡さない。
    onResponderTerminationRequest: () => false,
  });
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
        scrollEnabled={drag === null}
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
                groupY.current.set(group.key, event.nativeEvent.layout);
                scrollToFocus();
              }}
              style={drag?.groupKey === group.key && styles.dragGroup}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="カテゴリを変える"
                onPress={() => onChangeCategory(group.key)}
                style={[styles.category, drag?.over === group.key && styles.dropTarget]}
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
                const dragging = drag?.lineKey === line.key;
                return (
                  <Pressable
                    key={line.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => select(line, false)}
                    onLayout={(event) => lineY.current.set(line.key, event.nativeEvent.layout)}
                    style={[
                      styles.line,
                      selected && work.calc && styles.lineSelected,
                      dragging && [styles.lineDragging, { transform: [{ translateY: drag?.dy ?? 0 }] }],
                    ]}
                  >
                    <View accessibilityLabel="ドラッグして別のカテゴリへ移す" hitSlop={8} style={styles.grip} {...gripProps(group.key, line.key)}>
                      <GripVertical size={14} color={colors.textFaint} />
                    </View>
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
        <Pressable
          accessibilityRole="button"
          onPress={() => onAddCategory()}
          onLayout={(event) => {
            addCategoryY.current = event.nativeEvent.layout;
          }}
          style={[styles.addCategory, drag?.over === ADD_CATEGORY && styles.dropTarget]}
        >
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
    paddingLeft: 4,
    paddingRight: 16,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  // 行の左端の「−」（灰色）。押すとその行を消す。
  removeButton: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutralSurface },
  lineSelected: { backgroundColor: colors.moneySurface },
  // 行の左端の持ち手（つかんで別のまとまりへ移す）。
  grip: { width: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  // つかんでいる行は浮かせて、ほかのまとまりより手前に描く。
  dragGroup: { zIndex: 20, elevation: 8 },
  lineDragging: { zIndex: 20, elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  // 指の下にある落とし先。
  dropTarget: { backgroundColor: colors.moneySurface },
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
