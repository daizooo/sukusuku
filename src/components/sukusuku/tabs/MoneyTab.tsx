'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ReceiptScan,
  ReceiptScanItem,
} from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { useSwipeTabs } from '../ui/useSwipeTabs';
import { useSessionState } from '@/lib/sessionState';
import { useFamilyRefresh } from '@/lib/familySync';
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
  updateMoneyWallet,
} from '@/lib/api/money';
import {
  archiveSecurity,
  loadSecurities,
  loadSecurityHistory,
  requestSecurityBackfill,
  saveSecurity,
} from '@/lib/api/moneySecurities';
import { loadMoneyBootstrap, type MoneyBootstrap } from '@/lib/api/moneyBootstrap';
import { scanReceipt } from '@/lib/api/moneyReceipt';
import { receiptImagesFromFiles } from '@/lib/receiptCapture';
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
  estimateBudgetRows,
  fixedBudgetRows,
  reserveBudgetRows,
  formatYen,
  isMonthClosed,
  monthKeyOf,
  monthKeyOfDate,
  receiptReplaceNotices,
  recordTotal,
  yearOfMonth,
} from '@/lib/moneyUtils';
import MoneyAccountsView from '../money/MoneyAccountsView';
import MoneyRecordsView from '../money/MoneyRecordsView';
import MoneyReviewView from '../money/MoneyReviewView';
import RecordEditor from '../money/RecordEditor';
import CategoryEditor from '../money/CategoryEditor';
import MoneySettings from '../money/MoneySettings';
import MoneyFab from '../money/MoneyFab';
import MoneyFeedInbox from '../money/MoneyFeedInbox';
import { type ReviewPeriod } from '../money/moneyVisual';

/**
 * 家計タブ（docs/kakei.md）。日々の収支の記録と、月・年の振り返り。
 * mobile版の `mobile/app/(tabs)/money.tsx` と同じ項目・並び・文言にしてある。
 *
 * 中は「口座 / 記録 / 振り返り」の3つ。右下の1つの大きな丸いボタン「＋」を押すと、記録の追加・家計の設定・福引チャンスが開く（§2）。
 * どの面も「送り → 結論（数字を1つ大きく）→ 内訳 → 明細」の順（見た目の決まりは §2.1・moneyVisual）。
 * - 記録: その月に使った額と、記録を日ごとに。押すと記録の詳細（RecordEditor。Zaim と同じ流れ）
 * - 振り返り: 月と年（暦年）は同じ面で、送りの右「月 / 年」で期間を切り替える（§4）。結論は生活費の収支
 *   （収入 − 支出。貯金は入れない）。内訳の行（大分類）を押すと、簡単な分析と絞った記録の一覧（§4.4）
 * - 口座: 総残高と出金元ごとの残高（確定した残高 + その後の記録）。残高の確定、出金元の追加・編集もここ（§9.3）
 * - 見出しは出さない（2026-10-10。切り替えの帯が見出しを兼ねる）。右下の大きなボタンを押すと、「記録を追加」「家計の設定」
 *   （カテゴリ・予算・お店・毎月の記録。docs/kakei.md §3.5）「福引チャンス」（紫のチケット。暮らしタブの廃止で
 *   移した。docs/home.md §9）の3つが上に開く。ボタンはどの面にも出ているので、どの面からも入れる
 *
 * 見出し・切り替え・月の送りは固定し、スクロールするのは一覧だけ（CLAUDE.md）。
 * 他のタブと違い、読み書きはこのタブの中で完結させる（アプリ全体の状態に持たない）。
 */

type MoneyView = 'records' | 'review' | 'accounts';

const VIEWS: { id: MoneyView; label: string }[] = [
  // 口座を一番左にし、はじめに開く面にする（2026-10-08。docs/kakei.md §2）。
  { id: 'accounts', label: '口座' },
  { id: 'records', label: '記録' },
  { id: 'review', label: '振り返り' },
];

