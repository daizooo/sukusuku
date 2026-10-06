import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import type { StockItem, StockItemDraft } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import { getMyMembership } from '@/lib/api/me';
import { deleteStockItem, insertStockItem, loadStockItems, updateStockItem } from '@/lib/api/stockItems';
import {
  categoryOptions,
  countByLevel,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  sortStockItems,
  type ExpiryLevel,
} from '@/lib/stockUtils';
import StockItemSheet from '@/components/living/StockItemSheet';

/**
 * 暮らしタブ（docs/home.md）。いまは防災備蓄だけ（フェーズ1）。
 * Web版の `src/components/sukusuku/tabs/LivingTab.tsx` と同じ項目・並び・文言にしてある。
 *
 * 防災備蓄の困りごとは数を数えることではなく、期限切れに気づかないこと。
 * そこで**期限の近い順**に並べ、上に「期限切れ・3か月以内・1年以内」の件数を出す。
 * 1行＝品名×期限（ロット）。同じ品でも期限が違えば別の行になる。
 *
 * 見出し・要約・カテゴリの切り替えは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 */

/** 「すべて」を表すカテゴリの絞り込み。 */
const ALL = '';

const LEVEL_STYLE: Record<ExpiryLevel, { color: string; surface?: string }> = {
  expired: { color: colors.alertText, surface: colors.alertSurface },
  soon: { color: colors.alertText, surface: colors.alertSurface },
  year: { color: colors.temperatureText, surface: colors.temperatureSurface },
  ok: { color: colors.textMuted },
  none: { color: colors.textFaint },
};

/** 編集の対象。null は閉じている、'new' は追加。 */
type Editing = StockItem | 'new' | null;

export default function LivingScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState(ALL);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const loaded = await loadStockItems(supabase, membership.familyId);
        if (isMounted) setItems(loaded);
      } catch {
        // 圏外でも画面は出す。読めなかったぶんは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const today = toDateString(new Date());
  const categories = useMemo(() => categoryOptions(items), [items]);
  const counts = useMemo(() => countByLevel(items, today), [items, today]);
  const visibleItems = useMemo(
    () => sortStockItems(category === ALL ? items : items.filter((item) => item.category === category)),
    [items, category],
  );

  // 絞り込んでいたカテゴリが無くなったら「すべて」へ戻す。
  const activeCategory = category === ALL || categories.includes(category) ? category : ALL;

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  const save = async (draft: StockItemDraft) => {
    const target = editing;
    setEditing(null);
    if (!familyId || target === null) return;
    try {
      if (target === 'new') {
        const created = await insertStockItem(supabase, familyId, draft);
        setItems((prev) => [...prev, created]);
      } else {
        const updated = await updateStockItem(supabase, target.id, draft);
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
    } catch {
      failed('保存');
    }
  };

  const remove = async (id: string) => {
    setEditing(null);
    const previous = items;
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await deleteStockItem(supabase, id);
    } catch {
      setItems(previous);
      failed('削除');
    }
  };

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  const summary = [
    counts.expired > 0 && { level: 'expired' as const, text: `期限切れ ${counts.expired}件` },
    counts.soon > 0 && { level: 'soon' as const, text: `3か月以内 ${counts.soon}件` },
    counts.year > 0 && { level: 'year' as const, text: `1年以内 ${counts.year}件` },
  ].filter((entry) => entry !== false);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>防災備蓄</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditing('new')}
          style={styles.addButton}
          disabled={!familyId}
        >
          <Plus size={16} color={colors.primaryText} />
          <Text style={styles.addButtonText}>追加</Text>
        </Pressable>
      </View>

      {!isLoading && items.length > 0 && (
        <View style={styles.summary}>
          {summary.length === 0 ? (
            <Text style={styles.summaryCalm}>1年以内に期限が来るものはありません</Text>
          ) : (
            summary.map((entry) => (
              <View
                key={entry.level}
                style={[styles.summaryBadge, { backgroundColor: LEVEL_STYLE[entry.level].surface }]}
              >
                <Text style={[styles.summaryText, { color: LEVEL_STYLE[entry.level].color }]}>{entry.text}</Text>
              </View>
            ))
          )}
        </View>
      )}

      {categories.length > 1 && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {[ALL, ...categories].map((value) => {
              const selected = value === activeCategory;
              return (
                <Pressable
                  key={value || 'all'}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCategory(value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{value || 'すべて'}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
      ) : items.length === 0 ? (
        <View style={[styles.centered, styles.flex]}>
          <Text style={styles.message}>備蓄はまだありません</Text>
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
          <View style={styles.card}>
            {visibleItems.map((item, index) => {
              const level = expiryLevel(item.expiresOn, today);
              const tone = LEVEL_STYLE[level];
              const sub = [item.category, item.note].filter((text) => text !== '').join('・');
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => setEditing(item)}
                  style={[styles.row, index > 0 && styles.rowDivided]}
                >
                  <View style={styles.flex}>
                    <Text style={styles.name}>{item.name}</Text>
                    {sub !== '' && <Text style={styles.sub}>{sub}</Text>}
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={styles.quantity}>
                      {formatQuantity(item.quantity)}
                      {item.unit}
                    </Text>
                    {item.expiresOn ? (
                      <Text style={[styles.expiry, { color: tone.color }]}>
                        {level === 'expired' ? '切れ ' : ''}
                        {formatExpiry(item)}
                      </Text>
                    ) : (
                      <Text style={[styles.expiry, { color: tone.color }]}>期限なし</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}

      {editing !== null && (
        <StockItemSheet
          // 対象が変わるたびに作り直して、書きかけを持ち越さない。
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.navActive,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addButtonText: { fontSize: 13, fontWeight: '700', color: colors.primaryText },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  summaryBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  summaryText: { fontSize: 12, fontWeight: '700' },
  summaryCalm: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  chips: { gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.neutralSurface,
  },
  chipSelected: { backgroundColor: colors.navActive },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextSelected: { color: colors.primaryText },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  quantity: { fontSize: 13, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  expiry: { fontSize: 11, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
});
