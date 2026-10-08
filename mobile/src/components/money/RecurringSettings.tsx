import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronRight, Pencil, Plus } from 'lucide-react-native';
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
  SpecialActual,
  SpecialItem,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import {
  cardScheduleLabel,
  categoryPath,
  formatShortDate,
  formatYen,
  HOLIDAY_RULE_LABEL,
  monthKeyOfDate,
  RECORD_KIND_LABEL,
  recurringHistory,
  recurringScheduleLabel,
  storeChoices,
} from '@/lib/moneyUtils';
import { insertMoneyRecurring, setMoneyRecurringArchived, updateMoneyRecurring } from '@/lib/api/money';
import CategoryPicker from '@/components/money/CategoryPicker';
import StorePicker from '@/components/money/StorePicker';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 毎月の記録の設定（docs/kakei.md §3.3・§3.4・§3.5）。PWA版の `src/components/sukusuku/money/RecurringSettings.tsx` と同じ並び・文言。
//
// 口座から落ちる固定費・口座に入る給料などを、項目ごとのルールにする。サーバーが毎朝、その日に当たる記録を作る
// （DBの make_money_recurring_records）。額を見込むものは、過去1年の記録（種類・出金元・お店が同じもの）から出す。
// カード代金はここではなく、出金元のカードに締め日・引き落とし日・引き落とし口座を入れると作られる（一覧だけ出す）。
// 直すのはルールだけで、もう作った記録は変わらない。

interface RecurringSettingsProps {
  familyId: string;
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onBack: () => void;
  /**
   * スマホの戻るボタン。家計の設定の Modal が受けるので、編集を開いているあいだはここに戻り方を入れる
   * （編集の中の選ぶ画面 → 編集 → 一覧の順に戻る）。null なら家計の設定が一覧から入口へ戻す。
   */
  backRef: MutableRefObject<(() => void) | null>;
}

