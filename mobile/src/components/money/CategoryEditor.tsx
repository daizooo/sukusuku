import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, ChevronUp, GripVertical, Palette } from 'lucide-react-native';
import type { MoneyCategory, MoneyCategoryKind } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  CATEGORY_ICON_COLORS,
  childCategories,
  guessIconKey,
  iconKeyOf,
  MONEY_ICONS,
  topCategories,
} from '@/lib/moneyUtils';
import { insertDefaultMoneyCategories, updateMoneyCategory } from '@/lib/api/money';
import { useDragReorder } from '@/components/list/useDragReorder';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// カテゴリ（docs/kakei.md §3.1）。PWA版の `src/components/sukusuku/money/CategoryEditor.tsx` と同じ並び・文言。
//
// ここでできるのは、大分類のアイコン（絵と色）と並べ替えだけ（2026-10-24）。名前の変更・追加・削除は、予算が本体なので年間予算（BudgetEditor）で行い、
// カテゴリはそれを表示するだけ（固定費・予備費の小分類は、予算から決まる）。並べ替えは一覧のまま指で動かす
// （大分類は左の持ち手をつかむ、小分類は長押し。リストと同じ操作。components/list/useDragReorder.ts）。
// 大分類を1行ずつ並べ、押した1つだけ開いて小分類を出す（アコーディオン。2026-10-24。カテゴリの選択と同じ見せ方。docs/kakei.md §3.2）。
// 小分類が多い大分類（固定費（確定）23件など）で、全部並べると見にくかった。大分類の行を押すのは開閉で、アイコンは開いた中の「アイコンを変える」から。
// 大分類のアイコンは、大分類をタップして絵と色を選ぶ（アイコンをタップすると色を選べる。出金元のアイコンの色と同じ候補）。
// カテゴリがまだ無い家族には「標準のカテゴリで始める」（Zaim のカテゴリをもとにした並び）。

interface CategoryEditorProps {
  familyId: string;
  categories: MoneyCategory[];
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onClose: () => void;
}

type Editing = { category: MoneyCategory } | null;

/** 大分類のカードの中の間隔（styles.card の gap）。開いた行を上に寄せる計算に使う。 */
const CARD_GAP = 10;

const KIND_OPTIONS: { id: MoneyCategoryKind; label: string }[] = [
  { id: 'living', label: '支出' },
  { id: 'income', label: '収入' },
];

