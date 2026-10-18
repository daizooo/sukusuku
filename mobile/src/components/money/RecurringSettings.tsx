import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronRight, GripVertical, Pencil, Plus } from 'lucide-react-native';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyHolidayRule,
  MoneyRecord,
  MoneyRecordKind,
  MoneyRecurring,
  MoneyRecurringDraft,
  MoneyStore,
  MoneyWallet,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { toDateString, WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  categoryPath,
  estimateCostBasis,
  formatShortDate,
  formatYen,
  HOLIDAY_RULE_LABEL,
  isEstimateCost,
  monthKeyOfDate,
  parsePeriodMonth,
  periodMonthInput,
  RECORD_KIND_LABEL,
  recurringEnded,
  recurringHistory,
  recurringPeriodLabel,
  recurringScheduleLabel,
  reorderedPositions,
  storeChoices,
  WEEK_OF_MONTH_OPTIONS,
} from '@/lib/moneyUtils';
import {
  deleteMoneyRecurring,
  insertMoneyRecurring,
  insertMoneyStore,
  setMoneyRecurringArchived,
  updateMoneyRecurring,
  updateMoneyRecurringPosition,
} from '@/lib/api/money';
import { useDragReorder } from '@/components/list/useDragReorder';
import CategoryPicker from '@/components/money/CategoryPicker';
import StorePicker from '@/components/money/StorePicker';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 毎月の記録の設定（docs/kakei.md §3.3・§3.4・§3.5）。PWA版の `src/components/sukusuku/money/RecurringSettings.tsx` と同じ並び・文言。
//
// 口座から落ちる固定支出・口座に入る給料などを、項目ごとのルールにする。サーバーが毎朝、その日に当たる記録を作る
// （DBの make_money_recurring_records）。額を見込むものは、過去1年の記録（カテゴリ・出金元・お店が同じもの）から出す。
// カード代金はここではなく、出金元のカードに締め日・引き落とし日・引き落とし口座を入れると作られる（ここには出さない。2026-10-18）。
// 直すのはルールだけで、もう作った記録は変わらない。
//
// 固定収入（給与・賞与。2026-10-11。docs/kakei.md §0.3）・振替も同じルールで、同じ画面「固定支出・収入」の上の切り替え（支出／収入／振替。タップだけ）で出す
// （2026-10-18に統合）。収入のルールの編集は、入金先・振込日・見込み額の言葉にする。賞与は1回ごとに1件のルール（月・日・額）で、「複製して足す」で回を増やす。
//
// 並べ替え（左の持ち手をつかんで動かす。リストと同じ操作）は、見出し（固定・予定）ごとの中で動かせる。
// 複製は、編集の画面の「複製して足す」から。日・月・額など全部を写し、品名に「のコピー」を付けた新規の編集を開き、直して保存すると足される。
//
// 期間（開始月・終了月。2026-10-15）: 育休給付金 〜2027/8、時短後の給与 2027/9〜 のように、期間の外の月は記録も予算も作らない。
// 期間が終わったルールは、一覧の下に畳んで出す（押すと開く）。
//
// 記録しない予定（2026-10-17。docs/kakei.md §3.6）: 車検・ふるさと納税・行事のように、出ることは決まっているが額が少しぶれ、カードや現金で
// 払うもの。編集の「種類」で「予定」を選ぶ（自動で記録するものは「固定」）。出金元・お店・日は持たず、カテゴリ（小分類）・予定の月・額だけ。
// 記録は作らず、その月の予算と年末の着地見込みにだけ入る。実績は、その年に同じ小分類で入った記録が自動で結びつく（予算の画面に出す）。
// 額は「入れた額」か「前回の実績から見込む」（その小分類で前回入った実績）。一覧では支出の「固定」のあと、「予定」の見出しの下にまとめる。

type RecurringMode = 'expense' | 'income' | 'transfer';

/** 一覧の切り替え。'expense'＝固定支出（固定・予定）、'income'＝固定収入（給与・賞与）、'transfer'＝振替。 */
const modeOf = (rule: MoneyRecurring): RecurringMode => rule.kind;

const MODE_TABS: { id: RecurringMode; label: string }[] = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '収入' },
  { id: 'transfer', label: '振替' },
];
const MODE_NAME: Record<RecurringMode, string> = { expense: '固定支出', income: '固定収入', transfer: '振替' };