const KINDS: MoneyRecordKind[] = ['expense', 'income', 'transfer'];
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
  specialItems,
  specialActuals,
  onRecurring,
  onBack,
  backRef,
}: RecurringSettingsProps) {
  const [editing, setEditing] = useState<MoneyRecurring | 'new' | null>(null);
  // 編集を閉じたら、戻る操作を家計の設定へ返す（開いているあいだは RecurringEditor が入れる）。
  useEffect(() => {
    if (editing === null) backRef.current = null;
  }, [editing, backRef]);
  const usable = recurring.filter((rule) => !rule.archived);
  const archived = recurring.filter((rule) => rule.archived);
  const cards = wallets.filter((wallet) => wallet.type === 'card' && !wallet.archived);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';
  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');
  const put = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));

  const save = async (target: MoneyRecurring | null, draft: MoneyRecurringDraft) => {
    setEditing(null);
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
        rule={editing === 'new' ? null : editing}
        wallets={wallets}
        categories={categories}
        budgets={budgets}
        stores={stores}
        records={records}
        specialItems={specialItems}
        specialActuals={specialActuals}
        onClose={() => setEditing(null)}
        onSubmit={(draft) => void save(editing === 'new' ? null : editing, draft)}
        onArchive={editing === 'new' ? undefined : () => void setArchived(editing, true)}
        backRef={backRef}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="毎月の記録" icon="back" onClose={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.note}>
          口座から落ちる固定費・口座に入る給料などを登録すると、その日に自動で記録します（毎朝。休日は営業日にずらします）。
          額を見込むものは「見込み」の印つきで記録し、額を直すと確定します。
        </Text>
        {usable.length === 0 && <Text style={styles.empty}>まだありません。家賃・光熱費・給料などを足してください</Text>}
        {KINDS.map((kind) => {
          const inKind = usable.filter((rule) => rule.kind === kind);
          if (inKind.length === 0) return null;
          return (
            <View key={kind} style={styles.section}>
              <Text style={styles.sectionTitle}>{RECORD_KIND_LABEL[kind]}</Text>
              {inKind.map((rule) => (
                <Pressable
                  key={rule.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${ruleTitle(rule, categories, specialItems)}を編集`}
                  onPress={() => setEditing(rule)}
                  style={styles.row}
                >
                  <View style={styles.flex}>
                    <Text style={styles.name}>{ruleTitle(rule, categories, specialItems)}</Text>
                    <Text style={styles.sub}>{recurringScheduleLabel(rule)}</Text>
                    <Text style={styles.sub}>
                      {rule.kind === 'transfer'
                        ? `${walletName(rule.walletId) || '?'} → ${walletName(rule.toWalletId) || '?'}`
                        : walletName(rule.walletId) || '出金元なし'}
                      ・{rule.amountMode === 'fixed' ? `固定 ${formatYen(rule.amount)}` : '過去の記録から見込む'}
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
          <Text style={styles.addText}>毎月の記録を足す</Text>
        </Pressable>

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
            <Text style={styles.sectionTitle}>使わない毎月の記録（作った記録は残っています）</Text>
            {archived.map((rule) => (
              <View key={rule.id} style={[styles.row, styles.archivedRow]}>
                <Text style={[styles.name, styles.flex]}>{ruleTitle(rule, categories, specialItems)}</Text>
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

/** ルールの名前（品名 → お店 → 種類の順に、あるもの）。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[], specialItems: SpecialItem[]): string {
  if (rule.name.trim() !== '') return rule.name.trim();
  if (rule.store.trim() !== '') return rule.store.trim();
  if (rule.categoryId !== null) return categoryPath(categories, rule.categoryId);
  if (rule.specialItemId !== null) return specialItems.find((item) => item.id === rule.specialItemId)?.name ?? '';
  return RECORD_KIND_LABEL[rule.kind];
}

type EditorScreen = 'form' | 'category' | 'store';

function RecurringEditor({
  rule,
  wallets,
  categories,
  budgets,
  stores,
  records,
  specialItems,
  specialActuals,
  onClose,
  onSubmit,
  onArchive,
  backRef,
}: {
  rule: MoneyRecurring | null;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onClose: () => void;
  onSubmit: (draft: MoneyRecurringDraft) => void;
  onArchive?: () => void;
  backRef: MutableRefObject<(() => void) | null>;
}) {
  const [screen, setScreen] = useState<EditorScreen>('form');
  useEffect(() => {
    backRef.current = () => (screen === 'form' ? onClose() : setScreen('form'));
  });
  const [kind, setKind] = useState<MoneyRecordKind>(rule?.kind ?? 'expense');
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? null);
  const [specialItemId, setSpecialItemId] = useState<string | null>(rule?.specialItemId ?? null);
  const [walletId, setWalletId] = useState<string | null>(rule?.walletId ?? null);
  const [toWalletId, setToWalletId] = useState<string | null>(rule?.toWalletId ?? null);
  const [store, setStore] = useState(rule?.store ?? '');
  const [name, setName] = useState(rule?.name ?? '');
  const [day, setDay] = useState(rule ? String(rule.day) : '');
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(rule?.holiday ?? 'next');
  const [months, setMonths] = useState<number[] | null>(rule?.months ?? null);
  const [amountMode, setAmountMode] = useState<MoneyRecurring['amountMode']>(rule?.amountMode ?? 'estimate');
  const [amount, setAmount] = useState(rule && rule.amount > 0 ? String(rule.amount) : '');
  const [error, setError] = useState<string | null>(null);

  const usableWallets = wallets.filter((wallet) => !wallet.archived || wallet.id === walletId || wallet.id === toWalletId);
  const storeOptions = useMemo(() => storeChoices(stores, records), [stores, records]);
  const today = toDateString(new Date());
  const history = useMemo(
    () => recurringHistory({ kind, walletId, toWalletId, store, categoryId, specialItemId }, records, today),
    [kind, walletId, toWalletId, store, categoryId, specialItemId, records, today],
  );
  const target =
    categoryId !== null
      ? categoryPath(categories, categoryId)
      : specialItemId !== null
        ? `${kind === 'income' ? '特別収入' : '特別費'} › ${specialItems.find((item) => item.id === specialItemId)?.name ?? ''}`
        : '';

  const changeKind = (next: MoneyRecordKind) => {
    if (next === kind) return;
    setKind(next);
    setCategoryId(null);
    setSpecialItemId(null);
  };

  const toggleMonth = (month: number) => {
    const current = months ?? [];
    const next = current.includes(month) ? current.filter((entry) => entry !== month) : [...current, month];
    setMonths(next.sort((a, b) => a - b));
  };

  const submit = () => {
    const dayValue = Number(day.trim());
    if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31) return setError('引き落とし日を 1〜31 で入れてください（末日は31）');
    if (walletId === null) return setError(kind === 'income' ? '入金先を選んでください' : '出金元を選んでください');
    if (kind === 'transfer' && (toWalletId === null || toWalletId === walletId)) return setError('入金先を選んでください（出金元と別の口座）');
    if (kind !== 'transfer' && categoryId === null && specialItemId === null) return setError('種類を選んでください');
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
      specialItemId: kind === 'transfer' ? null : specialItemId,
      name,
    });
  };

  const archive = () =>
    Alert.alert('この毎月の記録を使わなくしますか？', 'これから先は作らなくなります。作った記録は残ります。', [
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
        specialItems={specialItems}
        specialActuals={specialActuals}
        onPick={(choice) => {
          setCategoryId(choice.categoryId);
          setSpecialItemId(choice.specialItemId);
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
        onPick={(value) => {
          setStore(value);
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
      <ScreenHeader title={rule ? '毎月の記録を編集' : '毎月の記録を足す'} icon="back" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.chips}>
          {KINDS.map((entry) => (
            <Chip key={entry} label={RECORD_KIND_LABEL[entry]} selected={kind === entry} onPress={() => changeKind(entry)} />
          ))}
        </View>

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
            placeholder="例: 電気代"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>引き落とし日（入る日）</Text>
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
          <Text style={styles.sub}>賞与のように年に数回のものは、別の記録にして月を選びます（毎月の見込みを崩さないため）</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>額の決め方</Text>
          <View style={styles.chips}>
            <Chip label="過去の記録から見込む" selected={amountMode === 'estimate'} onPress={() => setAmountMode('estimate')} />
            <Chip label="固定額" selected={amountMode === 'fixed'} onPress={() => setAmountMode('fixed')} />
          </View>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder={amountMode === 'fixed' ? '額（円）' : '過去の記録が無いときの額（円・任意）'}
            placeholderTextColor={colors.textFaint}
          />
          <Text style={styles.sub}>
            {amountMode === 'fixed'
              ? 'この額で確定として記録します（家賃・ローンなど）'
              : '前年同月の記録があればその額、無ければ直近3回の平均で、「見込み」として記録します'}
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
});