/** 記録の入力。null は閉じている、'new' は新しく記録する。 */
type Editing = MoneyRecord | 'new' | null;

const NO_SECURITIES: MoneySecuritiesData = { securities: [], holdings: [], values: [], historyLoaded: true };

/** 家計の読み込み（money_bootstrap と証券の評価額、Zaim 取り込み）が読む表。mobile版（mobile/app/(tabs)/money.tsx）と同じ。 */
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
  'money_reserves',
  'money_securities',
  'money_stores',
  'money_wallet_balances',
  'money_wallets',
] as const;

export default function MoneyTab({ familyId }: { familyId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MoneyCategory[]>([]);
  const [budgets, setBudgets] = useState<MoneyBudget[]>([]);
  const [wallets, setWallets] = useState<MoneyWallet[]>([]);
  const [stores, setStores] = useState<MoneyStore[]>([]);
  const [records, setRecords] = useState<MoneyRecord[]>([]);
  const [recurring, setRecurring] = useState<MoneyRecurring[]>([]);
  // 予備費の年の額（docs/kakei.md §3.7）。
  const [reserves, setReserves] = useState<MoneyReserve[]>([]);
  // 手入力の予算（budgets）に、固定費から出した月ごとの額（記録と同じ額）を足した予算。画面にはこちらを渡す（docs/kakei.md §3.1）。
  const allBudgets = useMemo(
    () => {
      const today = dateKeyOfDate(new Date());
      return [
        ...budgets,
        ...fixedBudgetRows(recurring, categories, records, today),
        // 見積費（車検・ふるさと納税など。記録を作らず、予算と着地見込みにだけ入る。docs/kakei.md §3.6）。
        ...estimateBudgetRows(recurring, categories, records, today),
        // 予備費（使った分はその大分類・月、まだ使っていない分は着地見込みだけが読む行。docs/kakei.md §3.7）。
        ...reserveBudgetRows(reserves, categories, records, today),
      ];
    },
    [budgets, recurring, categories, records, reserves],
  );
  const [balances, setBalances] = useState<MoneyWalletBalance[]>([]);
  // 月の締め（docs/kakei.md §4.5）。
  const [closings, setClosings] = useState<MoneyMonth[]>([]);
  const [securities, setSecurities] = useState<MoneySecuritiesData>(NO_SECURITIES);
  const [isLoading, setIsLoading] = useState(true);
  // 家計の面・月・年・期間は、ブラウザの更新をしても今のまま戻す（2026-10-16）。
  const [view, setView] = useSessionState<MoneyView>('money.view', 'accounts');
  // 一度開いた面は、開いたまま残して隠すだけにする（面の切り替えで毎回作り直すと、スワイプのあと表示が出るまで待たされるため。
  // mobile版と同じ。2026-10-15）。読み込みが終わって落ち着いたら、残りの面もあらかじめ作っておく。
  const [mountedViews, setMountedViews] = useState<ReadonlySet<MoneyView>>(() => new Set<MoneyView>(['accounts']));
  const [monthKey, setMonthKey] = useSessionState('money.month', monthKeyOfDate(new Date()));
  const [year, setYear] = useSessionState('money.year', new Date().getFullYear());
  const [period, setPeriod] = useSessionState<ReviewPeriod>('money.period', 'month');
  const [editing, setEditing] = useState<Editing>(null);
  // 記録の一覧の、日の見出しの「＋」から足すときの日。それ以外は null（今日）。
  const [newDate, setNewDate] = useState<string | null>(null);
  // レシートの読み取りの結果（記録の入力に入れて開く）と、読み取り中か（docs/kakei.md §10）。
  const [receipt, setReceipt] = useState<ReceiptScan | null>(null);
  // レシートを当てている既にある記録（§10.8）。null は新しい記録の読み取り。
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  // 写真を選ぶ前に「どの記録に当てるか」を覚えておく（ファイルの選択は別の流れで返ってくるため）
  const receiptTarget = useRef<MoneyRecord | null>(null);
  const [scanning, setScanning] = useState(false);
  const receiptInput = useRef<HTMLInputElement>(null);
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

  // 評価額の履歴（推移用）は、推移・証券口座の詳細を開くまで読まない。一度読んだら、読み直しでも履歴まで読む。
  const historyWanted = useRef(false);
  const historyLoading = useRef(false);

  /** 読んだものを画面に入れる。 */
  const apply = useCallback(
    ({ money, securities: loadedSecurities }: MoneyBootstrap) => {
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
    },
    [],
  );
  // 起動で読むものは、DBの money_bootstrap で1回にまとめて読む（docs/kakei.md §9.2.6）。
  const fetchAll = useCallback(
    () => loadMoneyBootstrap(supabase, familyId, historyWanted.current),
    [supabase, familyId],
  );
  // Zaim 取り込み（未確認の明細・ルール・設定）は家計と並べて読む。読めなくても家計は出す。
  const loadFeed = useCallback(
    () =>
      loadMoneyFeed(supabase, familyId)
        .then(setFeed)
        .catch(() => {
          // 読めなかったら前に読んだ分のまま。
        }),
    [supabase, familyId],
  );
  const reload = () => Promise.all([fetchAll().then(apply), loadFeed()]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    let isMounted = true;
    fetchAll()
      .then((loaded) => {
        if (isMounted) apply(loaded);
      })
      .catch(() => {
        // 読めなかったぶんは空のままにする。
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [fetchAll, apply]);

  // パートナーの端末での変更に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  // 家計の表が変わったときだけ読む（money_bootstrap が読む表。docs/kakei.md §9.2.6）。
  useFamilyRefresh(MONEY_TABLES, () => {
    reload().catch(() => {
      // 圏外なら前に読んだ分を出したままにする。
    });
  });

  const needSecurityHistory = useCallback(async () => {
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
  }, [supabase, familyId]);


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
  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);

  /**
   * 新しく入れる記録が、Gmail から取り込んだ明細の記録と重なっていないか（docs/kakei.md §9.5.5 の最後）。
   * 同じ口座・同じ額・前後の日（手入力との確認の幅）の記録があれば、入れるか聞く。入れないなら false。
   */
  const confirmNotDuplicate = (draft: MoneyRecordDraft): boolean => {
    if (!feed) return true;
    const duplicates = feedDuplicates(draft, records, new Set(feed.linkedRecordIds), feed.settings.manualDays);
    if (duplicates.length === 0) return true;
    const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
    const lines = duplicates
      .map((record) => {
        const where =
          record.kind === 'transfer' ? `${walletName(record.walletId)} → ${walletName(record.toWalletId)}` : walletName(record.walletId);
        const kind = record.kind === 'transfer' ? '振替' : record.kind === 'income' ? '収入' : '支出';
        return `${feedDayLabel(record.occurredOn)} ${kind} ${formatYen(recordTotal(record))}（${where}）`;
      })
      .join('\n');
    return window.confirm(
      `同じ取引が取り込まれています。Gmail から取り込んだ記録に、同じ口座・同じ額のものがあります。\n${lines}\n\nそれでも入れますか？`,
    );
  };

  /** 月を締める／締めを外す（docs/kakei.md §4.5）。 */
  const setMonthClosed = async (target: string, closed: boolean) => {
    try {
      const saved = await setMoneyMonthClosed(supabase, familyId, target, closed);
      setClosings((prev) => [...prev.filter((entry) => entry.month !== saved.month), saved]);
    } catch {
      window.alert(`${closed ? '締められませんでした' : '締めを外せませんでした'}。もう一度お試しください。`);
    }
  };

  /**
   * 締めた月の記録を直す・足す・消す前に、締めを外すか聞く（docs/kakei.md §4.5）。外さないなら false。
   * monthKeys は、直す前と直したあとの記録の月。
   */
  const confirmReopen = async (monthKeys: string[]): Promise<boolean> => {
    const closed = [...new Set(monthKeys)].filter((key) => isMonthClosed(closings, key)).sort();
    if (closed.length === 0) return true;
    const label = closed.map((key) => `${Number(key.slice(5, 7))}月`).join('・');
    if (!window.confirm(`${label}は締めてあります。直すと締めを外します。直したあと、振り返りでもう一度締めてください。`)) {
      return false;
    }
    await Promise.all(closed.map((key) => setMonthClosed(key, false)));
    return true;
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

  const saveRecord = async (draft: MoneyRecordDraft) => {
    if (!(await confirmReopen(monthsOfDraft(draft)))) return;
    if (!confirmNotDuplicate(draft)) return;
    setEditing(null);
    setReceipt(null);
    setReceiptFor(null);
    const feedItem = feedRecordFor;
    setFeedRecordFor(null);
    try {
      const saved = await saveMoneyRecord(supabase, draft);
      setRecords((prev) => [...prev.filter((record) => record.id !== saved.id), saved]);
      setMonthKey(monthKeyOf(saved.occurredOn));
      // 「お店に登録して使う」を選んだお店は、DBの save_money_record がお店の設定に登録する（docs/kakei.md §3.5）。
      if (draft.registerStore && saved.store !== '' && !stores.some((entry) => entry.name === saved.store && !entry.archived)) {
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
    try {
      const status = await resolveMoneyFeed(supabase, item.id, resolve);
      await reload();
      // 口座を選んだだけで、まだ未確認に残るときは枠を開いたままにする
      return !(resolve.action === 'wallet' && status === 'pending');
    } catch {
      failed('保存');
      return false;
    }
  };

  /** 読めないメールに中身を入れる（docs/kakei.md §9.5.6.1）。入れたあとは未確認として続けて片づける。 */
  const fillFeed = async (item: MoneyFeedItem, fill: MoneyFeedFill): Promise<boolean> => {
    try {
      await fillMoneyFeed(supabase, item.id, fill);
      await reload();
      return true;
    } catch {
      failed('保存');
      return false;
    }
  };

  const reloadFeed = async () => {
    try {
      await reload();
    } catch {
      // 圏外なら前に読んだ分を出したままにする。
    }
  };

  /**
   * 撮った・選んだレシートの写真を読み取り、その内容を入れた記録の入力を開く（docs/kakei.md §10）。
   * 既にある記録に当てるとき（receiptTarget）は、出金元・日付はそのままで品目をレシートの品目に入れ替えて開く。合計が違う・
   * 手で入れた品目があるときは、置き換えるかスキップするかを先に選ぶ（§10.8）。保存は人がする。
   */
  const readReceipt = async (files: FileList | null) => {
    const target = receiptTarget.current;
    receiptTarget.current = null;
    if (!files || files.length === 0) return;
    // 読み取っている間は記録の入力を閉じる（読み取り中の表示が見えるように）
    setEditing(null);
    setScanning(true);
    try {
      const images = await receiptImagesFromFiles(files);
      if (images.length === 0) {
        setEditing(target ?? 'new');
        return;
      }
      const scan = await scanReceipt(supabase, images);
      if (!target) {
        setReceiptFor(null);
        setReceipt(scan);
        setNewDate(null);
        setEditing('new');
        return;
      }
      const notices = receiptReplaceNotices(target, scan.receiptTotal);
      if (notices.length > 0 && !window.confirm(`品目をレシートの品目に置き換えますか？\n${notices.join('\n')}`)) {
        setEditing(target);
        return;
      }
      setReceipt(scan);
      setReceiptFor(target.id);
      setEditing(target);
    } catch (error) {
      // 読み取れなかったら、閉じた入力に戻す（新しい記録は空の入力）
      setEditing(target ?? 'new');
      window.alert(`レシートを読み取れませんでした。${error instanceof Error ? error.message : ''}`);
    } finally {
      setScanning(false);
      if (receiptInput.current) receiptInput.current.value = '';
    }
  };

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
    try {
      await deleteMoneyWallet(supabase, wallet.id);
      await reload();
    } catch {
      failed('削除');
    }
  };

  /**
   * 銘柄を保存する（docs/kakei.md §9.2）。足したとき・コードを変えたときは、サーバーに過去1年の価格と
   * 評価額を作らせてから読み直す（数秒かかる。先に保存した分を出しておく）。
   */
  const saveSecurityOf = async (walletId: string, target: MoneySecurity | null, draft: MoneySecurityDraft) => {
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
    try {
      await archiveSecurity(supabase, walletId, security);
      setSecurities(await loadSecurities(supabase, familyId, historyWanted.current));
    } catch {
      failed('保存');
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

  /** 残高を確定する。同じ出金元・同じ日の確定は上書きされる。 */
  const confirmBalance = async (walletId: string, balanceOn: string, amount: number, showInHistory: boolean) => {
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
    setNewDate(date);
    setEditing('new');
  }, []);

  // 読み込みが終わったら、まだ開いていない面もあらかじめ作っておく（最初のスワイプで待たされないように）。
  useEffect(() => {
    if (isLoading) return undefined;
    const timer = window.setTimeout(() => setMountedViews(new Set<MoneyView>(['accounts', 'records', 'review'])), 600);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  // 面を切り替えたら、開いた面は必ずいちばん上から（隠していただけの面に、前のスクロールが残らないように。2026-10-16）。
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(`[data-money-view="${view}"] *`).forEach((element) => {
      if (element.scrollTop > 0) element.scrollTop = 0;
    });
  }, [view]);

  const showView = useCallback((next: MoneyView) => {
    setMountedViews((prev) => (prev.has(next) ? prev : new Set([...prev, next])));
    setView(next);
  }, []);

  // 口座/記録/振り返りは、帯と中身の上の左右スワイプでも切り替える
  // 帯の下の中身は指に合わせて横に動く。
  const { handlers: swipeHandlers, attachContent } = useSwipeTabs(
    VIEWS.map((entry) => entry.id),
    view,
    showView,
  );

  return (
    <div className="relative p-4 pb-0 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="flex min-h-0 flex-1 flex-col" {...swipeHandlers}>
        {/* 3つの面の切り替え。等幅に並べ、選んでいる面は濃い文字と青い下線。 */}
        <div role="tablist" className="shrink-0 flex border-b border-gray-200">
          {VIEWS.map((entry) => {
            const selected = entry.id === view;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => showView(entry.id)}
                className="flex flex-1 flex-col items-center pt-2"
              >
                <span className={`relative text-[15px] ${selected ? 'font-bold text-gray-900' : 'font-semibold text-gray-400'}`}>
                  {entry.label}
                  {/* 未確認の明細があるあいだ、「記録」の右上に赤い点（無くなったら消す。2026-10-18）。 */}
                  {entry.id === 'records' && (feed?.open.length ?? 0) > 0 && (
                    <span className="absolute -right-[9px] -top-px h-2 w-2 rounded-full bg-red-500" />
                  )}
                </span>
                <span className={`mt-2 h-[3px] w-8 rounded-full ${selected ? 'bg-blue-600' : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>

        <div ref={attachContent} className="flex min-h-0 flex-1 flex-col">
          {(view === 'records' || mountedViews.has('records')) && (
            <div data-money-view="records" className={view === 'records' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <MoneyRecordsView
              active={view === 'records'}
              records={records}
              categories={categories}
              wallets={wallets}
              isLoading={isLoading}
              onOpen={setEditing}
              onAddOnDate={addOnDate}
              feedOpenCount={feed?.open.length ?? 0}
              onOpenFeed={() => setFeedOpen(true)}
              feedStalled={feed?.syncStalled ?? false}
            />
            </div>
          )}
          {(view === 'review' || mountedViews.has('review')) && (
            <div data-money-view="review" className={view === 'review' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
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
              balances={balances}
              onSelectMonth={(next) => {
                setMonthKey(next);
                setPeriod('month');
              }}
              onOpenRecord={setEditing}
              months={closings}
              recurring={recurring}
              feedItems={feed?.open ?? []}
              cardFeed={feed?.cardFeed ?? null}
              onConfirmEstimate={confirmEstimate}
              onSetMonthClosed={(target, closed) => void setMonthClosed(target, closed)}
              onOpenFeed={() => setFeedOpen(true)}
            />
            </div>
          )}
          {(view === 'accounts' || mountedViews.has('accounts')) && (
            <div data-money-view="accounts" className={view === 'accounts' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
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
              onReorderWallets={reorderWallets}
              onSaveSecurity={(walletId, target, draft) => void saveSecurityOf(walletId, target, draft)}
              onArchiveSecurity={(walletId, security) => void archiveSecurityOf(walletId, security)}
              onNeedSecurityHistory={needSecurityHistory}
            />
            </div>
          )}
        </div>
      </div>

      {/* 右下の＋（記録を追加）と、その上の設定。どちらも1回で開く（2026-10-20）。 */}
      <MoneyFab
        onAdd={() => {
          setNewDate(null);
          setEditing('new');
        }}
        onSettings={() => setSettingsOpen(true)}
      />

      {/* レシートの写真（スマホではカメラが開く。長いレシートは分けて撮って複数選ぶ）。 */}
      <input
        ref={receiptInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => void readReceipt(event.target.files)}
      />
      {scanning && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/50">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/40 border-t-white" />
          <p className="text-[15px] font-semibold text-white">レシートを読み取っています…</p>
        </div>
      )}

      {settingsOpen && (
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

      {feedOpen && feed && (
        <MoneyFeedInbox
          items={feed.open}
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
              setNewDate(item.occurredOn);
              setFeedOrderItems(items);
              setFeedRecordFor(item);
              setEditing('new');
            })();
          }}
          onResolve={resolveFeed}
          onFill={fillFeed}
          onClose={() => setFeedOpen(false)}
        />
      )}

      {/* 未確認の明細の「記録を作成する」から開くので、未確認の一覧より上に重ねる（後に置く） */}
      {editing !== null && (
        <RecordEditor
          key={editing === 'new' ? (receipt ? 'receipt' : `new-${newDate ?? ''}-${feedRecordFor?.id ?? ''}`) : `${editing.id}${receiptFor === editing.id ? '-receipt' : ''}`}
          record={editing === 'new' ? null : editing}
          receipt={editing === 'new' || receiptFor === editing.id ? receipt : null}
          initialDate={newDate}
          initialKind={feedRecordFor?.direction === 'in' ? 'income' : 'expense'}
          initialWallet={feedRecordFor?.walletId ?? null}
          initialStore={feedRecordFor ? feedStoreName(feedRecordFor) : ''}
          initialAmount={feedRecordFor?.amount ?? null}
          initialItems={feedRecordFor ? feedOrderItems : null}
          onScanReceipt={(target) => {
            receiptTarget.current = target;
            receiptInput.current?.click();
          }}
          categories={categories}
          budgets={allBudgets}
          wallets={wallets}
          stores={stores}
          records={records}
          onClose={() => {
            setEditing(null);
            setReceipt(null);
            setReceiptFor(null);
            setFeedRecordFor(null);
          }}
          onSubmit={(draft) => void saveRecord(draft)}
          onDelete={(record) => void removeRecord(record)}
          onSaveWallet={saveWallet}
          onDeleteWallet={(wallet) => void deleteWallet(wallet)}
          onEditCategories={() => setEditingCategories(true)}
        />
      )}

      {editingCategories && (
        <CategoryEditor
          familyId={familyId}
          categories={categories}
          onCategories={setCategories}
          onBudgets={setBudgets}
          onClose={() => setEditingCategories(false)}
        />
      )}

    </div>
  );
}
