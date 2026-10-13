import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, FileText, Plus } from 'lucide-react-native';
import type { Contract, ContractDraft, ContractKind, Member } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import { getMyMembership } from '@/lib/api/me';
import { useFamilyRefresh } from '@/lib/familySync';
import { listMembers } from '@/lib/api/members';
import {
  deleteContract,
  insertContract,
  loadContracts,
  setContractRenewal,
  updateContract,
} from '@/lib/api/contracts';
import {
  CONTRACT_KINDS,
  KIND_LABEL,
  annualTotal,
  formatYen,
  sortContracts,
} from '@/lib/contractUtils';
import ContractCard from '@/components/contracts/ContractCard';
import ContractSheet from '@/components/contracts/ContractSheet';

/**
 * 契約の画面（賃貸・保険・サブスクなど。docs/contracts.md §7.1）。その他タブの「契約」の行から開く。
 * 戻る操作（端末の戻るボタン・左上の矢印）でその他タブへ戻る。Web版は `src/components/sukusuku/tabs/ContractsScreen.tsx`。
 *
 * 見出し・年間の目安・絞り込みは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 一覧は更新日の近い順（過ぎたものが先）。見えるのは、見せる相手に選ばれた契約だけ（DB のポリシー）。
 */

type Filter = 'all' | ContractKind;

/** 編集の対象。null は閉じている、'new' は追加。 */
type Editing = Contract | 'new' | null;

export default function ContractsScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const [loadedContracts, loadedMembers] = await Promise.all([
          loadContracts(supabase, membership.familyId),
          listMembers(supabase, membership.familyId),
        ]);
        if (!isMounted) return;
        setContracts(loadedContracts);
        setMembers(loadedMembers);
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

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  useFamilyRefresh(['contracts', 'contract_fields', 'family_members'], () => {
    if (!familyId) return;
    void Promise.all([loadContracts(supabase, familyId), listMembers(supabase, familyId)])
      .then(([loadedContracts, loadedMembers]) => {
        setContracts(loadedContracts);
        setMembers(loadedMembers);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

  const today = toDateString(new Date());
  const myMemberId = members.find((member) => member.userId === userId)?.id ?? null;
  const memberName = (id: string | null) => members.find((member) => member.id === id)?.displayName ?? null;

  const sorted = useMemo(() => sortContracts(contracts), [contracts]);
  const shown = filter === 'all' ? sorted : sorted.filter((contract) => contract.kind === filter);
  const total = useMemo(() => annualTotal(contracts), [contracts]);
  const countOf = (kind: Filter) =>
    kind === 'all' ? contracts.length : contracts.filter((contract) => contract.kind === kind).length;

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  const save = async (draft: ContractDraft) => {
    const target = editing;
    setEditing(null);
    if (!familyId || !userId || target === null) return;
    try {
      if (target === 'new') {
        const created = await insertContract(supabase, familyId, userId, draft);
        setContracts((prev) => [...prev, created]);
      } else {
        const updated = await updateContract(supabase, target.id, draft);
        setContracts((prev) => prev.map((contract) => (contract.id === updated.id ? updated : contract)));
      }
    } catch {
      failed('保存');
    }
  };

  const remove = async (id: string) => {
    setEditing(null);
    const previous = contracts;
    setContracts((prev) => prev.filter((contract) => contract.id !== id));
    try {
      await deleteContract(supabase, id);
    } catch {
      setContracts(previous);
      failed('削除');
    }
  };

  /** 「更新した」。更新日だけを進める。開いているシートは閉じない。 */
  const renew = async (id: string, renewsOn: string) => {
    try {
      const updated = await setContractRenewal(supabase, id, renewsOn);
      setContracts((prev) => prev.map((contract) => (contract.id === updated.id ? updated : contract)));
    } catch {
      failed('更新');
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

  const filters: Filter[] = ['all', ...CONTRACT_KINDS];

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/info'))}
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeft size={22} color={colors.textMuted} />
          <FileText size={20} color={colors.contract} />
          <Text style={styles.title}>契約</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="契約を追加"
          onPress={() => setEditing('new')}
          disabled={!familyId}
          style={styles.addButton}
        >
          <Plus size={18} color={colors.contract} />
        </Pressable>
      </View>

      <View style={styles.total}>
        <View>
          <Text style={styles.totalLabel}>年間の目安</Text>
          <Text style={styles.totalNote}>見えている契約の合計</Text>
        </View>
        <Text style={styles.totalValue}>{formatYen(total)}</Text>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {filters.map((kind) => {
            const selected = filter === kind;
            return (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(kind)}
                style={[styles.filter, selected && styles.filterSelected]}
              >
                <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                  {kind === 'all' ? 'すべて' : KIND_LABEL[kind]} {countOf(kind)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
      ) : shown.length === 0 ? (
        <View style={styles.empty}>
          <FileText size={32} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>
            {contracts.length === 0 ? 'まだ契約がありません' : 'この種類の契約はありません'}
          </Text>
          <Text style={styles.emptyBody}>
            賃貸・保険・サブスクなどを控えると、更新日が近いときに知らせます。右上の＋から追加できます。
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {shown.map((contract) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              contractorName={memberName(contract.contractorId)}
              today={today}
              onPress={() => setEditing(contract)}
            />
          ))}
        </ScrollView>
      )}

      {editing !== null && (
        <ContractSheet
          // 対象が変わるたびに作り直して、書きかけを持ち越さない。
          key={editing === 'new' ? 'new' : editing.id}
          contract={editing === 'new' ? null : editing}
          members={members}
          myMemberId={myMemberId}
          today={today}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
          onRenew={editing === 'new' ? undefined : (renewsOn) => void renew(editing.id, renewsOn)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.contractSurface,
  },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#99f6e4', // teal-200
    backgroundColor: colors.contractSurface,
  },
  totalLabel: { fontSize: 11, fontWeight: '700', color: colors.contract },
  totalNote: { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  totalValue: { fontSize: 22, fontWeight: '800', color: '#115e59', fontVariant: ['tabular-nums'] }, // teal-800
  filters: { gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  filter: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  filterSelected: { backgroundColor: colors.contract, borderColor: colors.contract },
  filterText: { fontSize: 12, fontWeight: '700', color: colors.neutralBadgeText, fontVariant: ['tabular-nums'] },
  filterTextSelected: { color: colors.primaryText },
  list: { gap: 8, paddingHorizontal: 16, paddingBottom: 24 },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  emptyBody: { fontSize: 13, fontWeight: '400', color: colors.textMuted, textAlign: 'center' },
});