export default function CategoryEditor({
  familyId,
  categories,
  onCategories,
  onClose,
}: CategoryEditorProps) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<MoneyCategoryKind>('living');
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  // 開いている大分類（1つだけ）。開いた行は画面の上に寄せる。
  const [openId, setOpenId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const rowY = useRef<Record<string, number>>({});
  const panelHeight = useRef(0);

  const tops = useMemo(() => topCategories(categories, kind, true), [categories, kind]);
  const ordered = [...tops.filter((top) => !top.archived), ...tops.filter((top) => top.archived)];

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');
  const replace = (updated: MoneyCategory) =>
    onCategories((prev) => prev.map((category) => (category.id === updated.id ? updated : category)));

  const seed = async () => {
    setBusy(true);
    try {
      const created = await insertDefaultMoneyCategories(supabase, familyId);
      onCategories((prev) => [...prev, ...created]);
    } catch {
      failed('作成');
    } finally {
      setBusy(false);
    }
  };

  /** 指で動かしたあとの並び。きょうだいの並びを数え直し、変わったものだけ保存する。 */
  const reorder = (_sectionKey: string, orderedIds: string[]) => {
    const changed = orderedIds
      .map((id, position) => ({ entry: categories.find((category) => category.id === id), position }))
      .filter(
        (change): change is { entry: MoneyCategory; position: number } =>
          change.entry !== undefined && change.entry.position !== change.position,
      );
    if (changed.length === 0) return;
    onCategories((prev) =>
      prev.map((entry) => {
        const hit = changed.find((change) => change.entry.id === entry.id);
        return hit ? { ...entry, position: hit.position } : entry;
      }),
    );
    void Promise.all(changed.map(({ entry, position }) => updateMoneyCategory(supabase, entry.id, { position }))).catch(() =>
      failed('並べ替え'),
    );
  };
  const drag = useDragReorder(reorder);

  const toggle = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    // 開いていた行が上にあれば、閉じたぶん（面の高さ＋カード内の間隔）だけ新しい行の位置は上がる。
    const openIndex = ordered.findIndex((entry) => entry.id === openId);
    const index = ordered.findIndex((entry) => entry.id === id);
    const closing = openIndex >= 0 && openIndex < index ? panelHeight.current + CARD_GAP : 0;
    setOpenId(id);
    scrollRef.current?.scrollTo({ y: Math.max(0, (rowY.current[id] ?? 0) - closing), animated: true });
  };

  const save = async (result: SheetResult) => {
    const target = editing;
    setEditing(null);
    if (target === null) return;
    const category = target.category;
    if (result.icon === category.icon && result.iconColor === category.iconColor) return;
    try {
      replace(await updateMoneyCategory(supabase, category.id, { icon: result.icon, iconColor: result.iconColor }));
    } catch {
      failed('保存');
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title="カテゴリ" onClose={onClose} />
        <View style={styles.bar}>
          <View style={styles.flex} />
          {KIND_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === option.id }}
              onPress={() => setKind(option.id)}
              style={[styles.kind, kind === option.id && styles.kindSelected]}
            >
              <Text style={[styles.kindText, kind === option.id && styles.kindTextSelected]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.content} scrollEnabled={!drag.isActive}>
          {categories.length === 0 && (
            <View style={styles.seed}>
              <Text style={styles.seedText}>
                カテゴリがまだありません。Zaim のカテゴリをもとにした標準のカテゴリで始めて、アイコンや並びをあとで直せます（名前は年間予算で直します）。
              </Text>
              <PrimaryButton label="標準のカテゴリで始める" onPress={() => void seed()} disabled={busy} />
            </View>
          )}
          <View {...drag.panHandlers} style={styles.list}>
          {ordered.map((top) => {
            const children = childCategories(categories, top.id, true);
            const topSection = `tops-${kind}`;
            const open = openId === top.id;
            const measure = drag.measureProps(top.id);
            return (
              <View
                key={top.id}
                onLayout={(e) => {
                  measure.onLayout(e);
                  rowY.current[top.id] = e.nativeEvent.layout.y;
                }}
                style={[styles.card, top.archived && styles.archived, drag.styleFor(top.id), drag.isDragging(top.id) && styles.lifted]}
              >
                <View style={styles.topLine}>
                  <View accessibilityLabel={`${top.name}を並べ替え`} {...drag.gripProps(topSection, ordered, top.id)} style={styles.grip}>
                    <GripVertical size={18} color={colors.borderStrong} />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={top.name}
                    accessibilityState={{ expanded: open }}
                    onPress={() => toggle(top.id)}
                    style={[styles.topRow, styles.flex]}
                  >
                    <CategoryIcon iconKey={iconKeyOf(top)} size={30} />
                    <Text style={[styles.topName, styles.flex]} numberOfLines={1}>
                      {top.name}
                    </Text>
                    {top.archived && <Text style={styles.archivedLabel}>使わない</Text>}
                    <Text style={styles.count}>{children.length}件</Text>
                    {open ? <ChevronUp size={18} color={colors.textFaint} /> : <ChevronDown size={18} color={colors.textFaint} />}
                  </Pressable>
                </View>
                {open && (
                  <View style={styles.panel} onLayout={(e) => { panelHeight.current = e.nativeEvent.layout.height; }}>
                    <View style={styles.chips}>
                      {children.map((child) => (
                        <Pressable
                          key={child.id}
                          {...drag.holdProps(`children-${top.id}`, children, child.id)}
                          {...drag.measureProps(child.id)}
                          style={[
                            styles.chip,
                            child.archived && styles.archived,
                            drag.styleFor(child.id),
                            drag.isDragging(child.id) && styles.lifted,
                          ]}
                        >
                          <Text style={styles.chipText}>{child.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${top.name}のアイコンを変える`}
                      onPress={() => setEditing({ category: top })}
                      style={styles.editTop}
                    >
                      <Palette size={14} color={colors.money} />
                      <Text style={styles.editTopText}>アイコンを変える</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
          </View>
        </ScrollView>

        {editing !== null && (
          <CategorySheet
            key={editing.category.id}
            category={editing.category}
            onClose={() => setEditing(null)}
            onSubmit={(result) => void save(result)}
          />
        )}
      </View>
    </Modal>
  );
}

interface SheetResult {
  /** アイコン。 */
  icon: string | null;
  /** アイコンの色。null は標準（アイコンごとの色）。 */
  iconColor: string | null;
}

/** 大分類のアイコン（絵と色）を選ぶ。名前は年間予算で直す。 */
function CategorySheet({
  category,
  onClose,
  onSubmit,
}: {
  category: MoneyCategory;
  onClose: () => void;
  onSubmit: (result: SheetResult) => void;
}) {
  // 自動は無し。決めていないカテゴリは、今の名前から近いものを選んだ状態で始める。
  const [icon, setIcon] = useState<string>(category.icon ?? guessIconKey(category.name));
  const [iconColor, setIconColor] = useState<string | null>(category.iconColor ?? null);
  const [pickingColor, setPickingColor] = useState(false);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell title={category.name} onClose={onClose} footer={<PrimaryButton label="保存する" onPress={() => onSubmit({ icon, iconColor })} />}>
        <Text style={styles.hint}>名前の変更・追加は、年間予算で行います。</Text>
        <View style={styles.field}>
          <Text style={styles.label}>アイコン</Text>
          {/* アイコンをタップすると色を選べる（出金元のアイコンの色と同じ候補）。 */}
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
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  kind: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.neutralSurface },
  kindSelected: { backgroundColor: colors.moneySoft },
  kindText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  kindTextSelected: { color: colors.moneyText, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  seed: { gap: 12, paddingVertical: 16 },
  seedText: { fontSize: 14, fontWeight: '500', color: colors.textMuted, lineHeight: 21 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    gap: CARD_GAP,
  },
  archived: { opacity: 0.5 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topName: { fontSize: 15, fontWeight: '700', color: colors.text },
  archivedLabel: { fontSize: 11, fontWeight: '600', color: colors.textFaint },
  count: { fontSize: 12, fontWeight: '500', color: colors.textFaint },
  panel: { gap: 10 },
  editTop: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  editTopText: { fontSize: 13, fontWeight: '600', color: colors.money },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.neutralSurface,
  },
  chipText: { fontSize: 13, fontWeight: '500', color: colors.textSubtle },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  hint: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
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
  list: { gap: 10 },
  topLine: { flexDirection: 'row', alignItems: 'center' },
  grip: { width: 28, alignSelf: 'stretch', marginLeft: -8, marginVertical: -4, alignItems: 'center', justifyContent: 'center' },
  lifted: { opacity: 0.9, elevation: 8 },
});
