import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  recurringMonthsLabel,
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
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
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
// 固定収入（給与・賞与。2026-10-11。docs/kakei.md §0.3）・振替も同じルールで、同じ画面「固定費」の上の切り替え（支出／収入／振替。タップと、帯と一覧の上の左右スワイプ）で出す
// （2026-10-18に統合）。収入のルールの編集は、入金先・振込日・見込み額の言葉にする。賞与は1回ごとに1件のルール（月・日・額）で、「複製して足す」で回を増やす。
// 種類は「確定」（額が決まっている。確定の記録を作る）と「見込み」（額が変わる。過去の記録から見込み、実額に直すと確定）の2つ（2026-10-21）。
// 収入も同じ（児童手当は確定、給与・賞与は見込み）。振替はほぼ毎月額を変えるので、いつも見込みの記録を作る（DB は migration 0125）。
//
// 並べ替え（左の持ち手をつかんで動かす。リストと同じ操作）は、見出し（自動で記録・帯に出す）ごとの中で動かせる。
// 複製は、編集の画面の「複製して足す」から。日・月・額など全部を写し、品名に「のコピー」を付けた新規の編集を開き、直して保存すると足される。
//
// 期間（開始月・終了月。2026-10-15）: 育休給付金 〜2027/8、時短後の給与 2027/9〜 のように、期間の外の月は記録も予算も作らない。
// 期間が終わったルールは、一覧の下に畳んで出す（押すと開く）。
//
// 帯に出す（2026-10-17、2026-10-21に見直し。docs/kakei.md §3.6）: 車検・JAF・自治会費のように、出ることは決まっているが、カードや現金で
// 払うもの・日が決まらないもの。編集の「記録の作り方」で「帯に出す」を選ぶ。記録は作らず、その日になったら記録の上の帯に出し、確かめて記録する。
// 日が決まらないものは「日付未定」にし、帯には出さない。どちらも、同じ小分類の記録が入ると済になる（自動で結びつく）。
// 見込みの額は、その小分類で前回入った実績（無ければ入れた額）。一覧では支出の「自動で記録」のあと、「帯に出す」の見出しの下にまとめる。
//
// ◯年ごと（2026-10-21）: 車検・2年ごとの火災保険は、記録する月で「◯年ごと」を選び、間隔と期間の始まり（最初の回）を入れる。

type RecurringMode = 'expense' | 'income' | 'transfer';

/** 一覧の切り替え。'expense'＝固定支出（固定・予定）、'income'＝固定収入（給与・賞与）、'transfer'＝振替。 */
const modeOf = (rule: MoneyRecurring): RecurringMode => rule.kind;

const MODE_TABS: { id: RecurringMode; label: string }[] = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '収入' },
  { id: 'transfer', label: '振替' },
];
// 振替はほぼ毎月額が変わるので、いつも見込みとして記録を作る（docs/kakei.md §3.3）。
const MODE_NAME: Record<RecurringMode, string> = { expense: '固定支出', income: '固定収入', transfer: '振替の見込み' };

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
  // 一覧の見出しごとのルール。支出は、自動で記録・帯に出す（記録しない）の順に分ける。
  const sections: { key: string; title: string | null; rules: MoneyRecurring[] }[] =
    tab === 'expense'
      ? [
          { key: 'fixed', title: '自動で記録', rules: usable.filter((rule) => !isEstimateCost(rule)) },
          { key: 'estimate', title: '帯に出す', rules: usable.filter(isEstimateCost) },
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
  // 支出／収入／振替は、帯と一覧の上の左右スワイプでも切り替える（並べ替えの最中は止める）。
  const swipe = useSwipeTabs(
    MODE_TABS.map((entry) => entry.id),
    tab,
    (next) => {
      setTab(next);
      setShowEnded(false);
    },
    !drag.isActive,
  );

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
      <ScreenHeader title="固定費（支出、収入、振替）" icon="back" onClose={onBack} />
      <View style={styles.flex} {...swipe.handlers}>
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
      <Animated.ScrollView style={swipe.style} contentContainerStyle={styles.content} scrollEnabled={!drag.isActive}>
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
                      {isEstimateCost(rule) && rule.walletId === null
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
      </Animated.ScrollView>
      </View>
    </View>
  );
}

