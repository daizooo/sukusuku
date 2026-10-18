import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Inbox, Plus } from 'lucide-react-native';
import type {
  MoneyCategory,
  MoneyRecord,
  MoneySecuritiesData,
  MoneySecurity,
  MoneySecurityDraft,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
} from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildWalletBalances,
  dateKeyOfDate,
  formatBalance,
  groupWalletSections,
  reorderedPositions,
  WALLET_DELETE_NOTE,
  WALLET_TYPES,
  type WalletBalanceRow,
} from '@/lib/moneyUtils';
import { useDragReorder } from '@/components/list/useDragReorder';
import { WalletSheet } from '@/components/money/WalletPicker';
import TotalTrendScreen from '@/components/money/TotalTrendScreen';
import WalletBalanceScreen from '@/components/money/WalletBalanceScreen';
import SecuritiesWalletScreen from '@/components/money/SecuritiesWalletScreen';
import { Hero, WalletTypeIcon, type } from '@/components/money/moneyVisual';

// 家計タブの「口座」（docs/kakei.md §7 の7・§9.3）。PWA版の `src/components/sukusuku/money/MoneyAccountsView.tsx` と同じ並び・文言。
//
// 一番上に総残高（固定。押すと推移）、その下に出金元ごとの残高（Zaim の「残高」と同じ。アイコンは記録の一覧と同じ絵と色）。
// 残高＝最後に補正した残高 + その後の記録（支出・収入・振替）。補正は、通帳・銀行のアプリと違うときに詳細から入れる
// （「未確定」などの印は出さない。2026-10-08に、出しっぱなしでうるさいので外した）。
// 出金元を押すと詳細（履歴 / 推移 / 残高計算）。長押しでつかむと、同じ種類の中で並べ替えられる（2026-10-18。money_wallets.position）。出金元の追加・編集・使わなくする・また使うもこの面から。
// 総残高に入れるのは使っている出金元だけ。カードは未払いがマイナスで入る（請求済み・未請求の内訳は、押した先の詳細だけに出す）。
// 証券口座の残高は、記録からではなく保有銘柄の評価額（docs/kakei.md §9.2）。押すと証券口座の詳細（推移と保有銘柄）。

interface WalletSection {
  type: (typeof WALLET_TYPES)[number];
  rows: WalletBalanceRow[];
}

