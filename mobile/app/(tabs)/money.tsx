import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyFeedData,
  MoneyFeedItem,
  MoneyRecord,
  MoneyRecordDraft,
  MoneyRecurring,
  MoneySecuritiesData,
  MoneySecurity,
  MoneySecurityDraft,
  MoneyStore,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletDraft,
  MoneyRecordKind,
  ReceiptScan,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
import { getMyMembership } from '@/lib/api/me';
import { useFamilyRefresh } from '@/lib/familySync';
import { OPEN_MONEY_PARAM, parseMoneyOpen } from '@/lib/appLinks';
import {
  deleteMoneyWallet,
  deleteMoneyRecord,
  deleteMoneyWalletBalance,
  insertMoneyWallet,
  loadMoneyStores,
  restoreMoneyWallet,
  saveMoneyRecord,
  saveMoneyWalletBalance,
  updateMoneyWallet,
} from '@/lib/api/money';
import {
  archiveSecurity,
  loadSecurities,
  loadSecurityHistory,
  requestSecurityBackfill,
  saveSecurity,
} from '@/lib/api/moneySecurities';
import { loadMoneyBootstrap } from '@/lib/api/moneyBootstrap';
import { scanReceipt } from '@/lib/api/moneyReceipt';
import { captureReceipt } from '@/lib/receiptCapture';
import {
  fillMoneyFeed,
  loadMoneyFeed,
  resolveMoneyFeed,
  type MoneyFeedFill,
  type MoneyFeedResolve,
} from '@/lib/api/moneyFeed';
import { feedDayLabel, feedDuplicates } from '@/lib/moneyFeedUtils';
import { dateKeyOfDate, fixedBudgetRows, formatYen, monthKeyOf, monthKeyOfDate, recordTotal, yearOfMonth } from '@/lib/moneyUtils';
import MoneyAccountsView from '@/components/money/MoneyAccountsView';
import MoneyRecordsView from '@/components/money/MoneyRecordsView';
import MoneyReviewView from '@/components/money/MoneyReviewView';
import RecordEditor from '@/components/money/RecordEditor';
import CategoryEditor from '@/components/money/CategoryEditor';
import MoneySettings from '@/components/money/MoneySettings';
import MoneyFab from '@/components/money/MoneyFab';
import MoneyFeedInbox from '@/components/money/MoneyFeedInbox';
import { type ReviewPeriod } from '@/components/money/moneyVisual';

/**
 * 家計タブ（docs/kakei.md）。日々の収支の記録と、月・年の振り返り。
 * Web版の `src/components/sukusuku/tabs/MoneyTab.tsx` と同じ項目・並び・文言にしてある。
 *
 * 中は「口座 / 記録 / 振り返り」の3つ。右下の1つの大きな丸いボタン「＋」を押すと、記録の追加・レシートを読む・家計の設定が開く（§2）。
 * どの面も「送り → 結論（数字を1つ大きく）→ 内訳 → 明細」の順（見た目の決まりは §2.1・moneyVisual）。
 * - 記録: その月に使った額と、記録を日ごとに。押すと記録の詳細（RecordEditor。Zaim と同じ流れ）
 * - 振り返り: 月と年（暦年）は同じ面で、送りの右「月 / 年」で期間を切り替える（§4）。結論は生活費の収支
 *   （収入 − 支出。貯金は入れない）。内訳の行（大分類）を押すと、簡単な分析と絞った記録の一覧（§4.4）
 * - 口座: 総残高と出金元ごとの残高（確定した残高 + その後の記録）。残高の確定、出金元の追加・編集もここ（§9.3）
 * - 見出しは出さない（2026-10-10。切り替えの帯が見出しを兼ねる）。右下の大きなボタンを押すと、「記録を追加」「家計の設定」
 *   （カテゴリと予算・お店・毎月の記録。docs/kakei.md §3.5）「レシートを読む」（§10）の3つが上に開く。
 *   ボタンはどの面にも出ているので、どの面からも入れる。福引チャンスは家計と連動しないので、2026-10-13にその他タブへ移した
 *
 * 見出し・切り替え・月の送りは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 */