interface RecurringSettingsProps {
  familyId: string;
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  /** 開いたときに編集を開くルール（予算の画面の固定費から来たとき）。 */
  initialEditId?: string | null;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onBack: () => void;
  /**
   * スマホの戻るボタン。家計の設定の Modal が受けるので、編集を開いているあいだはここに戻り方を入れる
   * （編集の中の選ぶ画面 → 編集 → 一覧の順に戻る）。null なら家計の設定が一覧から入口へ戻す。
   */
  backRef: MutableRefObject<(() => void) | null>;
}

const HOLIDAYS: MoneyHolidayRule[] = ['next', 'prev', 'none'];
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const byPosition = (a: MoneyRecurring, b: MoneyRecurring) => a.position - b.position;

export default function RecurringSettings({
  familyId,
  recurring,
  wallets,
  categories,
  budgets,
  stores,
  records,
  onRecurring,
  initialEditId,
  onStores,
  onBack,
  backRef,
}: RecurringSettingsProps) {
  const [editing, setEditing] = useState<MoneyRecurring | 'new' | null>(
    () => recurring.find((rule) => rule.id === initialEditId) ?? null,
  );
  // 一覧に出す種類（支出／収入／振替）。予算の画面から開いたルールの種類で始める。新しく足すのもこの種類。
  const [tab, setTab] = useState<RecurringMode>(() => {
    const rule = recurring.find((entry) => entry.id === initialEditId);
    return rule ? modeOf(rule) : 'expense';
  });
  // 「複製して足す」の元。日・月・額など全部を写し、品名に「のコピー」を付けて新規の編集を開く。
  const [template, setTemplate] = useState<MoneyRecurring | null>(null);
  // 編集を閉じたら、戻る操作を家計の設定へ返す（開いているあいだは RecurringEditor が入れる）。
  useEffect(() => {
    if (editing === null) backRef.current = null;
  }, [editing, backRef]);
  const thisMonth = monthKeyOfDate(new Date());
  const inTab = recurring.filter((rule) => modeOf(rule) === tab);
  const usable = inTab.filter((rule) => !rule.archived && !recurringEnded(rule, thisMonth));
  const ended = inTab.filter((rule) => !rule.archived && recurringEnded(rule, thisMonth));
  const archived = inTab.filter((rule) => rule.archived);
  const [showEnded, setShowEnded] = useState(false);
  // 一覧の見出しごとのルール。支出は、固定（自動で記録する）・予定（記録しない）の順に分ける。
  const sections: { key: string; title: string | null; rules: MoneyRecurring[] }[] =
    tab === 'expense'
      ? [
          { key: 'fixed', title: '固定', rules: usable.filter((rule) => !isEstimateCost(rule)) },
          { key: 'estimate', title: '予定', rules: usable.filter(isEstimateCost) },
        ]
      : [{ key: tab, title: null, rules: usable }];

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');
  const put = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));

  // 指で動かしたあとの並び。同じ種類の中で数え直し、変わったものだけ保存する。
  const drag = useDragReorder((_sectionKey, orderedIds) => {
    const changes = reorderedPositions(recurring, orderedIds);
    if (changes.length === 0) return;
    onRecurring((prev) =>
      prev
        .map((rule) => {
          const hit = changes.find((change) => change.id === rule.id);
          return hit ? { ...rule, position: hit.position } : rule;
        })
        .sort(byPosition),
    );
    void Promise.all(changes.map((change) => updateMoneyRecurringPosition(supabase, change.id, change.position))).catch(() =>
      Alert.alert('並べ替えを保存できませんでした', 'もう一度お試しください。'),
    );
  });

  const save = async (target: MoneyRecurring | null, draft: MoneyRecurringDraft, registerStore: boolean) => {
    setEditing(null);
    setTemplate(null);
    try {
      put(
        target === null
          ? await insertMoneyRecurring(
              supabase,
              familyId,
              draft,
              recurring.reduce((max, rule) => Math.max(max, rule.position + 1), 0),
            )
          : await updateMoneyRecurring(supabase, target.id, draft),
      );
      // 「お店に登録して使う」を選んだお店は、お店の設定にも登録する（docs/kakei.md §3.5）。
      if (registerStore && draft.store !== '' && !stores.some((entry) => entry.name === draft.store && !entry.archived)) {
        const savedStore = await insertMoneyStore(supabase, familyId, draft.store);
        onStores((prev) => [...prev.filter((entry) => entry.id !== savedStore.id), savedStore]);
      }
    } catch {
      failed();
    }
  };

  // 使わなくした古い項目を「また使う」にするためだけに残している（新しく使わなくすることはできない。削除する）。
  const setArchived = async (rule: MoneyRecurring, value: boolean) => {
    setEditing(null);
    try {
      put(await setMoneyRecurringArchived(supabase, rule.id, value));
    } catch {
      failed();
    }
  };

  const remove = async (rule: MoneyRecurring) => {
    setEditing(null);
    try {
      await deleteMoneyRecurring(supabase, rule.id);
      onRecurring((prev) => prev.filter((entry) => entry.id !== rule.id));
    } catch {
      Alert.alert('削除できませんでした', 'もう一度お試しください。');
    }
  };

  const confirmRemove = (rule: MoneyRecurring) =>
    Alert.alert(`この${MODE_NAME[modeOf(rule)]}を削除しますか？`, 'これから先は作らなくなります。作った記録は残ります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => void remove(rule) },
    ]);

  if (editing !== null) {
    return (
      <RecurringEditor
        key={editing === 'new' ? 'new' : editing.id}
        mode={editing === 'new' ? (template ? modeOf(template) : tab) : modeOf(editing)}
        rule={editing === 'new' ? null : editing}
        template={editing === 'new' ? template : null}
        wallets={wallets}
        categories={categories}
        budgets={budgets}
        stores={stores}
        records={records}
        onClose={() => {
          setEditing(null);
          setTemplate(null);
        }}
        onSubmit={(draft, registerStore) => void save(editing === 'new' ? null : editing, draft, registerStore)}
        onDelete={editing === 'new' ? undefined : () => confirmRemove(editing)}
        onDuplicate={
          editing === 'new'
            ? undefined
            : (source) => {
                setTemplate(source);
                setEditing('new');
              }
        }
        backRef={backRef}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="固定支出・収入" icon="back" onClose={onBack} />
      <View accessibilityRole="tablist" style={styles.tabs}>
        {MODE_TABS.map(({ id: entry, label }) => {
          const selected = entry === tab;
          return (
            <Pressable
              key={entry}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => {
                setTab(entry);
                setShowEnded(false);
              }}
              style={styles.tab}
            >
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
              <View style={[styles.underline, selected && styles.underlineSelected]} />
            </Pressable>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={!drag.isActive}>
        {usable.length === 0 && <Text style={styles.empty}>まだありません</Text>}
        {sections.map((section) => {
          const inKind = section.rules;
          if (inKind.length === 0) return null;
          return (
            <View key={section.key} {...drag.panHandlers} style={styles.section}>
              {section.title !== null && <Text style={styles.sectionTitle}>{section.title}</Text>}
              {inKind.map((rule) => (
                <Pressable
                  key={rule.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${ruleTitle(rule, categories)}を編集`}
                  onPress={() => setEditing(rule)}
                  {...drag.measureProps(rule.id)}
                  style={[styles.row, drag.styleFor(rule.id), drag.isDragging(rule.id) && styles.lifted]}
                >
                  {inKind.length > 1 && (
                    <View
                      accessibilityLabel={`${ruleTitle(rule, categories)}を並べ替え`}
                      {...drag.gripProps(`rules-${section.key}`, inKind, rule.id)}
                      style={styles.grip}
                    >
                      <GripVertical size={18} color={colors.borderStrong} />
                    </View>
                  )}
                  <View style={styles.flex}>
                    <Text style={styles.name}>{ruleTitle(rule, categories)}</Text>
                    {ruleDetail(rule) !== '' && <Text style={styles.sub}>{ruleDetail(rule)}</Text>}
                    <Text style={styles.sub}>{scheduleWithPeriod(rule)}</Text>
                    <Text style={styles.sub}>
                      {isEstimateCost(rule)
                        ? amountLabel(rule)
                        : `${
                            rule.kind === 'transfer'
                              ? `${walletName(rule.walletId) || '?'} → ${walletName(rule.toWalletId) || '?'}`
                              : walletName(rule.walletId) || (rule.kind === 'income' ? '入金先なし' : '出金元なし')
                          }・${amountLabel(rule)}`}
                    </Text>
                  </View>
                  <Pencil size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>
          );
        })}
        <Pressable accessibilityRole="button" onPress={() => setEditing('new')} style={styles.add}>
          <Plus size={18} color={colors.money} />
          <Text style={styles.addText}>{`${MODE_NAME[tab]}を足す`}</Text>
        </Pressable>

        {ended.length > 0 && (
          <View style={styles.section}>
            <Pressable accessibilityRole="button" onPress={() => setShowEnded((value) => !value)} hitSlop={8}>
              <Text style={styles.sectionTitle}>
                {`期間が終わったもの ${ended.length}件`}
              </Text>
            </Pressable>
            {showEnded &&
              ended.map((rule) => (
                <Pressable
                  key={rule.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${ruleTitle(rule, categories)}を編集`}
                  onPress={() => setEditing(rule)}
                  style={[styles.row, styles.archivedRow]}
                >
                  <View style={styles.flex}>
                    <Text style={styles.name}>{ruleTitle(rule, categories)}</Text>
                    {ruleDetail(rule) !== '' && <Text style={styles.sub}>{ruleDetail(rule)}</Text>}
                    <Text style={styles.sub}>{scheduleWithPeriod(rule)}</Text>
                  </View>
                  <Pencil size={16} color={colors.textFaint} />
                </Pressable>
              ))}
          </View>
        )}

        {archived.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>使わないもの</Text>
            {archived.map((rule) => (
              <View key={rule.id} style={[styles.row, styles.archivedRow]}>
                <Text style={[styles.name, styles.flex]}>
                  {ruleTitle(rule, categories)}
                  {ruleDetail(rule) !== '' ? `（${ruleDetail(rule)}）` : ''}
                </Text>
                <Pressable accessibilityRole="button" onPress={() => void setArchived(rule, false)} hitSlop={8}>
                  <Text style={styles.link}>また使う</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => confirmRemove(rule)} hitSlop={8}>
                  <Text style={styles.deleteLink}>削除</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** 額の言い方。収入は「見込み額」、支出は「過去の記録から見込む」。 */
function amountLabel(rule: MoneyRecurring): string {
  if (isEstimateCost(rule)) {
    if (rule.amountMode === 'fixed') return `予定 ${formatYen(rule.amount)}`;
    return rule.amount > 0 ? `前回の実績から見込む（無ければ ${formatYen(rule.amount)}）` : '前回の実績から見込む';
  }
  if (rule.amountMode === 'fixed') return `固定 ${formatYen(rule.amount)}`;
  if (rule.kind === 'income') return rule.amount > 0 ? `見込み額 ${formatYen(rule.amount)}` : '見込み額は過去の記録から';
  return '過去の記録から見込む';
}

/** ルールの見出し。カテゴリに統一する。振替などカテゴリのないものは取引の種別。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const path = rule.categoryId !== null ? categoryPath(categories, rule.categoryId) : '';
  return path !== '' ? path : RECORD_KIND_LABEL[rule.kind];
}

/** 日取りと期間。「毎月25日（休日は前営業日）・2027/9〜」。記録しない予定は日を持たないので月だけ（「3・9月・2027/3〜2027/3」）。 */
function scheduleWithPeriod(rule: MoneyRecurring): string {
  const period = recurringPeriodLabel(rule);
  const schedule = isEstimateCost(rule)
    ? rule.months === null
      ? '毎月'
      : `${[...rule.months].sort((a, b) => a - b).join('・')}月`
    : recurringScheduleLabel(rule);
  return period === '' ? schedule : `${schedule}・${period}`;
}

/** お店（相手先）と品名。見出しの下に添える（どちらも無ければ空）。 */
function ruleDetail(rule: MoneyRecurring): string {
  return [rule.store, rule.name]
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .join('・');
}

/** 複製の品名。品名があれば「◯◯のコピー」、無ければカテゴリ（見出し）に「のコピー」を付ける。 */
function copyName(source: MoneyRecurring, categories: MoneyCategory[]): string {
  const name = source.name.trim();
  return `${name !== '' ? name : ruleTitle(source, categories)}のコピー`;
}

type EditorScreen = 'form' | 'category' | 'store';

function RecurringEditor({
  mode,
  rule,
  template,
  wallets,
  categories,
  budgets,
  stores,
  records,
  onClose,
  onSubmit,
  onDelete,
  onDuplicate,
  backRef,
}: {
  mode: RecurringMode;
  rule: MoneyRecurring | null;
  /** 「複製して足す」の元（全部を写す）。 */
  template: MoneyRecurring | null;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onClose: () => void;
  onSubmit: (draft: MoneyRecurringDraft, registerStore: boolean) => void;
  onDelete?: () => void;
  /** 全部を写した新しい項目を足す（日・月・額もそのまま）。 */
  onDuplicate?: (source: MoneyRecurring) => void;
  backRef: MutableRefObject<(() => void) | null>;
}) {
  const isIncome = mode === 'income';
  const base = rule ?? template;
  const [screen, setScreen] = useState<EditorScreen>('form');
  useEffect(() => {
    backRef.current = () => (screen === 'form' ? onClose() : setScreen('form'));
  });
  // 種類（支出・収入・振替）は、一覧の切り替えで決まる（編集では変えない）。
  const kind: MoneyRecordKind = base?.kind ?? mode;
  const [categoryId, setCategoryId] = useState<string | null>(base?.categoryId ?? null);
  const [walletId, setWalletId] = useState<string | null>(base?.walletId ?? null);
  const [toWalletId, setToWalletId] = useState<string | null>(base?.toWalletId ?? null);
  const [store, setStore] = useState(base?.store ?? '');
  // お店の選択で「お店に登録して使う」を選んだか（保存のときにお店の設定に登録する）。
  const [registerStore, setRegisterStore] = useState(false);
  const [name, setName] = useState(rule ? rule.name : template ? copyName(template, categories) : '');
  const [day, setDay] = useState(rule ? String(rule.day) : template ? String(template.day) : '');
  // 振込日を「第◯◯曜日」で決めるか（賞与など。固定収入だけ）。
  const [byWeekday, setByWeekday] = useState(base?.weekOfMonth != null);
  const [weekOfMonth, setWeekOfMonth] = useState<number | null>(base?.weekOfMonth ?? null);
  const [weekday, setWeekday] = useState<number | null>(base?.weekday ?? null);
  // 給与は休日の前の営業日に振り込まれることが多い。
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(base?.holiday ?? (isIncome ? 'prev' : 'next'));
  const [months, setMonths] = useState<number[] | null>((rule ?? template)?.months ?? null);
  // 期間（2027/9 の形で入れる。空は無期限）。
  const [startInput, setStartInput] = useState(periodMonthInput(base?.startMonth ?? null));
  const [endInput, setEndInput] = useState(periodMonthInput(base?.endMonth ?? null));
  const [amountMode, setAmountMode] = useState<MoneyRecurring['amountMode']>(base?.amountMode ?? 'estimate');
  // 記録を作るか（false は記録しない予定。固定支出の支出だけ）。
  const [makesRecord, setMakesRecord] = useState(base ? !isEstimateCost(base) : true);
  const estimate = !isIncome && kind === 'expense' && !makesRecord;
  const [amount, setAmount] = useState(base && base.amount > 0 ? String(base.amount) : '');
  const [error, setError] = useState<string | null>(null);

  // 固定収入の入金先は銀行の口座だけ（いま選んでいるものは、銀行でなくても残す）。
  const usableWallets = wallets.filter(
    (wallet) =>
      (!wallet.archived || wallet.id === walletId || wallet.id === toWalletId) &&
      (!isIncome || wallet.type === 'bank' || wallet.id === walletId),
  );
  const storeOptions = useMemo(() => storeChoices(stores, records), [stores, records]);
  const today = toDateString(new Date());
  const startForHistory = parsePeriodMonth(startInput) ?? null;
  const history = useMemo(
    () =>
      recurringHistory(
        { id: rule?.id, kind, walletId, toWalletId, store, categoryId, startMonth: startForHistory },
        records,
        today,
      ),
    [rule?.id, kind, walletId, toWalletId, store, categoryId, startForHistory, records, today],
  );
  const target = categoryId !== null ? categoryPath(categories, categoryId) : '';
  // 記録しない予定の「前回の実績」（次の回＝今年の最初の予定の月で見る）。
  const plannedMonth = `${today.slice(0, 4)}-${String(months?.[0] ?? Number(today.slice(5, 7))).padStart(2, '0')}`;
  const basis = useMemo(
    () => (estimate && categoryId !== null ? estimateCostBasis(categoryId, records, plannedMonth) : null),
    [estimate, categoryId, records, plannedMonth],
  );
  const basisMonth = basis === null ? null : Number(basis.monthKey.slice(5, 7));

  const toggleMonth = (month: number) => {
    const current = months ?? [];
    const next = current.includes(month) ? current.filter((entry) => entry !== month) : [...current, month];
    setMonths(next.sort((a, b) => a - b));
  };

  const submit = () => {
    // 「第◯◯曜日」のときは day を使わない（1 を入れておく）。記録しない予定は日を持たない（1）。
    let dayValue = 1;
    if (estimate) {
      // 日・出金元は決めない。
    } else if (byWeekday) {
      if (weekOfMonth === null || weekday === null) return setError('第何週の何曜日かを選んでください');
    } else {
      dayValue = Number(day.trim());
      if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) return setError(`${isIncome ? '振込日' : '引き落とし日'}を 1〜31 で入れてください（末日は31）`);
    }
    if (!estimate && walletId === null) return setError(kind === 'income' ? '入金先を選んでください' : '出金元を選んでください');
    if (kind === 'transfer' && (toWalletId === null || toWalletId === walletId)) return setError('入金先を選んでください（出金元と別の口座）');
    if (kind !== 'transfer' && categoryId === null) return setError('カテゴリを選んでください');
    if (months !== null && months.length === 0) return setError('記録する月を選んでください');
    const startMonth = parsePeriodMonth(startInput);
    const endMonth = parsePeriodMonth(endInput);
    if (startMonth === undefined || endMonth === undefined) return setError('期間は「2027/9」の形で入れてください（無期限は空）');
    if (startMonth !== null && endMonth !== null && startMonth > endMonth) return setError('期間の終わりを始まりより後にしてください');
    const amountValue = amount.trim() === '' ? 0 : Number(amount.trim());
    if (!Number.isInteger(amountValue) || amountValue < 0) return setError('額は0以上の整数で入れてください');
    if (amountMode === 'fixed' && amountValue === 0) return setError(estimate ? '予定の額を入れてください' : '固定額を入れてください');
    onSubmit({
      kind,
      day: dayValue,
      weekOfMonth: !estimate && byWeekday ? weekOfMonth : null,
      weekday: !estimate && byWeekday ? weekday : null,
      months,
      startMonth,
      endMonth,
      holiday: estimate ? 'next' : holiday,
      amountMode,
      amount: amountValue,
      walletId: estimate ? null : walletId,
      toWalletId: kind === 'transfer' ? toWalletId : null,
      store: kind === 'transfer' || estimate ? '' : store,
      categoryId: kind === 'transfer' ? null : categoryId,
      name,
      makesRecord: !estimate,
      skippedMonths: rule?.skippedMonths ?? [],
    }, kind !== 'transfer' && !estimate && store !== '' && registerStore);
  };

  if (screen === 'category') {
    return (
      <CategoryPicker
        kind={kind === 'income' ? 'income' : 'expense'}
        monthKey={monthKeyOfDate(new Date())}
        categories={categories}
        budgets={budgets}
        records={records}
        onPick={(choice) => {
          setCategoryId(choice.categoryId);
          setScreen('form');
        }}
        onClose={() => setScreen('form')}
      />
    );
  }
  if (screen === 'store') {
    return (
      <StorePicker
        value={store}
        registered={storeOptions.registered}
        recent={storeOptions.recent}
        others={storeOptions.others}
        canRegister
        onPick={(value, register) => {
          setStore(value);
          setRegisterStore(register);
          setScreen('form');
        }}
        onClose={() => setScreen('form')}
      />
    );
  }

  const walletChips = (selected: string | null, onPick: (id: string) => void, exclude: string | null) => (
    <View style={styles.chips}>
      {usableWallets
        .filter((wallet) => wallet.id !== exclude)
        .map((wallet) => (
          <Chip key={wallet.id} label={wallet.name} selected={selected === wallet.id} onPress={() => onPick(wallet.id)} />
        ))}
      {usableWallets.length === 0 && (
        <Text style={styles.sub}>{isIncome ? '銀行の口座を先に足してください' : '出金元を先に足してください'}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={`${MODE_NAME[mode]}を${rule ? '編集' : template ? '複製して足す' : '足す'}`}
        icon="back"
        onClose={onClose}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!isIncome && kind === 'expense' && (
          <View style={styles.field}>
            <Text style={styles.label}>種類</Text>
            <View style={styles.chips}>
              <Chip label="固定" selected={makesRecord} onPress={() => setMakesRecord(true)} />
              <Chip
                label="予定"
                selected={!makesRecord}
                onPress={() => {
                  setMakesRecord(false);
                  // 新しく足すときは、まず入れた額で（前回の実績が無いと予定の額が 0 になるため）。
                  if (rule === null && template === null) setAmountMode('fixed');
                }}
              />
            </View>
          </View>
        )}

        {kind !== 'transfer' && (
          <Pressable accessibilityRole="button" onPress={() => setScreen('category')} style={styles.pick}>
            <Text style={styles.label}>カテゴリ</Text>
            <Text style={[styles.pickText, target === '' && styles.placeholder]}>{target || '選ぶ'}</Text>
            <ChevronRight size={18} color={colors.textFaint} />
          </Pressable>
        )}

        {!estimate && (
          <View style={styles.field}>
            <Text style={styles.label}>{kind === 'income' ? '入金先' : '出金元'}</Text>
            {walletChips(walletId, setWalletId, null)}
          </View>
        )}
        {kind === 'transfer' ? (
          <View style={styles.field}>
            <Text style={styles.label}>入金先</Text>
            {walletChips(toWalletId, setToWalletId, walletId)}
          </View>
        ) : (
          !estimate && (
            <Pressable accessibilityRole="button" onPress={() => setScreen('store')} style={styles.pick}>
              <Text style={styles.label}>お店（相手先）</Text>
              <Text style={[styles.pickText, store === '' && styles.placeholder]}>{store || '選ぶ'}</Text>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>
          )
        )}

        <View style={styles.field}>
          <Text style={styles.label}>品名（任意）</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={isIncome ? '例: 賞与（6月）' : estimate ? '例: 車検' : '例: 電気代'}
            placeholderTextColor={colors.textFaint}
          />
        </View>

        {isIncome && (
          <View style={styles.field}>
            <Text style={styles.label}>日の決め方</Text>
            <View style={styles.chips}>
              <Chip label="日にち" selected={!byWeekday} onPress={() => setByWeekday(false)} />
              <Chip label="第◯◯曜日" selected={byWeekday} onPress={() => setByWeekday(true)} />
            </View>
          </View>
        )}
        {estimate ? null : byWeekday ? (
          <View style={styles.field}>
            <Text style={styles.label}>振込日</Text>
            <View style={styles.chips}>
              {WEEK_OF_MONTH_OPTIONS.map((option) => (
                <Chip key={option.value} label={option.label} selected={weekOfMonth === option.value} onPress={() => setWeekOfMonth(option.value)} />
              ))}
            </View>
            <View style={styles.chips}>
              {WEEKDAY_LABELS.map((label, index) => (
                <Chip key={label} label={`${label}曜日`} selected={weekday === index} onPress={() => setWeekday(index)} />
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.field}>
            <Text style={styles.label}>{isIncome ? '振込日' : '引き落とし日（入る日）'}</Text>
            <TextInput
              style={styles.input}
              value={day}
              onChangeText={setDay}
              keyboardType="number-pad"
              placeholder="例: 27（末日は31）"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        )}
        {!estimate && (
        <View style={styles.field}>
          <Text style={styles.label}>休日のとき</Text>
          <View style={styles.chips}>
            {HOLIDAYS.map((entry) => (
              <Chip key={entry} label={HOLIDAY_RULE_LABEL[entry]} selected={holiday === entry} onPress={() => setHoliday(entry)} />
            ))}
          </View>
        </View>
        )}
        <View style={styles.field}>
          <Text style={styles.label}>{estimate ? '予定の月' : '記録する月'}</Text>
          <View style={styles.chips}>
            <Chip label="毎月" selected={months === null} onPress={() => setMonths(null)} />
            <Chip label="月を選ぶ" selected={months !== null} onPress={() => setMonths(months ?? [])} />
          </View>
          {months !== null && (
            <View style={styles.chips}>
              {MONTHS.map((month) => (
                <Chip key={month} label={`${month}月`} selected={months.includes(month)} onPress={() => toggleMonth(month)} />
              ))}
            </View>
          )}
          {estimate && basisMonth !== null && months !== null && months.length === 1 && months[0] !== basisMonth && (
            <View style={styles.chips}>
              <Text style={styles.sub}>{`前回は${basisMonth}月でした`}</Text>
              <Chip label={`${basisMonth}月にする`} selected={false} onPress={() => setMonths([basisMonth])} />
            </View>
          )}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>期間（任意）</Text>
          <View style={styles.periodRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={startInput}
              onChangeText={setStartInput}
              placeholder="始まり 例: 2027/9"
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.periodDash}>〜</Text>
            <TextInput
              style={[styles.input, styles.flex]}
              value={endInput}
              onChangeText={setEndInput}
              placeholder="終わり 例: 2027/8"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        </View>

        {estimate ? (
          <View style={styles.field}>
            <Text style={styles.label}>額の決め方</Text>
            <View style={styles.chips}>
              <Chip label="入れた額" selected={amountMode === 'fixed'} onPress={() => setAmountMode('fixed')} />
              <Chip label="前回の実績から見込む" selected={amountMode === 'estimate'} onPress={() => setAmountMode('estimate')} />
            </View>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              placeholder={amountMode === 'fixed' ? '額（円）' : '前回の実績が無いときの額（円・任意）'}
              placeholderTextColor={colors.textFaint}
            />
            {categoryId !== null && (
              <Text style={styles.sub}>
                {basis === null
                  ? 'この小分類の前回の実績はまだありません'
                  : `前回の実績 ${formatYen(basis.amount)}（${periodMonthInput(basis.monthKey)}）`}
              </Text>
            )}
          </View>
        ) : (
        <View style={styles.field}>
          <Text style={styles.label}>{isIncome ? '見込み額' : '額の決め方'}</Text>
          <View style={styles.chips}>
            <Chip label={isIncome ? '見込み額' : '過去の記録から見込む'} selected={amountMode === 'estimate'} onPress={() => setAmountMode('estimate')} />
            <Chip label="固定額" selected={amountMode === 'fixed'} onPress={() => setAmountMode('fixed')} />
          </View>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder={amountMode === 'fixed' ? '額（円）' : isIncome ? '見込み額（円）' : '過去の記録が無いときの額（円・任意）'}
            placeholderTextColor={colors.textFaint}
          />
          {amountMode === 'estimate' && (
            <Text style={styles.sub}>
              {history.length === 0
                ? '過去1年に、カテゴリ・出金元・お店が同じ記録はまだありません'
                : `過去1年の記録 ${history.length}件（直近 ${formatShortDate(history[0].occurredOn)} ${formatYen(history[0].amount)}）`}
            </Text>
          )}
        </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="保存する" onPress={submit} />
        {rule && onDuplicate && (
          <Pressable accessibilityRole="button" onPress={() => onDuplicate(rule)} style={styles.secondary}>
            <Text style={styles.similarText}>複製して足す</Text>
          </Pressable>
        )}
        {onDelete && (
          <Pressable accessibilityRole="button" onPress={onDelete} style={styles.secondary}>
            <Text style={styles.deleteText}>削除</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  archivedRow: { opacity: 0.7 },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  periodDash: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  grip: { width: 28, alignSelf: 'stretch', marginLeft: -8, marginVertical: -4, alignItems: 'center', justifyContent: 'center' },
  lifted: { opacity: 0.9, elevation: 8, backgroundColor: colors.surface },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  tabs: { flexDirection: 'row', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingTop: 8, alignItems: 'center' },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.textFaint },
  tabTextSelected: { color: colors.text, fontWeight: '700' },
  underline: { marginTop: 8, height: 3, width: 32, borderRadius: 2, backgroundColor: 'transparent' },
  underlineSelected: { backgroundColor: colors.money },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  link: { fontSize: 13, fontWeight: '700', color: colors.money },
  deleteLink: { fontSize: 13, fontWeight: '700', color: colors.danger },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text, textAlign: 'right' },
  placeholder: { color: colors.textFaint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.neutralSurface },
  chipSelected: { backgroundColor: colors.moneySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  chipTextSelected: { color: colors.moneyText },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
  similarText: { fontSize: 13, fontWeight: '700', color: colors.money },
});