/** 額の言い方。「確定 ¥55,000」「見込み 過去の記録から（無ければ ¥23,000）」。振替は入れた額でも見込み。 */
function amountLabel(rule: MoneyRecurring): string {
  if (rule.amountMode === 'fixed') return `${rule.kind === 'transfer' ? '見込み' : '確定'} ${formatYen(rule.amount)}`;
  const source = isEstimateCost(rule) ? '前回の実績から' : '過去の記録から';
  return rule.amount > 0 ? `見込み ${source}（無ければ ${formatYen(rule.amount)}）` : `見込み ${source}`;
}

/** ルールの見出し。カテゴリに統一する。振替などカテゴリのないものは取引の種別。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const path = rule.categoryId !== null ? categoryPath(categories, rule.categoryId) : '';
  return path !== '' ? path : RECORD_KIND_LABEL[rule.kind];
}

/** 日取りと期間。「毎月25日（休日は前営業日）・2027/9〜」。日付未定のものは月だけ（「11月・日付未定」）。 */
function scheduleWithPeriod(rule: MoneyRecurring): string {
  const period = recurringPeriodLabel(rule);
  const schedule = isEstimateCost(rule) && !rule.dayKnown ? `${recurringMonthsLabel(rule)}・日付未定` : recurringScheduleLabel(rule);
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
  // ◯年ごと（車検など。間隔は2〜10年。期間の始まりの年から数える）。空は毎年。
  const [intervalInput, setIntervalInput] = useState(base?.intervalYears != null ? String(base.intervalYears) : '');
  const [byInterval, setByInterval] = useState(base?.intervalYears != null);
  // 期間（2027/9 の形で入れる。空は無期限）。
  const [startInput, setStartInput] = useState(periodMonthInput(base?.startMonth ?? null));
  const [endInput, setEndInput] = useState(periodMonthInput(base?.endMonth ?? null));
  // 種類。確定（fixed）は確定の記録、見込み（estimate）は過去の記録から見込んだ見込みの記録（振替はいつも見込み）。
  const [amountMode, setAmountMode] = useState<MoneyRecurring['amountMode']>(base?.amountMode ?? 'estimate');
  // 記録の作り方。false は帯に出す（自動で記録しない。固定支出の支出だけ）。
  const [makesRecord, setMakesRecord] = useState(base ? !isEstimateCost(base) : true);
  const estimate = !isIncome && kind === 'expense' && !makesRecord;
  // 日が決まっているか（帯に出すものだけ「日付未定」にできる。帯には出さない）。
  const [dayKnown, setDayKnown] = useState(base?.dayKnown ?? true);
  const noDay = estimate && !dayKnown;
  const [amount, setAmount] = useState(base && base.amount > 0 ? String(base.amount) : '');
  const [error, setError] = useState<string | null>(null);

  // 固定収入の入金先は銀行の口座だけ（いま選んでいるものは、銀行でなくても残す）。
  const usableWallets = wallets.filter(
    (wallet) =>
      (!wallet.archived || wallet.id === walletId || wallet.id === toWalletId) &&
      (!isIncome || wallet.type === 'bank' || wallet.id === walletId),
  );
  const storeOptions = useMemo(() => storeChoices(stores, records, toDateString(new Date())), [stores, records]);
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
    // 「第◯◯曜日」のときは day を使わない（1 を入れておく）。日付未定も 1。
    let dayValue = 1;
    if (noDay) {
      // 日は決めない。
    } else if (byWeekday) {
      if (weekOfMonth === null || weekday === null) return setError('第何週の何曜日かを選んでください');
    } else {
      dayValue = Number(day.trim());
      if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) return setError(`${isIncome ? '振込日' : '引き落とし日'}を 1〜31 で入れてください（末日は31）`);
    }
    // 帯に出すものは、出金元を決めなくてよい（記録するときに選ぶ）。
    if (!estimate && walletId === null) return setError(kind === 'income' ? '入金先を選んでください' : '出金元を選んでください');
    if (kind === 'transfer' && (toWalletId === null || toWalletId === walletId)) return setError('入金先を選んでください（出金元と別の口座）');
    if (kind !== 'transfer' && categoryId === null) return setError('カテゴリを選んでください');
    if (months !== null && months.length === 0) return setError('記録する月を選んでください');
    const startMonth = parsePeriodMonth(startInput);
    const endMonth = parsePeriodMonth(endInput);
    if (startMonth === undefined || endMonth === undefined) return setError('期間は「2027/9」の形で入れてください（無期限は空）');
    if (startMonth !== null && endMonth !== null && startMonth > endMonth) return setError('期間の終わりを始まりより後にしてください');
    const intervalYears = byInterval ? Number(intervalInput.trim()) : null;
    if (intervalYears !== null) {
      if (!Number.isInteger(intervalYears) || intervalYears < 2 || intervalYears > 10) return setError('何年ごとかを 2〜10 で入れてください');
      if (months === null) return setError('◯年ごとは、記録する月を選んでください');
      if (startMonth === null) return setError('◯年ごとは、期間の始まり（最初の回の月）を入れてください');
    }
    const amountValue = amount.trim() === '' ? 0 : Number(amount.trim());
    if (!Number.isInteger(amountValue) || amountValue < 0) return setError('額は0以上の整数で入れてください');
    if (amountMode === 'fixed' && amountValue === 0) return setError(kind === 'transfer' ? '見込みの額を入れてください' : '確定の額を入れてください');
    onSubmit({
      kind,
      day: dayValue,
      weekOfMonth: !noDay && byWeekday ? weekOfMonth : null,
      weekday: !noDay && byWeekday ? weekday : null,
      months,
      startMonth,
      endMonth,
      holiday: noDay ? 'next' : holiday,
      amountMode,
      amount: amountValue,
      walletId,
      toWalletId: kind === 'transfer' ? toWalletId : null,
      store: kind === 'transfer' ? '' : store,
      categoryId: kind === 'transfer' ? null : categoryId,
      name,
      makesRecord: !estimate,
      skippedMonths: rule?.skippedMonths ?? [],
      intervalYears,
      dayKnown: !noDay,
    }, kind !== 'transfer' && store !== '' && registerStore);
  };

  if (screen === 'category') {
    return (
      <CategoryPicker
        kind={kind === 'income' ? 'income' : 'expense'}
        categories={categories}
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
        {kind !== 'transfer' && (
          <View style={styles.field}>
            <Text style={styles.label}>種類</Text>
            <View style={styles.chips}>
              <Chip label="確定" selected={amountMode === 'fixed'} onPress={() => setAmountMode('fixed')} />
              <Chip label="見込み" selected={amountMode === 'estimate'} onPress={() => setAmountMode('estimate')} />
            </View>
          </View>
        )}
        {kind === 'expense' && (
          <View style={styles.field}>
            <Text style={styles.label}>記録の作り方</Text>
            <View style={styles.chips}>
              <Chip label="自動で記録する" selected={makesRecord} onPress={() => setMakesRecord(true)} />
              <Chip label="帯に出す" selected={!makesRecord} onPress={() => setMakesRecord(false)} />
            </View>
            {!makesRecord && <Text style={styles.sub}>記録は作らず、その日に記録の上の帯に出します。同じ小分類の記録が入ると済になります</Text>}
          </View>
        )}

        {kind !== 'transfer' && (
          <Pressable accessibilityRole="button" onPress={() => setScreen('category')} style={styles.pick}>
            <Text style={styles.label}>カテゴリ</Text>
            <Text style={[styles.pickText, target === '' && styles.placeholder]}>{target || '選ぶ'}</Text>
            <ChevronRight size={18} color={colors.textFaint} />
          </Pressable>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>{kind === 'income' ? '入金先' : estimate ? '出金元（任意）' : '出金元'}</Text>
          {walletChips(walletId, (id) => setWalletId(estimate && id === walletId ? null : id), null)}
        </View>
        {kind === 'transfer' ? (
          <View style={styles.field}>
            <Text style={styles.label}>入金先</Text>
            {walletChips(toWalletId, setToWalletId, walletId)}
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setScreen('store')} style={styles.pick}>
            <Text style={styles.label}>お店（相手先）</Text>
            <Text style={[styles.pickText, store === '' && styles.placeholder]}>{store || '選ぶ'}</Text>
            <ChevronRight size={18} color={colors.textFaint} />
          </Pressable>
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
        {estimate && (
          <View style={styles.field}>
            <Text style={styles.label}>日</Text>
            <View style={styles.chips}>
              <Chip label="日を決める" selected={dayKnown} onPress={() => setDayKnown(true)} />
              <Chip label="日付未定" selected={!dayKnown} onPress={() => setDayKnown(false)} />
            </View>
            {!dayKnown && <Text style={styles.sub}>帯には出しません。同じ小分類の記録が入るのを待ちます</Text>}
          </View>
        )}
        {noDay ? null : byWeekday ? (
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
            <Text style={styles.label}>{isIncome ? '振込日' : estimate ? '帯に出す日（払う日の目安）' : '引き落とし日（入る日）'}</Text>
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
        {!noDay && (
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
          <Text style={styles.label}>記録する月</Text>
          <View style={styles.chips}>
            <Chip
              label="毎月"
              selected={months === null}
              onPress={() => {
                setMonths(null);
                setByInterval(false);
              }}
            />
            <Chip
              label="毎年（月を選ぶ）"
              selected={months !== null && !byInterval}
              onPress={() => {
                setMonths(months ?? []);
                setByInterval(false);
              }}
            />
            <Chip
              label="◯年ごと"
              selected={byInterval}
              onPress={() => {
                setMonths(months ?? []);
                setByInterval(true);
              }}
            />
          </View>
          {byInterval && (
            <View style={styles.periodRow}>
              <TextInput
                style={[styles.input, styles.intervalInput]}
                value={intervalInput}
                onChangeText={setIntervalInput}
                keyboardType="number-pad"
                placeholder="2"
                placeholderTextColor={colors.textFaint}
              />
              <Text style={styles.periodDash}>年ごと（期間の始まりの年から数える）</Text>
            </View>
          )}
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
          <Text style={styles.label}>{byInterval ? '期間（始まり＝最初の回）' : '期間（任意）'}</Text>
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
            <Text style={styles.label}>{amountMode === 'fixed' ? '額' : '見込みの額'}</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              placeholder={amountMode === 'fixed' ? '額（円）' : '前回の実績が無いときの額（円・任意）'}
              placeholderTextColor={colors.textFaint}
            />
            {amountMode === 'estimate' && categoryId !== null && (
              <Text style={styles.sub}>
                {basis === null
                  ? 'この小分類の前回の実績はまだありません'
                  : `前回の実績 ${formatYen(basis.amount)}（${periodMonthInput(basis.monthKey)}）`}
              </Text>
            )}
          </View>
        ) : (
        <View style={styles.field}>
          <Text style={styles.label}>{kind === 'transfer' ? '額の決め方' : amountMode === 'fixed' ? '額' : '見込みの額'}</Text>
          {kind === 'transfer' && (
            <View style={styles.chips}>
              <Chip label="過去の記録から" selected={amountMode === 'estimate'} onPress={() => setAmountMode('estimate')} />
              <Chip label="入れた額" selected={amountMode === 'fixed'} onPress={() => setAmountMode('fixed')} />
            </View>
          )}
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder={amountMode === 'fixed' ? '額（円）' : '過去の記録が無いときの額（円・任意）'}
            placeholderTextColor={colors.textFaint}
          />
          {amountMode === 'estimate' && (
            <Text style={styles.sub}>
              {history.length === 0
                ? '過去1年に、カテゴリ・出金元・お店が同じ記録はまだありません'
                : `過去1年の記録 ${history.length}件（直近 ${formatShortDate(history[0].occurredOn)} ${formatYen(history[0].amount)}）`}
            </Text>
          )}
          {(kind === 'transfer' || amountMode === 'estimate') && (
            <Text style={styles.sub}>{kind === 'income' ? '振込日' : kind === 'transfer' ? '振替の日' : '引き落とし日'}に見込みの記録を作ります。実額に直すと確定します</Text>
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
  intervalInput: { width: 64, textAlign: 'right' },
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
