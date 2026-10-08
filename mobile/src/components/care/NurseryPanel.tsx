import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, MapPin, Pencil, Phone, Plus } from 'lucide-react-native';
import type { Nursery, NurseryChecklist } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import {
  deleteNursery,
  insertNursery,
  listNurseries,
  seedDefaultNurseries,
  updateNursery,
} from '@/lib/api/nurseries';
import {
  checkGroupsFor,
  checkItemNumber,
  checkTotalFor,
  countChecked,
} from '@/lib/nurseryChecklist';
import { formatDateWithWeekday, parseDateString } from '@/lib/dateUtils';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
import CheckItemCard from '@/components/hokatsu/CheckItemCard';
import NurseryFormModal, { type NurseryDraft } from '@/components/hokatsu/NurseryFormModal';

// 育児タブの「保活」（docs/family-app.md §4.2）。もとは保活タブ。Web版は
// `src/components/sukusuku/tabs/HokatsuTab.tsx`。出す項目・並び・文言は同じにしてある。
//
// 園ごとに「基本情報」と「見学チェックリスト」を分けて表示する。
// 見学当日はチェックリストだけを見たいので、連絡先や見学日時と同じ画面に混ぜない。
type HokatsuView = 'basic' | 'checklist';

const toDraft = (nursery: Nursery): NurseryDraft => ({
  name: nursery.name,
  address: nursery.address,
  status: nursery.status,
  phone: nursery.phone,
  visitDate: nursery.visitDate,
  visitTime: nursery.visitTime,
  memo: nursery.memo,
  checklist: nursery.checklist,
});

const statusColors = (status: Nursery['status']) =>
  status === '見学済'
    ? { background: colors.doneSurface, text: colors.doneText }
    : status === '未見学'
      ? { background: colors.neutralSurface, text: colors.labelDefaultText }
      : { background: colors.labelDaizoSurface, text: colors.labelDaizoText };

/**
 * 中身の切り替えに使う下線タブ。園の切り替え(SegmentedTabs)と重ねても、
 * どちらが上位の切り替えなのかが見た目で分かるように、こちらは帯を持たせない。
 */