type View3 = 'records' | 'review' | 'accounts';

const VIEWS: { id: View3; label: string }[] = [
  // 口座を一番左にし、はじめに開く面にする（2026-10-08。docs/kakei.md §2）。
  { id: 'accounts', label: '口座' },
  { id: 'records', label: '記録' },
  { id: 'review', label: '振り返り' },
];

/** 記録の入力。null は閉じている、'new' は新しく記録する。 */
type Editing = MoneyRecord | 'new' | null;

const NO_SECURITIES: MoneySecuritiesData = { securities: [], holdings: [], values: [], historyLoaded: true };

/** 家計の読み込み（money_bootstrap と証券の評価額、Zaim 取り込み）が読む表。 */
const MONEY_TABLES = [
  'money_budgets',
  'money_categories',
  'money_feed',
  'money_feed_rules',
  'money_feed_settings',
  'money_holding_values',
  'money_holdings',
  'money_items',
  'money_records',
  'money_recurring',
  'money_securities',
  'money_stores',
  'money_wallet_balances',
  'money_wallets',
] as const;

export default function MoneyScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [categories, setCategories] = useState<MoneyCategory[]>([]);
  const [budgets, setBudgets] = useState<MoneyBudget[]>([]);
  const [wallets, setWallets] = useState<MoneyWallet[]>([]);
  const [stores, setStores] = useState<MoneyStore[]>([]);
  const [records, setRecords] = useState<MoneyRecord[]>([]);
  const [recurring, setRecurring] = useState<MoneyRecurring[]>([]);
  // 手入力の予算（budgets）に、固定費から出した月ごとの額（記録と同じ額）を足した予算。画面にはこちらを渡す（docs/kakei.md §3.1）。
  const allBudgets = useMemo(
    () => [...budgets, ...fixedBudgetRows(recurring, categories, records, dateKeyOfDate(new Date()))],
    [budgets, recurring, categories, records],
  );
  const [balances, setBalances] = useState<MoneyWalletBalance[]>([]);
  const [securities, setSecurities] = useState<MoneySecuritiesData>(NO_SECURITIES);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<View3>('accounts');
  const [monthKey, setMonthKey] = useState(() => monthKeyOfDate(new Date()));
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState<ReviewPeriod>('month');
  const [editing, setEditing] = useState<Editing>(null);
  // 新しい記録を開くときの種類（ホーム画面のウィジェットの「収入」「振替」から来たとき。ふだんは支出）。
  const [newKind, setNewKind] = useState<MoneyRecordKind>('expense');
  // レシートの読み取りの結果（記録の入力に入れて開く）と、読み取り中か（docs/kakei.md §10）。
  const [receipt, setReceipt] = useState<ReceiptScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Zaim から取り込んだ明細と取り込みの設定（docs/kakei.md §9.5）。null は読み込み中。
  const [feed, setFeed] = useState<MoneyFeedData | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);

  // 評価額の履歴（推移用）は、推移・証券口座の詳細を開くまで読まない。一度読んだら、読み直しでも履歴まで読む。
  const historyWanted = useRef(false);
  const historyLoading = useRef(false);

  const reload = useCallback(async (id: string) => {
    // 起動で読むものは、DBの money_bootstrap で1回にまとめて読む（docs/kakei.md §9.2.6）。
    // Zaim 取り込み（未確認の明細・ルール・設定）は並べて読む。読めなくても家計は出す。
    const [{ money, securities: loadedSecurities }, loadedFeed] = await Promise.all([
      loadMoneyBootstrap(supabase, id, historyWanted.current),
      loadMoneyFeed(supabase, id).catch(() => null),
    ]);
    if (loadedFeed) setFeed(loadedFeed);
    setCategories(money.categories);
    setBudgets(money.budgets);
    setWallets(money.wallets);
    setStores(money.stores);
    setRecords(money.records);
    setRecurring(money.recurring);
    setBalances(money.balances);
    setSecurities(loadedSecurities);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        await reload(membership.familyId);
      } catch {
        // 圏外でも画面は出す。読めなかったぶんは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [userId, reload]);

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  // 家計の表が変わったときだけ読む（money_bootstrap が読む表。docs/kakei.md §9.2.6）。
  useFamilyRefresh(MONEY_TABLES, () => {
    if (!familyId) return;
    void reload(familyId).catch(() => {
      // 圏外なら前に読んだ分を出したままにする。
    });
  });

  const needSecurityHistory = useCallback(async () => {
    if (!familyId) return;
    historyWanted.current = true;
    if (historyLoading.current) return;
    historyLoading.current = true;
    try {
      const values = await loadSecurityHistory(supabase, familyId);
      setSecurities((prev) => ({ ...prev, values, historyLoaded: true }));
    } catch {
      // 読めなかったら「読み込み中」のまま。開き直すと読み直す。
    } finally {
      historyLoading.current = false;
    }
  }, [familyId]);


  /** 振り返りの月 ↔ 年。年へ行くときは今見ている月の年を、月へ戻るときは見ている年の月を開く。 */
  const changePeriod = (next: ReviewPeriod) => {
    if (next === 'year') {
      setYear(yearOfMonth(monthKey));
    } else if (yearOfMonth(monthKey) !== year) {
      const current = monthKeyOfDate(new Date());
      setMonthKey(yearOfMonth(current) === year ? current : `${year}-01`);
    }
    setPeriod(next);
  };
  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  /**
   * 新しく入れる記録が、Zaim から取り込んだ明細の記録と重なっていないか（docs/kakei.md §9.5.5 の最後）。
   * 同じ口座・同じ額・前後の日（手入力との確認の幅）の記録があれば、入れるか聞く。入れないなら false。
   */
  const confirmNotDuplicate = (draft: MoneyRecordDraft): Promise<boolean> => {
    if (!feed) return Promise.resolve(true);
    const duplicates = feedDuplicates(draft, records, new Set(feed.linkedRecordIds), feed.settings.manualDays);
    if (duplicates.length === 0) return Promise.resolve(true);
    const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
    const lines = duplicates
      .map((record) => {
        const where =
          record.kind === 'transfer' ? `${walletName(record.walletId)} → ${walletName(record.toWalletId)}` : walletName(record.walletId);
        const kind = record.kind === 'transfer' ? '振替' : record.kind === 'income' ? '収入' : '支出';
        return `${feedDayLabel(record.occurredOn)} ${kind} ${formatYen(recordTotal(record))}（${where}）`;
      })
      .join('\n');
    return new Promise((resolve) =>
      Alert.alert(
        '同じ取引が取り込まれています',
        `Zaim から取り込んだ記録に、同じ口座・同じ額のものがあります。\n${lines}\n\nそれでも入れますか？`,
        [
          { text: '入れない', style: 'cancel', onPress: () => resolve(false) },
          { text: '入れる', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );
  };

  const saveRecord = async (draft: MoneyRecordDraft) => {
    if (!(await confirmNotDuplicate(draft))) return;
    setEditing(null);
    setReceipt(null);
    try {
      const saved = await saveMoneyRecord(supabase, draft);
      setRecords((prev) => [...prev.filter((record) => record.id !== saved.id), saved]);
      setMonthKey(monthKeyOf(saved.occurredOn));
      // 「お店に登録して使う」を選んだお店は、DBの save_money_record がお店の設定に登録する（docs/kakei.md §3.5）。
      if (familyId && draft.registerStore && saved.store !== '' && !stores.some((entry) => entry.name === saved.store && !entry.archived)) {
        setStores(await loadMoneyStores(supabase, familyId));
      }
    } catch {
      failed('保存');
    }
  };

  /** 取り込んだ明細を1件片づける（docs/kakei.md §9.5.6.1）。記録が増えたり確定したりするので、家計ごと読み直す。 */
  const resolveFeed = async (item: MoneyFeedItem, resolve: MoneyFeedResolve): Promise<boolean> => {
    if (!familyId) return false;
    try {
      const status = await resolveMoneyFeed(supabase, item.id, resolve);
      await reload(familyId);
      // 口座を選んだだけで、まだ未確認に残るときは枠を開いたままにする
      return !(resolve.action === 'wallet' && status === 'pending');
    } catch {
      failed('保存');
      return false;
    }
  };

  /** 読めないメールに中身を入れる（docs/kakei.md §9.5.6.1）。入れたあとは未確認として続けて片づける。 */
  const fillFeed = async (item: MoneyFeedItem, fill: MoneyFeedFill): Promise<boolean> => {
    if (!familyId) return false;
    try {
      await fillMoneyFeed(supabase, item.id, fill);
      await reload(familyId);
      return true;
    } catch {
      failed('保存');
      return false;
    }
  };

  const reloadFeed = async () => {
    if (!familyId) return;
    try {
      await reload(familyId);
    } catch {
      // 圏外なら前に読んだ分を出したままにする。
    }
  };

  /** レシートを撮って読み取り、その内容を入れた記録の入力を開く（docs/kakei.md §10）。 */
  const startReceiptScan = async () => {
    let images: Awaited<ReturnType<typeof captureReceipt>>;
    try {
      images = await captureReceipt();
    } catch {
      Alert.alert('カメラを開けませんでした');
      return;
    }
    if (!images) return;
    setScanning(true);
    try {
      setReceipt(await scanReceipt(supabase, images));
      setEditing('new');
    } catch (error) {
      Alert.alert('レシートを読み取れませんでした', error instanceof Error ? error.message : undefined);
    } finally {
      setScanning(false);
    }
  };

  // ホーム画面のウィジェットから来たときに、その入力を開く（docs/widgets.md §2.3）。
  // 口座・お店の既定は読み込んだ記録から決めるので、読み終えてから開く。開いたらパラメータを消す
  // （この画面へ戻るたびに開き直さないため。育児タブの open と同じ）。
  const { open: requestedOpen } = useLocalSearchParams<{ open?: string }>();
  useEffect(() => {
    const open = parseMoneyOpen(requestedOpen);
    if (!open || isLoading || !familyId) return;
    router.setParams({ [OPEN_MONEY_PARAM]: '' });
    if (open === 'receipt') {
      void startReceiptScan();
      return;
    }
    setReceipt(null);
    setNewKind(open);
    setEditing('new');
    // startReceiptScan は描くたびに作り直されるが、開くのはパラメータが来たときの1回だけでよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedOpen, isLoading, familyId]);

  const removeRecord = async (record: MoneyRecord) => {
    setEditing(null);
    const previous = records;
    setRecords((prev) => prev.filter((entry) => entry.id !== record.id));
    try {
      await deleteMoneyRecord(supabase, record.id);
    } catch {
      setRecords(previous);
      failed('削除');
    }
  };

  const saveWallet = async (target: MoneyWallet | null, draft: MoneyWalletDraft): Promise<MoneyWallet | null> => {
    if (!familyId) return null;
    try {
      const saved =
        target === null
          ? await insertMoneyWallet(
              supabase,
              familyId,
              draft,
              wallets.reduce((max, wallet) => Math.max(max, wallet.position + 1), 0),
            )
          : await updateMoneyWallet(supabase, target.id, draft);
      setWallets((prev) => [...prev.filter((wallet) => wallet.id !== saved.id), saved]);
      return saved;
    } catch {
      failed('保存');
      return null;
    }
  };

  // 出金元を削除する。記録は残り、出金元は「なし」になる。DBで書き換わるものが多い（記録・ルール・補正・保有）ので読み直す。
  const deleteWallet = async (wallet: MoneyWallet) => {
    if (!familyId) return;
    try {
      await deleteMoneyWallet(supabase, wallet.id);
      await reload(familyId);
    } catch {
      failed('削除');
    }
  };

  const restoreWallet = async (wallet: MoneyWallet) => {
    try {
      const saved = await restoreMoneyWallet(supabase, wallet.id);
      setWallets((prev) => prev.map((entry) => (entry.id === saved.id ? saved : entry)));
    } catch {
      failed('保存');
    }
  };

  /**
   * 銘柄を保存する（docs/kakei.md §9.2）。足したとき・コードを変えたときは、サーバーに過去1年の価格と
   * 評価額を作らせてから読み直す（数秒かかる。先に保存した分を出しておく）。
   */
  const saveSecurityOf = async (walletId: string, target: MoneySecurity | null, draft: MoneySecurityDraft) => {
    if (!familyId) return;
    try {
      const { securityId, needsBackfill } = await saveSecurity(
        supabase,
        familyId,
        walletId,
        target,
        draft,
        securities.holdings,
        securities.securities.reduce((max, security) => Math.max(max, security.position + 1), 0),
      );
      setSecurities(await loadSecurities(supabase, familyId, historyWanted.current));
      if (needsBackfill) {
        await requestSecurityBackfill(supabase, securityId);
        setSecurities(await loadSecurities(supabase, familyId, historyWanted.current));
      }
    } catch {
      failed('保存');
    }
  };

  const archiveSecurityOf = async (walletId: string, security: MoneySecurity) => {
    if (!familyId) return;
    try {
      await archiveSecurity(supabase, walletId, security);
      setSecurities(await loadSecurities(supabase, familyId, historyWanted.current));
    } catch {
      failed('保存');
    }
  };

  /** 残高を確定する。同じ出金元・同じ日の確定は上書きされる。 */
  const confirmBalance = async (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => {
    if (!familyId) return;
    try {
      const saved = await saveMoneyWalletBalance(supabase, familyId, walletId, balanceOn, amount, showInHistory);
      setBalances((prev) => [
        ...prev.filter((entry) => !(entry.walletId === saved.walletId && entry.balanceOn === saved.balanceOn)),
        saved,
      ]);
    } catch {
      failed('確定');
    }
  };

  const removeBalance = async (balance: MoneyWalletBalance) => {
    const previous = balances;
    setBalances((prev) => prev.filter((entry) => entry.id !== balance.id));
    try {
      await deleteMoneyWalletBalance(supabase, balance.id);
    } catch {
      setBalances(previous);
      failed('取り消し');
    }
  };

  // 口座/記録/振り返りは、帯と中身の上の左右スワイプでも切り替える
  // 帯の下の中身は指に合わせて横に動く。
  const viewSwipe = useSwipeTabs(
    VIEWS.map((entry) => entry.id),
    view,
    setView,
  );

  if (isSessionLoading) {
    return (
      <SafeAreaView edges={['top']} style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.body} {...viewSwipe.handlers}>
        <View accessibilityRole="tablist" style={styles.views}>
          {VIEWS.map((entry) => {
            const selected = entry.id === view;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setView(entry.id)}
                style={styles.viewTab}
              >
                <Text style={[styles.viewText, selected && styles.viewTextSelected]}>{entry.label}</Text>
                <View style={[styles.underline, selected && styles.underlineSelected]} />
              </Pressable>
            );
          })}
        </View>

        <Animated.View style={[styles.body, viewSwipe.style]}>
          {view === 'records' ? (
            <MoneyRecordsView
              monthKey={monthKey}
              onMonth={setMonthKey}
              records={records}
              categories={categories}
              wallets={wallets}
              isLoading={isLoading}
              onOpen={setEditing}
            />
          ) : view === 'review' ? (
            <MoneyReviewView
              period={period}
              onPeriod={changePeriod}
              monthKey={monthKey}
              onMonth={setMonthKey}
              year={year}
              onYear={setYear}
              records={records}
              categories={categories}
              budgets={allBudgets}
              wallets={wallets}
              onSelectMonth={(next) => {
                setMonthKey(next);
                setPeriod('month');
              }}
              onEditCategories={() => setEditingCategories(true)}
              onOpenRecord={setEditing}
            />
          ) : (
            <MoneyAccountsView
              wallets={wallets}
              records={records}
              balances={balances}
              securities={securities}
              categories={categories}
              isLoading={isLoading}
              onOpenRecord={setEditing}
              onConfirm={(walletId, balanceOn, amount, showInHistory) => void confirmBalance(walletId, balanceOn, amount, showInHistory)}
              onDeleteBalance={(balance) => void removeBalance(balance)}
              onSaveWallet={saveWallet}
              onDeleteWallet={(wallet) => void deleteWallet(wallet)}
              onRestoreWallet={(wallet) => void restoreWallet(wallet)}
              onSaveSecurity={(walletId, target, draft) => void saveSecurityOf(walletId, target, draft)}
              onNeedSecurityHistory={needSecurityHistory}
              onArchiveSecurity={(walletId, security) => void archiveSecurityOf(walletId, security)}
              feedOpenCount={feed?.open.length ?? 0}
              onOpenFeed={() => setFeedOpen(true)}
            />
          )}
        </Animated.View>
      </View>

      {/* 右下の1つの大きなボタン。押すと「記録を追加」「レシートを読む」「家計の設定」が開く（2026-10-10）。 */}
      <MoneyFab
        addDisabled={!familyId}
        settingsDisabled={!familyId}
        onAdd={() => {
          setNewKind('expense');
          setEditing('new');
        }}
        onScan={() => void startReceiptScan()}
        onSettings={() => setSettingsOpen(true)}
      />

      {scanning && (
        <View style={styles.scanning}>
          <ActivityIndicator color={colors.primaryText} />
          <Text style={styles.scanningText}>レシートを読み取っています…</Text>
        </View>
      )}

      {editing !== null && (
        <RecordEditor
          key={editing === 'new' ? (receipt ? 'receipt' : `new-${newKind}`) : editing.id}
          record={editing === 'new' ? null : editing}
          receipt={editing === 'new' ? receipt : null}
          initialKind={newKind}
          categories={categories}
          budgets={allBudgets}
          wallets={wallets}
          stores={stores}
          records={records}
          onClose={() => {
            setEditing(null);
            setReceipt(null);
          }}
          onSubmit={(draft) => void saveRecord(draft)}
          onDelete={(record) => void removeRecord(record)}
          onSaveWallet={saveWallet}
          onDeleteWallet={(wallet) => void deleteWallet(wallet)}
          onEditCategories={() => setEditingCategories(true)}
        />
      )}

      {settingsOpen && familyId && (
        <MoneySettings
          familyId={familyId}
          year={yearOfMonth(monthKey)}
          categories={categories}
          budgets={allBudgets}
          stores={stores}
          wallets={wallets}
          recurring={recurring}
          records={records}
          onCategories={setCategories}
          onBudgets={setBudgets}
          onStores={setStores}
          onRecurring={setRecurring}
          feed={feed}
          onFeedChanged={reloadFeed}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {feedOpen && feed && (
        <MoneyFeedInbox
          items={feed.open}
          linkedRecordIds={feed.linkedRecordIds}
          wallets={wallets}
          records={records}
          categories={categories}
          budgets={allBudgets}
          onResolve={resolveFeed}
          onFill={fillFeed}
          onClose={() => setFeedOpen(false)}
        />
      )}

      {editingCategories && familyId && (
        <CategoryEditor
          familyId={familyId}
          year={yearOfMonth(monthKey)}
          categories={categories}
          budgets={allBudgets}
          onCategories={setCategories}
          onBudgets={setBudgets}
          onClose={() => setEditingCategories(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // レシートの読み取り中（数秒）。画面を暗くして、ほかの操作をさせない。
  scanning: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  scanningText: { fontSize: 15, fontWeight: '600', color: colors.primaryText },
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  // 3つの面の切り替え。等幅に並べ、選んでいる面は濃い文字と青い下線。
  views: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  viewTab: { flex: 1, paddingTop: 8, alignItems: 'center' },
  viewText: { fontSize: 15, fontWeight: '600', color: colors.textFaint },
  viewTextSelected: { color: colors.text, fontWeight: '700' },
  underline: { marginTop: 8, height: 3, width: 32, borderRadius: 2, backgroundColor: 'transparent' },
  underlineSelected: { backgroundColor: colors.money },
});