interface MoneyAccountsViewProps {
  /** この面を開いているか。false から true になったとき、いちばん上へ戻す。 */
  active: boolean;
  wallets: MoneyWallet[];
  records: MoneyRecord[];
  balances: MoneyWalletBalance[];
  securities: MoneySecuritiesData;
  categories: MoneyCategory[];
  isLoading: boolean;
  onOpenRecord: (record: MoneyRecord) => void;
  onConfirm: (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => void;
  onDeleteBalance: (balance: MoneyWalletBalance) => void;
  onSaveWallet: (target: MoneyWallet | null, draft: MoneyWalletDraft) => Promise<MoneyWallet | null>;
  onDeleteWallet: (wallet: MoneyWallet) => void;
  onRestoreWallet: (wallet: MoneyWallet) => void;
  /** 種類の中の並びを動かしたあと。変わった出金元の position。 */
  onReorderWallets: (changes: { id: string; position: number }[]) => void;
  onSaveSecurity: (walletId: string, target: MoneySecurity | null, draft: MoneySecurityDraft) => void;
  onArchiveSecurity: (walletId: string, security: MoneySecurity) => void;
  /** 推移・証券口座の詳細を開いたときに、評価額の履歴を読ませる（一覧は最新の1行だけで出す）。 */
  onNeedSecurityHistory: () => void | Promise<void>;
  /** Gmail から取り込んだ明細のうち、片づいていないものの数（docs/kakei.md §9.5.6.1）。0 なら出さない。 */
  feedOpenCount: number;
  onOpenFeed: () => void;
}

export default function MoneyAccountsView({
  active,
  wallets,
  records,
  balances,
  securities,
  categories,
  isLoading,
  onOpenRecord,
  onConfirm,
  onDeleteBalance,
  onSaveWallet,
  onDeleteWallet,
  onRestoreWallet,
  onReorderWallets,
  onSaveSecurity,
  onArchiveSecurity,
  onNeedSecurityHistory,
  feedOpenCount,
  onOpenFeed,
}: MoneyAccountsViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const today = dateKeyOfDate(new Date());
  const summary = useMemo(
    () => buildWalletBalances(wallets, records, balances, today, securities),
    [wallets, records, balances, today, securities],
  );
  const usable = summary.rows.filter((row) => !row.wallet.archived);
  const archived = summary.rows.filter((row) => row.wallet.archived);
  const sectionBlocks = groupWalletSections(
    WALLET_TYPES.map((walletType) => ({
      type: walletType,
      rows: usable.filter((row) => row.wallet.type === walletType.id),
    })).filter((section) => section.rows.length > 0),
  );
  const drag = useDragReorder((_sectionKey, orderedIds) => {
    const changes = reorderedPositions(wallets, orderedIds);
    if (changes.length > 0) onReorderWallets(changes);
  });
  const opened = wallets.find((wallet) => wallet.id === openId) ?? null;
  const needsHistory =
    (opened !== null && opened.type === 'securities') ||
    (showTrend && wallets.some((wallet) => wallet.type === 'securities' && !wallet.archived));
  useEffect(() => {
    if (needsHistory && !securities.historyLoaded) onNeedSecurityHistory();
  }, [needsHistory, securities.historyLoaded, onNeedSecurityHistory]);

  // 出金元の種類ごとの見出し＋タイル。Zaim の「残高」と同じく2列に並べる（2026-10-08）。金額は大きく太く、プラスは緑・マイナスは「−」と黒（2026-10-10）。
  // paired は「1件だけの種類を2つ横に並べた」ときで、区画は半分の幅になり、タイルはその幅いっぱいに広げる。
  const renderSection = ({ type: walletType, rows: inType }: WalletSection, paired: boolean) => (
    <View key={walletType.id} style={[styles.section, paired && styles.sectionPaired]}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{walletType.label}</Text>
        <Text style={styles.sectionSum}>{formatBalance(inType.reduce((sum, row) => sum + row.amount, 0))}</Text>
      </View>
      <View style={styles.grid} {...drag.panHandlers}>
        {inType.map((row) => (
          <Pressable
            key={row.wallet.id}
            accessibilityRole="button"
            onPress={() => setOpenId(row.wallet.id)}
            {...drag.holdProps(
              `wallets-${walletType.id}`,
              inType.map((entry) => ({ id: entry.wallet.id })),
              row.wallet.id,
            )}
            {...drag.measureProps(row.wallet.id)}
            style={({ pressed }) => [
              styles.tile,
              paired && styles.tilePaired,
              pressed && styles.pressed,
              drag.styleFor(row.wallet.id),
              drag.isDragging(row.wallet.id) && styles.lifted,
            ]}
          >
            <View style={styles.tileTop}>
              <WalletTypeIcon type={row.wallet.type} size={20} color={row.wallet.iconColor} />
              <Text style={styles.tileName} numberOfLines={2}>
                {row.wallet.name}
              </Text>
            </View>
            <Text style={[styles.tileAmount, row.amount > 0 && styles.tilePlus]}>{formatBalance(row.amount)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  // この面を開くたびに、いちばん上から（隠していただけの面に、前のスクロールが残らないように。2026-10-16）。
  const scrollRef = useRef<ScrollView>(null);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) scrollRef.current?.scrollTo({ y: 0, animated: false });
    wasActive.current = active;
  }, [active]);

  return (
    <View style={styles.flex}>
      {/* 総残高も一覧と一緒に流れる（固定しない。2026-10-08）。 */}
      <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.content} scrollEnabled={!drag.isActive}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="総残高の推移を見る"
          onPress={() => setShowTrend(true)}
          disabled={usable.length === 0}
          style={styles.hero}
        >
          <Hero
            label="総残高"
            center
            value={formatBalance(summary.total)}
            compact
            note={usable.length === 0 ? '出金元を足すと、残高が出ます' : undefined}
          />
        </Pressable>
        {feedOpenCount > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenFeed}
            style={({ pressed }) => [styles.feed, pressed && styles.pressed]}
          >
            <Inbox size={18} color={colors.moneyText} />
            <Text style={styles.feedText}>未確認 {feedOpenCount}件</Text>
            <Text style={styles.feedSub}>Gmail から取り込んだ明細</Text>
            <ChevronRight size={16} color={colors.moneyText} />
          </Pressable>
        )}
        {isLoading && <Text style={styles.message}>読み込み中...</Text>}
        {/* 項目が1つだけの種類（プリペイド・証券など）は、隣り合うもの同士を横に並べて1行にまとめ、高さを縮める。2つ以上になった種類は単独で2列に戻る。 */}
        {sectionBlocks.map((block) =>
          block.length === 1 ? (
            renderSection(block[0], false)
          ) : (
            <View key={block.map((section) => section.type.id).join('+')} style={styles.pairRow}>
              {block.map((section) => renderSection(section, true))}
            </View>
          ),
        )}

        <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={styles.add}>
          <Plus size={18} color={colors.money} />
          <Text style={styles.addText}>出金元を足す</Text>
        </Pressable>

        {archived.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>使わない出金元（記録には残っています）</Text>
            <View style={styles.card}>
              {archived.map((row, index) => (
                <View key={row.wallet.id} style={[styles.row, index > 0 && styles.rowDivided]}>
                  <Text style={[type.row, styles.flex, styles.archivedName]} numberOfLines={1}>
                    {row.wallet.name}
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => onRestoreWallet(row.wallet)} hitSlop={8}>
                    <Text style={type.link}>また使う</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${row.wallet.name}を削除`}
                    onPress={() =>
                      Alert.alert(`${row.wallet.name}を削除しますか？`, WALLET_DELETE_NOTE, [
                        { text: 'やめる', style: 'cancel' },
                        { text: '削除する', style: 'destructive', onPress: () => onDeleteWallet(row.wallet) },
                      ])
                    }
                    hitSlop={8}
                  >
                    <Text style={[type.link, styles.deleteLink]}>削除</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {opened !== null && opened.type === 'securities' && (
        <SecuritiesWalletScreen
          key={opened.id}
          wallet={opened}
          wallets={wallets}
          securities={securities}
          onClose={() => setOpenId(null)}
          onSaveWallet={onSaveWallet}
          onDeleteWallet={onDeleteWallet}
          onSaveSecurity={onSaveSecurity}
          onArchiveSecurity={onArchiveSecurity}
        />
      )}
      {opened !== null && opened.type !== 'securities' && (
        <WalletBalanceScreen
          key={opened.id}
          wallet={opened}
          wallets={wallets}
          records={records}
          balances={balances}
          categories={categories}
          onClose={() => setOpenId(null)}
          onOpenRecord={onOpenRecord}
          onConfirm={onConfirm}
          onDeleteBalance={onDeleteBalance}
          onSaveWallet={onSaveWallet}
          onDeleteWallet={onDeleteWallet}
        />
      )}
      {showTrend && (
        <TotalTrendScreen
          wallets={wallets}
          records={records}
          balances={balances}
          securities={securities}
          today={today}
          onClose={() => setShowTrend(false)}
        />
      )}
      {adding && (
        <WalletSheet
          wallet={null}
          wallets={wallets}
          onClose={() => setAdding(false)}
          onSubmit={(draft) => {
            setAdding(false);
            void onSaveWallet(null, draft);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { paddingTop: 6 },
  // 右下の「＋」に一覧の最後が隠れないよう、下を空ける。
  content: { paddingHorizontal: 16, paddingBottom: 96 },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  section: { marginTop: 8, gap: 3 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  sectionSum: { fontSize: 12, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  // 1件だけの種類を2つ横に並べる行。区画の上の余白は行の側でとる。
  pairRow: { flexDirection: 'row', gap: 6 },
  sectionPaired: { flex: 1, minWidth: 0 },
  tilePaired: { width: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: {
    width: '48.5%',
    justifyContent: 'space-between',
    gap: 2,
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  tileName: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 16, color: colors.textMuted },
  // 金額は名前より大きく太く。プラスは明るい緑、マイナスは「−」をつけて黒（Zaim と同じ）。
  tileAmount: { alignSelf: 'flex-end', fontSize: 21, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  tilePlus: { color: colors.moneyIncome },
  lifted: { opacity: 0.9, elevation: 8 },
  archivedName: { opacity: 0.7 },
  deleteLink: { color: colors.danger },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  feed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: colors.moneySoft,
  },
  feedText: { fontSize: 15, fontWeight: '800', color: colors.moneyText },
  feedSub: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.moneyText },
});
