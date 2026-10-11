import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react-native';
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
import { toDateString } from '@/lib/dateUtils';
import {
  cardScheduleLabel,
  categoryPath,
  formatShortDate,
  formatYear,
  formatYen,
  HOLIDAY_RULE_LABEL,
  incomeRecordsInYear,
  monthKeyOfDate,
  RECORD_KIND_LABEL,
  recordTotal,
  recurringHistory,
  recurringScheduleLabel,
  storeChoices,
} from '@/lib/moneyUtils';
import { insertMoneyRecurring, insertMoneyStore, setMoneyRecurringArchived, updateMoneyRecurring } from '@/lib/api/money';
import CategoryPicker from '@/components/money/CategoryPicker';
import StorePicker from '@/components/money/StorePicker';
import { EstimateBadge, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 毎月の記録の設定（docs/kakei.md §3.3・§3.4・§3.5）。PWA版の `src/components/sukusuku/money/RecurringSettings.tsx` と同じ並び・文言。
//
// 口座から落ちる固定費・口座に入る給料などを、項目ごとのルールにする。サーバーが毎朝、その日に当たる記録を作る
// （DBの make_money_recurring_records）。額を見込むものは、過去1年の記録（種類・出金元・お店が同じもの）から出す。
// カード代金はここではなく、出金元のカードに締め日・引き落とし日・引き落とし口座を入れると作られる（一覧だけ出す）。
// 直すのはルールだけで、もう作った記録は変わらない。
//
// 固定収入（給与・賞与。2026-10-11。docs/kakei.md §0.3）も同じルールで、mode が 'income' の画面。収入のルールだけを出し、
// 入金先・振込日・見込み額の言葉にする。賞与は1回ごとに1件のルール（月・日・額）で、「同じ名前でもう1回足す」で回を増やす。
// 履歴は、その年の収入の記録を見込み／確定つきで年ごとに出す（見込み額の変更の版は持たない）。

interface RecurringSettingsProps {
  /** 'expense'＝固定費（支出・振替）、'income'＝固定収入（給与・賞与）。 */
  mode: 'expense' | 'income';
  familyId: string;
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onBack: () => void;
  /**
   * スマホの戻るボタン。家計の設定の Modal が受けるので、編集を開いているあいだはここに戻り方を入れる
   * （編集の中の選ぶ画面 → 編集 → 一覧の順に戻る）。null なら家計の設定が一覧から入口へ戻す。
   */
  backRef: MutableRefObject<(() => void) | null>;
}

const KINDS: MoneyRecordKind[] = ['expense', 'transfer'];
const HOLIDAYS: MoneyHolidayRule[] = ['next', 'prev', 'none'];
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const byPosition = (a: MoneyRecurring, b: MoneyRecurring) => a.position - b.position;

export default function RecurringSettings({
  mode,
  familyId,
  recurring,
  wallets,
  categories,
  budgets,
  stores,
  records,
  onRecurring,
  onStores,
  onBack,
  backRef,
}: RecurringSettingsProps) {
  const isIncome = mode === 'income';
  const [editing, setEditing] = useState<MoneyRecurring | 'new' | null>(null);
  // 賞与の「もう1回」を足すときの元（月・日だけ入れ直す）。
  const [template, setTemplate] = useState<MoneyRecurring | null>(null);
  // 編集を閉じたら、戻る操作を家計の設定へ返す（開いているあいだは RecurringEditor が入れる）。
  useEffect(() => {
    if (editing === null) backRef.current = null;
  }, [editing, backRef]);
  const inMode = recurring.filter((rule) => (rule.kind === 'income') === isIncome);
  const usable = inMode.filter((rule) => !rule.archived);
  const archived = inMode.filter((rule) => rule.archived);
  const cards = isIncome ? [] : wallets.filter((wallet) => wallet.type === 'card' && !wallet.archived);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');
  const put = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));

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

  const setArchived = async (rule: MoneyRecurring, value: boolean) => {
    setEditing(null);
    try {
      put(await setMoneyRecurringArchived(supabase, rule.id, value));
    } catch {
      failed();
    }
  };

  if (editing !== null) {
    return (
      <RecurringEditor
        key={editing === 'new' ? 'new' : editing.id}
        mode={mode}
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
        onArchive={editing === 'new' ? undefined : () => void setArchived(editing, true)}
        onAddSimilar={
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
      <ScreenHeader title={isIncome ? '固定収入' : '固定費'} icon="back" onClose={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.note}>
          {isIncome
            ? '給与・賞与を登録すると、振込日に見込みの額で自動で記録します（毎朝。休日は営業日にずらします）。給与明細などを見て額を直すと確定します。賞与は1回ごとに、月と日と額を足します。'
            : '口座から落ちる固定費を登録すると、その日に自動で記録します（毎朝。休日は営業日にずらします）。額を見込むものは「見込み」の印つきで記録し、額を直すと確定します。'}
        </Text>
        {usable.length === 0 && (
          <Text style={styles.empty}>
            {isIncome ? 'まだありません。給与・賞与を足してください' : 'まだありません。家賃・光熱費などを足してください'}
          </Text>
        )}
        {(isIncome ? (['income'] as const) : KINDS).map((kind) => {
          const inKind = usable.filter((rule) => rule.kind === kind);
          if (inKind.length === 0) return null;
          return (
            <View key={kind} style={styles.section}>
              {!isIncome && <Text style={styles.sectionTitle}>{RECORD_KIND_LABEL[kind]}</Text>}
              {inKind.map((rule) => (
                <Pressable
                  key={rule.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${ruleTitle(rule, categories)}を編集`}
                  onPress={() => setEditing(rule)}
                  style={styles.row}
                >
                  <View style={styles.flex}>
                    <Text style={styles.name}>{ruleTitle(rule, categories)}</Text>
                    <Text style={styles.sub}>{recurringScheduleLabel(rule)}</Text>
                    <Text style={styles.sub}>
                      {rule.kind === 'transfer'
                        ? `${walletName(rule.walletId) || '?'} → ${walletName(rule.toWalletId) || '?'}`
                        : walletName(rule.walletId) || (isIncome ? '入金先なし' : '出金元なし')}
                      ・{amountLabel(rule, isIncome)}
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
          <Text style={styles.addText}>{isIncome ? '固定収入を足す' : '固定費を足す'}</Text>
        </Pressable>

        {isIncome && <IncomeHistory records={records} categories={categories} />}

        {cards.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>カード代金（出金元のカードで設定）</Text>
            {cards.map((card) => {
              const schedule = cardScheduleLabel(card);
              const ready = schedule !== '' && card.payWalletId !== null;
              return (
                <View key={card.id} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.name}>{card.name}</Text>
                    <Text style={styles.sub}>
                      {ready
                        ? `${schedule}・${walletName(card.payWalletId)}から（休日は翌営業日）`
                        : '締め日・引き落とし日・引き落とし口座がそろっていません'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {archived.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{isIncome ? '使わない固定収入（作った記録は残っています）' : '使わない固定費（作った記録は残っています）'}</Text>
            {archived.map((rule) => (
              <View key={rule.id} style={[styles.row, styles.archivedRow]}>
                <Text style={[styles.name, styles.flex]}>{ruleTitle(rule, categories)}</Text>
                <Pressable accessibilityRole="button" onPress={() => void setArchived(rule, false)} hitSlop={8}>
                  <Text style={styles.link}>また使う</Text>
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
function amountLabel(rule: MoneyRecurring, isIncome: boolean): string {
  if (rule.amountMode === 'fixed') return `固定 ${formatYen(rule.amount)}`;
  if (isIncome) return rule.amount > 0 ? `見込み額 ${formatYen(rule.amount)}` : '見込み額は過去の記録から';
  return '過去の記録から見込む';
}

/** 固定収入の履歴。その年の収入の記録を、新しい日から（見込みの印つき）。年は送れる。 */
function IncomeHistory({ records, categories }: { records: MoneyRecord[]; categories: MoneyCategory[] }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const list = useMemo(() => incomeRecordsInYear(records, year), [records, year]);
  const total = list.reduce((sum, record) => sum + recordTotal(record), 0);
  const titleOf = (record: MoneyRecord) => {
    const item = record.items[0];
    if (item && item.name.trim() !== '') return item.name.trim();
    if (record.store.trim() !== '') return record.store.trim();
    return item && item.categoryId !== null ? categoryPath(categories, item.categoryId) : '収入';
  };
  return (
    <View style={styles.section}>
      <View style={styles.yearBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="前の年" onPress={() => setYear(year - 1)} hitSlop={10}>
          <ChevronLeft size={22} color={colors.textSubtle} />
        </Pressable>
        <Text style={styles.yearText}>{formatYear(year)}の収入</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="次の年" onPress={() => setYear(year + 1)} hitSlop={10}>
          <ChevronRight size={22} color={colors.textSubtle} />
        </Pressable>
      </View>
      {list.length === 0 ? (
        <Text style={styles.empty}>この年の収入の記録はまだありません</Text>
      ) : (
        <>
          {list.map((record) => (
            <View key={record.id} style={styles.historyRow}>
              <Text style={styles.historyDate}>{formatShortDate(record.occurredOn)}</Text>
              <Text style={[styles.name, styles.flex]} numberOfLines={1}>
                {titleOf(record)}
              </Text>
              {record.isEstimate && <EstimateBadge />}
              <Text style={styles.historyAmount}>{formatYen(recordTotal(record))}</Text>
            </View>
          ))}
          <Text style={styles.sub}>合計 {formatYen(total)}</Text>
        </>
      )}
    </View>
  );
}

/** ルールの名前（品名 → お店 → 種類の順に、あるもの）。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  if (rule.name.trim() !== '') return rule.name.trim();
  if (rule.store.trim() !== '') return rule.store.trim();
  if (rule.categoryId !== null) return categoryPath(categories, rule.categoryId);
  return RECORD_KIND_LABEL[rule.kind];
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
  onArchive,
  onAddSimilar,
  backRef,
}: {
  mode: 'expense' | 'income';
  rule: MoneyRecurring | null;
  /** 賞与の「もう1回」を足すときの元。月・日は入れ直す。 */
  template: MoneyRecurring | null;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onClose: () => void;
  onSubmit: (draft: MoneyRecurringDraft, registerStore: boolean) => void;
  onArchive?: () => void;
  /** 固定収入で、同じ名前・入金先でもう1回（月・日・額）を足す。 */
  onAddSimilar?: (source: MoneyRecurring) => void;
  backRef: MutableRefObject<(() => void) | null>;
}) {
  const isIncome = mode === 'income';
  const base = rule ?? template;
  const [screen, setScreen] = useState<EditorScreen>('form');
  useEffect(() => {
    backRef.current = () => (screen === 'form' ? onClose() : setScreen('form'));
  });
  const [kind, setKind] = useState<MoneyRecordKind>(rule?.kind ?? (isIncome ? 'income' : 'expense'));
  const [categoryId, setCategoryId] = useState<string | null>(base?.categoryId ?? null);
  const [walletId, setWalletId] = useState<string | null>(base?.walletId ?? null);
  const [toWalletId, setToWalletId] = useState<string | null>(base?.toWalletId ?? null);
  const [store, setStore] = useState(base?.store ?? '');
  // お店の選択で「お店に登録して使う」を選んだか（保存のときにお店の設定に登録する）。
  const [registerStore, setRegisterStore] = useState(false);
  const [name, setName] = useState(base?.name ?? '');
  const [day, setDay] = useState(rule ? String(rule.day) : '');
  // 給与は休日の前の営業日に振り込まれることが多い。
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(base?.holiday ?? (isIncome ? 'prev' : 'next'));
  // 賞与の「もう1回」は、月を選び直す（空のまま）。
  const [months, setMonths] = useState<number[] | null>(rule ? rule.months : template ? [] : null);
  const [amountMode, setAmountMode] = useState<MoneyRecurring['amountMode']>(base?.amountMode ?? 'estimate');
  const [amount, setAmount] = useState(base && base.amount > 0 ? String(base.amount) : '');
  const [error, setError] = useState<string | null>(null);

  const usableWallets = wallets.filter((wallet) => !wallet.archived || wallet.id === walletId || wallet.id === toWalletId);
  const storeOptions = useMemo(() => storeChoices(stores, records), [stores, records]);
  const today = toDateString(new Date());
  const history = useMemo(
    () => recurringHistory({ kind, walletId, toWalletId, store, categoryId }, records, today),
    [kind, walletId, toWalletId, store, categoryId, records, today],
  );
  const target = categoryId !== null ? categoryPath(categories, categoryId) : '';

  const changeKind = (next: MoneyRecordKind) => {
    if (next === kind) return;
    setKind(next);
    setCategoryId(null);
  };

  const toggleMonth = (month: number) => {
    const current = months ?? [];
    const next = current.includes(month) ? current.filter((entry) => entry !== month) : [...current, month];
    setMonths(next.sort((a, b) => a - b));
  };

  const submit = () => {
    const dayValue = Number(day.trim());
    if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) return setError(`${isIncome ? '振込日' : '引き落とし日'}を 1〜31 で入れてください（末日は31）`);
    if (walletId === null) return setError(kind === 'income' ? '入金先を選んでください' : '出金元を選んでください');
    if (kind === 'transfer' && (toWalletId === null || toWalletId === walletId)) return setError('入金先を選んでください（出金元と別の口座）');
    if (kind !== 'transfer' && categoryId === null) return setError('種類を選んでください');
    if (months !== null && months.length === 0) return setError('記録する月を選んでください');
    const amountValue = amount.trim() === '' ? 0 : Number(amount.trim());
    if (!Number.isInteger(amountValue) || amountValue < 0) return setError('額は0以上の整数で入れてください');
    if (amountMode === 'fixed' && amountValue === 0) return setError('固定額を入れてください');
    onSubmit({
      kind,
      day: dayValue,
      months,
      holiday,
      amountMode,
      amount: amountValue,
      walletId,
      toWalletId: kind === 'transfer' ? toWalletId : null,
      store: kind === 'transfer' ? '' : store,
      categoryId: kind === 'transfer' ? null : categoryId,
      name,
    }, kind !== 'transfer' && store !== '' && registerStore);
  };

  const archive = () =>
    Alert.alert(`この${isIncome ? '固定収入' : '固定費'}を使わなくしますか？`, 'これから先は作らなくなります。作った記録は残ります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '使わなくする', style: 'destructive', onPress: () => onArchive?.() },
    ]);

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
      {usableWallets.length === 0 && <Text style={styles.sub}>出金元を先に足してください</Text>}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={`${isIncome ? '固定収入' : '固定費'}を${rule ? '編集' : '足す'}`}
        icon="back"
        onClose={onClose}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!isIncome && (
          <View style={styles.chips}>
            {KINDS.map((entry) => (
              <Chip key={entry} label={RECORD_KIND_LABEL[entry]} selected={kind === entry} onPress={() => changeKind(entry)} />
            ))}
          </View>
        )}

        {kind !== 'transfer' && (
          <Pressable accessibilityRole="button" onPress={() => setScreen('category')} style={styles.pick}>
            <Text style={styles.label}>種類</Text>
            <Text style={[styles.pickText, target === '' && styles.placeholder]}>{target || '選ぶ'}</Text>
            <ChevronRight size={18} color={colors.textFaint} />
          </Pressable>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>{kind === 'income' ? '入金先' : '出金元'}</Text>
          {walletChips(walletId, setWalletId, null)}
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
            placeholder={isIncome ? '例: 賞与（6月）' : '例: 電気代'}
            placeholderTextColor={colors.textFaint}
          />
        </View>

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
        <View style={styles.field}>
          <Text style={styles.label}>休日のとき</Text>
          <View style={styles.chips}>
            {HOLIDAYS.map((entry) => (
              <Chip key={entry} label={HOLIDAY_RULE_LABEL[entry]} selected={holiday === entry} onPress={() => setHoliday(entry)} />
            ))}
          </View>
          <Text style={styles.sub}>休日は土日・祝日・12月31日〜1月3日（銀行の休業日）</Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>記録する月</Text>
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
          <Text style={styles.sub}>
            {isIncome
              ? '給与は毎月。賞与は支給される月を選びます（年に2回なら、回ごとに足します）'
              : '年に数回のものは、月を選びます（毎月の見込みを崩さないため）'}
          </Text>
        </View>

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
          <Text style={styles.sub}>
            {amountMode === 'fixed'
              ? `この額で確定として記録します（${isIncome ? '額が決まっている給与など' : '家賃・ローンなど'}）`
              : isIncome
                ? '振込日に、この額を「見込み」として記録します。給与明細などを見て額を直すと確定します。前の年の同じ月の記録があれば、その額を見込みにします'
                : '前年同月の記録があればその額、無ければ直近3回の平均で、「見込み」として記録します。記録が1件も無いときは、上に入れた額で「見込み」として記録します'}
          </Text>
          {amountMode === 'estimate' && (
            <Text style={styles.sub}>
              {history.length === 0
                ? '過去1年に、種類・出金元・お店が同じ記録はまだありません'
                : `過去1年の記録 ${history.length}件（直近 ${formatShortDate(history[0].occurredOn)} ${formatYen(history[0].amount)}）`}
            </Text>
          )}
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="保存する" onPress={submit} />
        {isIncome && rule && onAddSimilar && (
          <Pressable accessibilityRole="button" onPress={() => onAddSimilar(rule)} style={styles.secondary}>
            <Text style={styles.similarText}>同じ名前でもう1回（月・日）を足す</Text>
          </Pressable>
        )}
        {onArchive && (
          <Pressable accessibilityRole="button" onPress={archive} style={styles.secondary}>
            <Text style={styles.deleteText}>使わなくする</Text>
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
  note: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: colors.textMuted },
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
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  link: { fontSize: 13, fontWeight: '700', color: colors.money },
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
  yearBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  yearText: { fontSize: 15, fontWeight: '700', color: colors.text },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyDate: { width: 44, fontSize: 13, fontWeight: '600', color: colors.textMuted },
  historyAmount: { fontSize: 15, fontWeight: '800', color: colors.moneyIncome },
});
