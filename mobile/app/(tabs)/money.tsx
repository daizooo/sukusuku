import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyFeedData,
  MoneyFeedItem,
  MoneyMonth,
  MoneyReserve,
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
  ReceiptScanItem,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
import { getMyMembership } from '@/lib/api/me';
import { useFamilyRefresh } from '@/lib/familySync';
import { OPEN_MONEY_PARAM, parseMoneyOpen } from '@/lib/appLinks';
import {
  confirmMoneyEstimate,
  deleteMoneyWallet,
  deleteMoneyRecord,
  deleteMoneyWalletBalance,
  insertMoneyWallet,
  loadMoneyStores,
  restoreMoneyWallet,
  updateMoneyWalletPosition,
  saveMoneyRecord,
  saveMoneyWalletBalance,
  setMoneyMonthClosed,
  updateMoneyRecurringDeferred,
  updateMoneyRecurringSkipped,
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
  loadFeedOrderLines,
  loadMoneyFeed,
  resolveMoneyFeed,
  type MoneyFeedFill,
  type MoneyFeedResolve,
} from '@/lib/api/moneyFeed';
import { feedDayLabel, feedDuplicates, feedStoreName } from '@/lib/moneyFeedUtils';
import {
  dateKeyOfDate,
  formatYen,
  isMonthClosed,
  monthKeyOf,
  monthKeyOfDate,
  pendingEstimates,
  receiptReplaceNotices,
  recordTotal,
  shiftMonth,
  yearOfMonth,
  type PendingEstimate,
} from '@/lib/moneyUtils';
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
  'money_months',
  'money_records',
  'money_recurring',
  'money_reserve_budgets',
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
  // 予備費の年の額（docs/kakei.md §3.7）。
  const [reserves, setReserves] = useState<MoneyReserve[]>([]);
  // 記録の上の帯に出す見込み（帯に出すルールの、日が来て記録が無い回。docs/kakei.md §0.7）。
  const estimates = useMemo(() => pendingEstimates(recurring, records, dateKeyOfDate(new Date())), [recurring, records]);
  const [balances, setBalances] = useState<MoneyWalletBalance[]>([]);
  // 月の締め（docs/kakei.md §4.5）。
  const [closings, setClosings] = useState<MoneyMonth[]>([]);
  const [securities, setSecurities] = useState<MoneySecuritiesData>(NO_SECURITIES);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<View3>('accounts');
  // 一度開いた面は、開いたまま残して隠すだけにする（面の切り替えで毎回作り直すと、スワイプのあと表示が出るまで待たされるため。2026-10-15）。
  // 読み込みが終わって落ち着いたら、残りの面もあらかじめ作っておく。
  const [mountedViews, setMountedViews] = useState<ReadonlySet<View3>>(() => new Set<View3>(['accounts']));
  const [monthKey, setMonthKey] = useState(() => monthKeyOfDate(new Date()));
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [period, setPeriod] = useState<ReviewPeriod>('month');
  const [editing, setEditing] = useState<Editing>(null);
  // 新しい記録を開くときのカテゴリ（ホーム画面のウィジェットの「収入」「振替」から来たとき。ふだんは支出）。
  const [newKind, setNewKind] = useState<MoneyRecordKind>('expense');
  // 記録の一覧の、日の見出しの「＋」から足すときの日。それ以外は null（今日）。
  const [newDate, setNewDate] = useState<string | null>(null);
  // 「記録して続ける」の続き（2026-10-20）。次の入力に引き継ぐ日付。続けていないときは null。
  const [chain, setChain] = useState<{ seq: number; occurredOn: string } | null>(null);
  // レシートの読み取りの結果（記録の入力に入れて開く）と、読み取り中か（docs/kakei.md §10）。
  const [receipt, setReceipt] = useState<ReceiptScan | null>(null);
  // レシートを当てている既にある記録（§10.8）。null は新しい記録の読み取り。
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  // 予算（年ごと）を開いている年。null は閉じている（docs/kakei.md §3.1）。
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 家計の設定を、この固定支出の編集から開く（予算の画面の固定費の行から）。
  const [recurringTarget, setRecurringTarget] = useState<string | null>(null);
  // Gmail から取り込んだ明細と取り込みの設定（docs/kakei.md §9.5）。null は読み込み中。
  const [feed, setFeed] = useState<MoneyFeedData | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  // 未確認の明細の「記録を作成する」から開いた記録の入力の、その明細。保存したら記録と結ぶ（docs/kakei.md §9.5.6.1）。
  const [feedRecordFor, setFeedRecordFor] = useState<MoneyFeedItem | null>(null);
  // Amazon の注文メールの明細から記録するときの品目（docs/kakei.md §9.10）
  const [feedOrderItems, setFeedOrderItems] = useState<ReceiptScanItem[] | null>(null);
  // 未確定明細の見込みの「この額で記録する」で、出金元の無いものは記録の入力を開く（docs/kakei.md §0.7）。そのときの下書き。
  const [estimateDraft, setEstimateDraft] = useState<{ key: string; store: string; amount: number; items: ReceiptScanItem[] } | null>(null);

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
    setClosings(money.months);
    setReserves(money.reserves);
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
   * 新しく入れる記録が、Gmail から取り込んだ明細の記録と重なっていないか（docs/kakei.md §9.5.5 の最後）。
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
        `Gmail から取り込んだ記録に、同じ口座・同じ額のものがあります。\n${lines}\n\nそれでも入れますか？`,
        [
          { text: '入れない', style: 'cancel', onPress: () => resolve(false) },
          { text: '入れる', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );
  };

  /** 月を締める／締めを外す（docs/kakei.md §4.5）。 */
  const setMonthClosed = async (target: string, closed: boolean) => {
    if (!familyId) return;
    try {
      const saved = await setMoneyMonthClosed(supabase, familyId, target, closed);
      setClosings((prev) => [...prev.filter((entry) => entry.month !== saved.month), saved]);
    } catch {
      Alert.alert(closed ? '締められませんでした' : '締めを外せませんでした', 'もう一度お試しください。');
    }
  };

  /**
   * 締めた月の記録を直す・足す・消す前に、締めを外すか聞く（docs/kakei.md §4.5）。外さないなら false。
   * monthKeys は、直す前と直したあとの記録の月。
   */
  const confirmReopen = (monthKeys: string[]): Promise<boolean> => {
    const closed = [...new Set(monthKeys)].filter((key) => isMonthClosed(closings, key)).sort();
    if (closed.length === 0) return Promise.resolve(true);
    const label = closed.map((key) => `${Number(key.slice(5, 7))}月`).join('・');
    return new Promise((resolve) =>
      Alert.alert(
        `${label}は締めてあります`,
        '直すと締めを外します。直したあと、振り返りでもう一度締めてください。',
        [
          { text: 'やめる', style: 'cancel', onPress: () => resolve(false) },
          {
            text: '締めを外して直す',
            onPress: () => {
              void Promise.all(closed.map((key) => setMonthClosed(key, false))).then(() => resolve(true));
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );
  };

  const monthsOfDraft = (draft: MoneyRecordDraft): string[] => {
    const previous = draft.id === null ? null : records.find((record) => record.id === draft.id);
    return [monthKeyOf(draft.occurredOn), ...(previous ? [monthKeyOf(previous.occurredOn)] : [])];
  };

  /** 見込みの記録を今の額のまま確定する（締めの画面の「確定」）。 */
  const confirmEstimate = async (record: MoneyRecord) => {
    try {
      await confirmMoneyEstimate(supabase, record.id);
      setRecords((prev) => prev.map((entry) => (entry.id === record.id ? { ...entry, isEstimate: false } : entry)));
    } catch {
      failed('確定');
    }
  };

  /** next: 「記録して続ける」。保存したら、日付だけを引き継いだ次の入力を開く（レシートからなら、次のレシートを撮る）。 */
  const saveRecord = async (draft: MoneyRecordDraft, next = false) => {
    if (!(await confirmReopen(monthsOfDraft(draft)))) return;
    if (!(await confirmNotDuplicate(draft))) return;
    const fromReceipt = editing === 'new' && receipt !== null;
    setEditing(null);
    setReceipt(null);
    setReceiptFor(null);
    const feedItem = feedRecordFor;
    setFeedRecordFor(null);
    setEstimateDraft(null);
    if (next) {
      setChain((prev) => ({ seq: (prev?.seq ?? 0) + 1, occurredOn: draft.occurredOn }));
      if (!fromReceipt) setEditing('new');
    } else {
      setChain(null);
    }
    try {
      const saved = await saveMoneyRecord(supabase, draft);
      setRecords((prev) => [...prev.filter((record) => record.id !== saved.id), saved]);
      if (next && fromReceipt) void startReceiptScan();
      setMonthKey(monthKeyOf(saved.occurredOn));
      // 「お店に登録して使う」を選んだお店は、DBの save_money_record がお店の設定に登録する（docs/kakei.md §3.5）。
      if (familyId && draft.registerStore && saved.store !== '' && !stores.some((entry) => entry.name === saved.store && !entry.archived)) {
        setStores(await loadMoneyStores(supabase, familyId));
      }
      // 未確認の明細から記録したときは、その明細と結ぶ（未確認から消える）
      if (feedItem) await resolveFeed(feedItem, { action: 'link', recordId: saved.id, learn: false });
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

  /**
   * 未確定明細の見込みを「この額で記録する」（docs/kakei.md §0.7）。額・出金元・日・カテゴリ・お店で記録する。
   * 出金元があればその場で記録し、無ければそれを入れた記録の入力を開く（出金元を選んで保存する）。同じ小分類の記録が入ると済になる。
   */
  const recordEstimate = (entry: PendingEstimate, amount: number) => {
    const { rule } = entry;
    const name = rule.name.trim();
    if (rule.walletId === null) {
      setReceipt(null);
      setReceiptFor(null);
      setChain(null);
      setNewKind('expense');
      setNewDate(entry.date);
      setEstimateDraft({
        key: `${rule.id}|${entry.plannedMonth}`,
        store: rule.store,
        amount,
        items: [
          { receiptName: '', name, quantity: 1, unitPrice: amount, amount, categoryId: rule.categoryId, categorySource: 'history' },
        ],
      });
      setEditing('new');
      return;
    }
    void saveRecord({
      id: null,
      kind: 'expense',
      occurredOn: entry.date,
      walletId: rule.walletId,
      toWalletId: null,
      store: rule.store,
      isEstimate: false,
      cardNextPeriod: false,
      items: [{ amount, categoryId: rule.categoryId, categoryName: '', quantity: 1, unitPrice: amount, name, memo: '' }],
    });
  };

  /** 見込みを「翌月へ送る」（翌月1日まで帯に出さない）／「今月はなし」（その回を skippedMonths に足す）。 */
  const putOffEstimate = async (entry: PendingEstimate, how: 'defer' | 'skip'): Promise<boolean> => {
    const { rule } = entry;
    try {
      const saved =
        how === 'defer'
          ? await updateMoneyRecurringDeferred(supabase, rule.id, `${shiftMonth(monthKeyOf(dateKeyOfDate(new Date())), 1)}-01`)
          : await updateMoneyRecurringSkipped(supabase, rule.id, [...new Set([...rule.skippedMonths, entry.plannedMonth])]);
      setRecurring((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
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

  /**
   * レシートを撮って読み取り、その内容を入れた記録の入力を開く（docs/kakei.md §10）。
   * target（既にある記録）があれば、出金元・日付はそのままで品目をレシートの品目に入れ替えて開く。合計が違う・手で入れた品目が
   * あるときは、置き換えるかスキップするかを先に選ぶ（§10.8）。保存は人がする。
   */
  const startReceiptScan = async (target?: MoneyRecord) => {
    let images: Awaited<ReturnType<typeof captureReceipt>>;
    try {
      images = await captureReceipt();
    } catch {
      Alert.alert('カメラを開けませんでした');
      return;
    }
    if (!images) return;
    // 読み取っている間は記録の入力を閉じる（読み取り中の表示が見えるように）
    setEditing(null);
    setScanning(true);
    try {
      const scan = await scanReceipt(supabase, images);
      if (!target) {
        setReceiptFor(null);
        setReceipt(scan);
        setNewDate(null);
        setEditing('new');
        return;
      }
      const apply = () => {
        setReceipt(scan);
        setReceiptFor(target.id);
        setEditing(target);
      };
      const notices = receiptReplaceNotices(target, scan.receiptTotal);
      if (notices.length === 0) {
        apply();
        return;
      }
      Alert.alert('品目をレシートの品目に置き換えますか？', notices.join('\n'), [
        { text: 'スキップ', style: 'cancel', onPress: () => setEditing(target) },
        { text: '置き換える', onPress: apply },
      ]);
    } catch (error) {
      // 読み取れなかったら、閉じた入力に戻す（新しい記録は空の入力）
      setEditing(target ?? 'new');
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
      setChain(null);
      void startReceiptScan();
      return;
    }
    setReceipt(null);
    setChain(null);
    setNewKind(open);
    setNewDate(null);
    setEditing('new');
    // startReceiptScan は描くたびに作り直されるが、開くのはパラメータが来たときの1回だけでよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedOpen, isLoading, familyId]);

  const removeRecord = async (record: MoneyRecord) => {
    if (!(await confirmReopen([monthKeyOf(record.occurredOn)]))) return;
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

  /** 口座の面で、種類の中の並びを指で動かしたあと。変わった position だけ保存する。 */
  const reorderWallets = (changes: { id: string; position: number }[]) => {
    setWallets((prev) =>
      prev
        .map((entry) => {
          const hit = changes.find((change) => change.id === entry.id);
          return hit ? { ...entry, position: hit.position } : entry;
        })
        .sort((a, b) => a.position - b.position),
    );
    void Promise.all(changes.map((change) => updateMoneyWalletPosition(supabase, change.id, change.position))).catch(() =>
      failed('並べ替え'),
    );
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

  // 記録の一覧の、日の見出しの「＋」。一覧の行を作り直さないよう、関数は固定しておく。
  const addOnDate = useCallback((date: string) => {
    setReceipt(null);
    setChain(null);
    setNewKind('expense');
    setNewDate(date);
    setEditing('new');
  }, []);

  // 読み込みが終わったら、まだ開いていない面もあらかじめ作っておく（最初のスワイプで待たされないように）。
  useEffect(() => {
    if (isLoading) return undefined;
    const handle = InteractionManager.runAfterInteractions(() => {
      setMountedViews(new Set<View3>(['accounts', 'records', 'review']));
    });
    return () => handle.cancel();
  }, [isLoading]);

  const showView = useCallback((next: View3) => {
    setMountedViews((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
    setView(next);
  }, []);

  // 口座/記録/振り返りは、帯と中身の上の左右スワイプでも切り替える
  // 帯の下の中身は指に合わせて横に動く。
  const viewSwipe = useSwipeTabs(
    VIEWS.map((entry) => entry.id),
    view,
    showView,
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
                onPress={() => showView(entry.id)}
                style={styles.viewTab}
              >
                <View>
                  <Text style={[styles.viewText, selected && styles.viewTextSelected]}>{entry.label}</Text>
                  {/* 未確定明細があるあいだ、「記録」の右上に赤い点（無くなったら消す。2026-10-18。見込みも数える 2026-10-21）。 */}
                  {entry.id === 'records' && (feed?.open.length ?? 0) + estimates.length > 0 && <View style={styles.badge} />}
                </View>
                <View style={[styles.underline, selected && styles.underlineSelected]} />
              </Pressable>
            );
          })}
        </View>

        <Animated.View style={[styles.body, viewSwipe.style]}>
          {(view === 'records' || mountedViews.has('records')) && (
            <View style={view === 'records' ? styles.body : styles.hidden}>
            <MoneyRecordsView
              active={view === 'records'}
              records={records}
              categories={categories}
              wallets={wallets}
              isLoading={isLoading}
              onOpen={setEditing}
              onAddOnDate={addOnDate}
              feedOpenCount={feed?.open.length ?? 0}
              estimateCount={estimates.length}
              onOpenFeed={() => setFeedOpen(true)}
              feedStalled={feed?.syncStalled ?? false}
            />
            </View>
          )}
          {(view === 'review' || mountedViews.has('review')) && (
            <View style={view === 'review' ? styles.body : styles.hidden}>
            <MoneyReviewView
              active={view === 'review'}
              period={period}
              onPeriod={changePeriod}
              monthKey={monthKey}
              onMonth={setMonthKey}
              year={year}
              onYear={setYear}
              records={records}
              categories={categories}
              budgets={budgets}
              wallets={wallets}
              balances={balances}
              onSelectMonth={(next) => {
                setMonthKey(next);
                setPeriod('month');
              }}
              onOpenRecord={setEditing}
              months={closings}
              recurring={recurring}
              reserves={reserves}
              feedItems={feed?.open ?? []}
              cardFeed={feed?.cardFeed ?? null}
              onConfirmEstimate={confirmEstimate}
              onSetMonthClosed={(target, closed) => void setMonthClosed(target, closed)}
              onOpenFeed={() => setFeedOpen(true)}
            />
            </View>
          )}
          {(view === 'accounts' || mountedViews.has('accounts')) && (
            <View style={view === 'accounts' ? styles.body : styles.hidden}>
            <MoneyAccountsView
              active={view === 'accounts'}
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
              onReorderWallets={reorderWallets}
              onSaveSecurity={(walletId, target, draft) => void saveSecurityOf(walletId, target, draft)}
              onNeedSecurityHistory={needSecurityHistory}
              onArchiveSecurity={(walletId, security) => void archiveSecurityOf(walletId, security)}
            />
            </View>
          )}
        </Animated.View>
      </View>

      {/* 右下の＋（記録を追加）と、その上の設定。どちらも1回で開く（2026-10-20）。 */}
      <MoneyFab
        addDisabled={!familyId}
        settingsDisabled={!familyId}
        onAdd={() => {
          // レシートから続けて記録したあとにカメラを閉じたときの続きは、ここで終える。
          setChain(null);
          setNewKind('expense');
          setNewDate(null);
          setEditing('new');
        }}
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
          key={editing === 'new' ? (receipt ? 'receipt' : `new-${newKind}-${newDate ?? ''}-${feedRecordFor?.id ?? ''}-${estimateDraft?.key ?? ''}-${chain?.seq ?? 0}`) : `${editing.id}${receiptFor === editing.id ? '-receipt' : ''}`}
          record={editing === 'new' ? null : editing}
          receipt={editing === 'new' || receiptFor === editing.id ? receipt : null}
          onScanReceipt={(target) => void startReceiptScan(target ?? undefined)}
          initialKind={newKind}
          initialDate={chain?.occurredOn ?? newDate}
          initialWallet={feedRecordFor?.walletId ?? null}
          initialStore={feedRecordFor ? feedStoreName(feedRecordFor) : (estimateDraft?.store ?? '')}
          initialAmount={feedRecordFor?.amount ?? estimateDraft?.amount ?? null}
          initialItems={feedRecordFor ? feedOrderItems : (estimateDraft?.items ?? null)}
          categories={categories}
          budgets={budgets}
          wallets={wallets}
          stores={stores}
          records={records}
          onClose={() => {
            setEditing(null);
            setReceipt(null);
            setReceiptFor(null);
            setFeedRecordFor(null);
            setEstimateDraft(null);
            setChain(null);
          }}
          onSubmit={(draft) => void saveRecord(draft)}
          onSubmitNext={(draft) => void saveRecord(draft, true)}
          onDelete={(record) => void removeRecord(record)}
          onEditCategories={() => setEditingCategories(true)}
        />
      )}

      {settingsOpen && familyId && (
        <MoneySettings
          familyId={familyId}
          year={yearOfMonth(monthKey)}
          categories={categories}
          budgets={budgets}
          stores={stores}
          wallets={wallets}
          recurring={recurring}
          records={records}
          onCategories={setCategories}
          onBudgets={setBudgets}
          onStores={setStores}
          onRecurring={setRecurring}
          reserves={reserves}
          onReserves={setReserves}
          initialRecurringId={recurringTarget}
          feed={feed}
          onFeedChanged={reloadFeed}
          onClose={() => {
            setSettingsOpen(false);
            setRecurringTarget(null);
          }}
        />
      )}

      {feedOpen && (
        <MoneyFeedInbox
          items={feed?.open ?? []}
          wallets={wallets}
          records={records}
          categories={categories}
          onRecord={(item) => {
            void (async () => {
              // Amazon の注文メールの明細は、品目まで入れて開く（docs/kakei.md §9.10）
              let items: ReceiptScanItem[] | null = null;
              if (item.amazonOrderId) {
                try {
                  items = await loadFeedOrderLines(supabase, item.id);
                } catch {
                  failed('品目の読み込み');
                  return;
                }
              }
              setReceipt(null);
              setReceiptFor(null);
              setChain(null);
              setNewKind(item.direction === 'in' ? 'income' : 'expense');
              setNewDate(item.occurredOn);
              setFeedOrderItems(items);
              setFeedRecordFor(item);
              setEditing('new');
            })();
          }}
          onResolve={resolveFeed}
          onFill={fillFeed}
          estimates={estimates}
          onRecordEstimate={recordEstimate}
          onDeferEstimate={(entry) => putOffEstimate(entry, 'defer')}
          onSkipEstimate={(entry) => putOffEstimate(entry, 'skip')}
          onClose={() => setFeedOpen(false)}
        />
      )}

      {editingCategories && familyId && (
        <CategoryEditor
          familyId={familyId}
          categories={categories}
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
  // 開いたことのある面のうち、いま見ていないもの（作り直さず隠すだけ）。
  hidden: { display: 'none' },
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
  badge: { position: 'absolute', top: -1, right: -9, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
});