function UnderlineTabs({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { id: HokatsuView; label: string; badge?: string; badgeDone?: boolean }[];
  value: HokatsuView;
  onChange: (id: HokatsuView) => void;
  accessibilityLabel?: string;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={styles.underlineBar}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={styles.underlineTab}
          >
            <Text style={[styles.underlineLabel, selected && styles.underlineLabelOn]}>
              {option.label}
            </Text>
            {option.badge && (
              <View style={[styles.badge, option.badgeDone && styles.badgeDone]}>
                <Text style={[styles.badgeText, option.badgeDone && styles.badgeTextDone]}>
                  {option.badge}
                </Text>
              </View>
            )}
            {/* 下線は選んでいるタブの幅ぶんだけ引く。 */}
            <View style={[styles.underline, selected && styles.underlineOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** 基本情報の1行。値が空のときは「未登録」と分かるよう薄く出す。 */
function InfoRow({
  icon,
  label,
  children,
  divided,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  divided?: boolean;
}) {
  return (
    <View style={[styles.infoRow, divided && styles.infoRowDivided]}>
      <View style={styles.infoIcon}>{icon}</View>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

export default function NurseryPanel() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [nurseries, setNurseries] = useState<Nursery[]>([]);
  const [isLoadingNurseries, setIsLoadingNurseries] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<HokatsuView>('basic');
  const [nurseryModal, setNurseryModal] = useState<{
    mode: 'add' | 'edit';
    nursery: Nursery | null;
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const loaded = await listNurseries(supabase, membership.familyId);
        if (isMounted) setNurseries(loaded);
      } catch {
        // 圏外でも画面は出す。出せるところまで出して、残りは空のままにする。
      } finally {
        if (isMounted) setIsLoadingNurseries(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  // 選んでいた園が消えた場合や、まだ何も選んでいない場合は先頭の園を出す。
  const selected = nurseries.find((n) => n.id === selectedId) ?? nurseries[0] ?? null;

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  const saveNursery = async (nursery: Nursery, draft: NurseryDraft) => {
    const previous = nurseries;
    const updated = { ...nursery, ...draft };
    setNurseries((prev) => prev.map((n) => (n.id === nursery.id ? updated : n)));
    try {
      await updateNursery(supabase, updated);
    } catch {
      setNurseries(previous);
      failed('保存');
    }
  };

  const addNursery = async (draft: NurseryDraft) => {
    if (!familyId) return;
    try {
      const created = await insertNursery(supabase, familyId, draft);
      setNurseries((prev) => [...prev, created]);
      setSelectedId(created.id);
    } catch {
      failed('保育園の追加');
    }
  };

  const removeNursery = async (id: string) => {
    const previous = nurseries;
    setNurseries((prev) => prev.filter((n) => n.id !== id));
    try {
      await deleteNursery(supabase, id);
    } catch {
      setNurseries(previous);
      failed('削除');
    }
  };

  const addDefaultNurseries = async () => {
    if (!familyId) return;
    try {
      const created = await seedDefaultNurseries(supabase, familyId);
      setNurseries((prev) => [...prev, ...created]);
    } catch {
      failed('保育園の追加');
    }
  };

  const saveChecklist = (nursery: Nursery, checklist: NurseryChecklist) =>
    void saveNursery(nursery, { ...toDraft(nursery), checklist });

  const setCheck = (
    nursery: Nursery,
    itemId: string,
    patch: Partial<NurseryChecklist[string]>,
  ) => {
    const current = nursery.checklist[itemId] ?? { checked: false, memo: '' };
    saveChecklist(nursery, { ...nursery.checklist, [itemId]: { ...current, ...patch } });
  };

  const visitDate = selected ? parseDateString(selected.visitDate ?? '') : null;
  // チェックリストにはその園にだけ聞く項目（和光の宗教行事など）があるので、
  // 出す項目も分母も選んでいる園から決める。
  const checkGroups = selected ? checkGroupsFor(selected.name) : [];
  const checkedCount = selected ? countChecked(selected.checklist, selected.name) : 0;
  const checkTotal = selected ? checkTotalFor(selected.name) : 0;
  const status = selected ? statusColors(selected.status) : null;
  // 基本情報/見学チェックリストは、画面のどこでの左右スワイプでも切り替える（園の切り替えはタップだけ）。
  // 園の切り替えは横にスクロールする帯なので、その上のスワイプはスクロールに譲る（swipeBoundary）。
  const swipeHandlers = useSwipeTabs<HokatsuView>(
    ['basic', 'checklist'],
    view,
    setView,
    nurseries.length > 0,
  );

  return (
    // 育児タブの中身として出す（外枠・ログインの確認は app/(tabs)/care.tsx）。
    <View style={styles.screen}>
      <View style={styles.page} {...swipeHandlers}>
        {/* 上段は園の切り替え、下段は基本情報とチェックリストの切り替え。どちらも固定し、
            スクロールするのは中身だけにする。
            2つの切り替えは見た目を変える（上はピル、下は下線タブ）。同じ形の帯が2段並ぶと
            どちらが園でどちらが中身の切り替えなのか読み取れないため。 */}
        {nurseries.length > 0 && (
          <View style={styles.switchers}>
            <View style={styles.nurseryRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flex} {...swipeBoundary}>
                <SegmentedTabs
                  accessibilityLabel="保育園の切り替え"
                  value={selected?.id ?? ''}
                  onChange={setSelectedId}
                  fill={false}
                  options={nurseries.map((nursery) => ({ id: nursery.id, label: nursery.name }))}
                />
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="保育園を追加"
                onPress={() => setNurseryModal({ mode: 'add', nursery: null })}
                style={styles.addButton}
              >
                <Plus size={20} color={colors.navActive} />
              </Pressable>
            </View>
            <UnderlineTabs
              accessibilityLabel="保活の表示"
              value={view}
              onChange={setView}
              options={[
                { id: 'basic', label: '基本情報' },
                {
                  id: 'checklist',
                  label: '見学チェックリスト',
                  // 進み具合はラベルに続けず、小さなバッジに逃がす（狭い画面で文字が詰まらないように）。
                  badge: `${checkedCount}/${checkTotal}`,
                  badgeDone: checkedCount === checkTotal,
                },
              ]}
            />
          </View>
        )}

        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {isLoadingNurseries && <Text style={styles.message}>読み込み中...</Text>}

          {!isLoadingNurseries && nurseries.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.message}>保育園の記録はまだありません</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void addDefaultNurseries()}
                style={styles.seedButton}
              >
                <Text style={styles.seedTitle}>見学候補の3園を追加</Text>
                <Text style={styles.seedNote}>舞原保育園・くすのき保育園・和光こども園</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setNurseryModal({ mode: 'add', nursery: null })}
                style={styles.seedOwn}
              >
                <Text style={styles.seedOwnText}>自分で園を追加する</Text>
              </Pressable>
            </View>
          )}

          {selected && status && view === 'basic' && (
            <View style={styles.basic}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.status, { backgroundColor: status.background }]}>
                    <Text style={[styles.statusText, { color: status.text }]}>{selected.status}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setNurseryModal({ mode: 'edit', nursery: selected })}
                    style={styles.editButton}
                  >
                    <Pencil size={13} color={colors.navActiveText} />
                    <Text style={styles.editText}>編集</Text>
                  </Pressable>
                </View>
                <InfoRow icon={<MapPin size={14} color={colors.textFaint} />} label="住所">
                  <Text style={selected.address ? styles.infoValue : styles.infoEmpty}>
                    {selected.address || '未登録'}
                  </Text>
                </InfoRow>
                <InfoRow icon={<Phone size={14} color={colors.textFaint} />} label="電話" divided>
                  {selected.phone ? (
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(`tel:${selected.phone}`)}
                    >
                      <Text style={styles.phone}>{selected.phone}</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.infoEmpty}>未登録</Text>
                  )}
                </InfoRow>
                <InfoRow icon={<CalendarDays size={14} color={colors.textFaint} />} label="見学" divided>
                  {visitDate ? (
                    <Text style={styles.visit}>
                      {`${formatDateWithWeekday(visitDate)}${selected.visitTime ? ` ${selected.visitTime}〜` : ''}`}
                    </Text>
                  ) : (
                    <Text style={styles.infoEmpty}>日時は未定</Text>
                  )}
                </InfoRow>
              </View>
              {selected.memo !== '' && (
                <View style={[styles.card, styles.memoCard]}>
                  <Text style={styles.memoLabel}>メモ</Text>
                  <Text style={styles.memoText}>{selected.memo}</Text>
                </View>
              )}
            </View>
          )}

          {selected && view === 'checklist' && (
            <View style={styles.checklist}>
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  見学当日の流れ順に並べています。園によって確認する項目が変わります。チェックとメモはその場で保存されます。
                </Text>
              </View>
              {checkGroups.map((group) => (
                <View key={group.id} style={styles.group}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  {group.note && <Text style={styles.groupNote}>{group.note}</Text>}
                  {group.items.map((item) => {
                    const state = selected.checklist[item.id];
                    const checked = state?.checked ?? false;
                    return (
                      <CheckItemCard
                        key={`${selected.id}-${item.id}`}
                        number={checkItemNumber(item.id, selected.name)}
                        title={item.title}
                        point={item.point}
                        targetLabel={item.target?.label}
                        graded={item.graded}
                        grade={state?.grade}
                        checked={checked}
                        memo={state?.memo ?? ''}
                        onToggle={() => setCheck(selected, item.id, { checked: !checked })}
                        onSelectGrade={(grade) =>
                          setCheck(selected, item.id, { checked: grade !== undefined, grade })
                        }
                        onCommitMemo={(memo) => setCheck(selected, item.id, { memo })}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      <NurseryFormModal
        // 対象が変わるたびに作り直して、初期値を計算し直す。
        key={`nursery-${nurseryModal ? `${nurseryModal.mode}-${nurseryModal.nursery?.id ?? 'new'}` : 'none'}`}
        mode={nurseryModal?.mode ?? null}
        nursery={nurseryModal?.nursery ?? null}
        onClose={() => setNurseryModal(null)}
        onSubmit={(draft) => {
          if (nurseryModal?.mode === 'edit' && nurseryModal.nursery) {
            void saveNursery(nurseryModal.nursery, draft);
          } else {
            void addNursery(draft);
          }
          setNurseryModal(null);
        }}
        onDelete={(id) => {
          void removeNursery(id);
          if (selectedId === id) setSelectedId(null);
          setNurseryModal(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  page: { flex: 1, padding: 16 },
  content: { paddingBottom: 24 },
  message: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },

  switchers: { gap: 8, marginBottom: 12 },
  nurseryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addButton: { backgroundColor: colors.diaperSurface, borderRadius: 999, padding: 8 },

  underlineBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  underlineTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingBottom: 8,
    marginRight: 24,
  },
  underlineLabel: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  underlineLabelOn: { color: colors.navActiveText },
  underline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 2,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  underlineOn: { backgroundColor: colors.navActive },
  badge: {
    backgroundColor: colors.neutralSurface,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeDone: { backgroundColor: colors.doneSurface },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  badgeTextDone: { color: colors.doneText },

  emptyState: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  seedButton: {
    alignItems: 'center',
    backgroundColor: colors.diaperSurface,
    borderWidth: 1,
    borderColor: colors.diaperBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  seedTitle: { fontSize: 12, fontWeight: '700', color: colors.navActiveText },
  seedNote: { fontSize: 10, color: colors.navActive, marginTop: 4 },
  seedOwn: { paddingHorizontal: 16, paddingVertical: 8 },
  seedOwnText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },

  basic: { gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  status: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 10, fontWeight: '700' },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.diaperSurface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editText: { fontSize: 12, fontWeight: '700', color: colors.navActiveText },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12 },
  infoRowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  infoIcon: { width: 20, marginTop: 1 },
  infoLabel: { width: 60, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  infoValue: { fontSize: 14, color: colors.textSubtle, fontWeight: '500' },
  infoEmpty: { fontSize: 14, color: colors.textFaint },
  phone: { fontSize: 14, fontWeight: '500', color: colors.navActive },
  visit: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
  memoCard: { padding: 16 },
  memoLabel: { fontSize: 10, color: colors.textFaint, marginBottom: 6 },
  memoText: { fontSize: 14, color: colors.textSubtle, lineHeight: 21 },

  checklist: { gap: 16 },
  notice: {
    backgroundColor: colors.temperatureSurface,
    borderWidth: 1,
    borderColor: colors.temperatureBorder,
    borderRadius: 12,
    padding: 12,
  },
  noticeText: { fontSize: 12, color: colors.temperatureText, lineHeight: 18 },
  group: { gap: 8 },
  groupTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  groupNote: { fontSize: 10, color: colors.textFaint, marginTop: -4 },
});
