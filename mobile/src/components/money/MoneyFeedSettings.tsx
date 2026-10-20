import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { ArrowDown, ArrowUp, ChevronRight, Minus, Plus } from 'lucide-react-native';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyFeedAction,
  MoneyFeedData,
  MoneyFeedRule,
  MoneyFeedRuleDraft,
  MoneyRecord,
  MoneyRecurring,
  MoneyWallet,
  MoneyWalletFeed,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { FEED_ACTION_LABELS, feedRuleAction, feedRuleCondition, feedTimeLabel } from '@/lib/moneyFeedUtils';
import {
  deleteMoneyFeedRule,
  insertMoneyFeedRule,
  issueMoneyFeedToken,
  reorderMoneyFeedRules,
  reprocessMoneyFeed,
  saveMoneyFeedSettings,
  saveMoneyWalletFeed,
  updateMoneyFeedRule,
} from '@/lib/api/moneyFeed';
import SheetModal from '@/components/ui/SheetModal';
import LogModalShell from '@/components/log/LogModalShell';
import CategoryPicker from '@/components/money/CategoryPicker';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';
import { Chip, ChipRow, Field, WalletChoices } from '@/components/money/feedParts';

// 家計の設定の「Gmail 取り込み」（docs/kakei.md §9.5.6・§9.11）。PWA版の `src/components/sukusuku/money/MoneyFeedSettings.tsx` と同じ並び・文言。
//
// 取り込みに関わる設定をここ1か所で決める: 取り込みの状態と鍵／口座の対応（利用通知のカード名 → 出金元と所持者）／
// 取り込みのルール（条件と動き。上から見て最初に当たったもの）／突き合わせの幅（日数）。
// 口座の対応・ルールを直したら、未確認の明細を突き合わせ直す（money_feed_reprocess）。

interface MoneyFeedSettingsProps {
  familyId: string;
  feed: MoneyFeedData | null;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  records: MoneyRecord[];
  recurring: MoneyRecurring[];
  /** 直したあとに読み直す（明細も突き合わせ直したあと）。 */
  onChanged: () => Promise<void>;
  onBack: () => void;
}

/** 口座の対応の1行。届いた口座名か、口座名を入れてある出金元。 */
interface AccountRow {
  key: string;
  accountName: string;
  toEmail: string | null;
  walletFeed: MoneyWalletFeed | null;
}

const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');

const EMPTY_RULE: MoneyFeedRuleDraft = {
  name: '',
  walletId: null,
  direction: null,
  match: 'contains',
  pattern: '',
  amountMin: null,
  amountMax: null,
  action: 'record',
  recordKind: 'expense',
  categoryId: null,
  store: '',
  toWalletId: null,
  recurringId: null,
};

export default function MoneyFeedSettings({
  familyId,
  feed,
  wallets,
  categories,
  budgets,
  records,
  recurring,
  onChanged,
  onBack,
}: MoneyFeedSettingsProps) {
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [rule, setRule] = useState<{ target: MoneyFeedRule | null; draft: MoneyFeedRuleDraft } | null>(null);

  const walletName = (id: string) => wallets.find((wallet) => wallet.id === id)?.name ?? '（使わない出金元）';
  const names = {
    wallet: walletName,
    category: (id: string) => categories.find((category) => category.id === id)?.name ?? '（削除したカテゴリ）',
    recurring: (id: string) => recurring.find((entry) => entry.id === id)?.name || '（固定の記録）',
  };

  const accountRows = useMemo<AccountRow[]>(() => {
    if (!feed) return [];
    const rows = new Map<string, AccountRow>();
    const keyOf = (name: string, email: string | null) => `${name}\n${(email ?? '').toLowerCase()}`;
    const mapped = (name: string, email: string | null) =>
      feed.walletFeeds.find(
        (entry) =>
          entry.feedName === name &&
          (entry.holderZaimEmail === null || email === null || entry.holderZaimEmail.toLowerCase() === email.toLowerCase()),
      ) ?? null;
    for (const entry of feed.accounts) {
      rows.set(keyOf(entry.accountName, entry.toEmail), {
        key: keyOf(entry.accountName, entry.toEmail),
        accountName: entry.accountName,
        toEmail: entry.toEmail,
        walletFeed: mapped(entry.accountName, entry.toEmail),
      });
    }
    for (const entry of feed.walletFeeds) {
      if (entry.feedName === null) continue;
      const key = keyOf(entry.feedName, entry.holderZaimEmail);
      if (![...rows.values()].some((row) => row.walletFeed?.walletId === entry.walletId)) {
        rows.set(key, { key, accountName: entry.feedName, toEmail: entry.holderZaimEmail, walletFeed: entry });
      }
    }
    return [...rows.values()].sort((a, b) => a.accountName.localeCompare(b.accountName, 'ja'));
  }, [feed]);

  if (!feed) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Gmail 取り込み" icon="back" onClose={onBack} />
        <Text style={styles.empty}>読み込み中...</Text>
      </View>
    );
  }

  const unreadable = feed.open.filter((item) => item.status === 'unreadable').length;
  const open = feed.open.length - unreadable;

  const afterChange = async () => {
    try {
      await reprocessMoneyFeed(supabase);
    } finally {
      await onChanged();
    }
  };

  const issueToken = () =>
    Alert.alert('取り込みの鍵を作り直しますか？', 'いまの鍵は使えなくなります。Apps Script の FEED_TOKEN を新しい鍵に入れ替えてください。', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '作り直す',
        style: 'destructive',
        onPress: () =>
          void issueMoneyFeedToken(supabase)
            .then(setToken)
            .catch(failed),
      },
    ]);

  const saveDays = async (key: 'pairDays' | 'estimateDays' | 'manualDays', value: number) => {
    try {
      await saveMoneyFeedSettings(supabase, familyId, { ...feed.settings, [key]: Math.max(0, Math.min(14, value)) });
      await afterChange();
    } catch {
      failed();
    }
  };

  const moveRule = async (index: number, delta: number) => {
    const ids = feed.rules.map((entry) => entry.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorderMoneyFeedRules(supabase, ids);
      await afterChange();
    } catch {
      failed();
    }
  };

  const saveRule = async (target: MoneyFeedRule | null, draft: MoneyFeedRuleDraft) => {
    setRule(null);
    try {
      if (target) await updateMoneyFeedRule(supabase, target.id, draft);
      else await insertMoneyFeedRule(supabase, familyId, draft, feed.rules.reduce((max, entry) => Math.max(max, entry.position + 1), 0));
      await afterChange();
    } catch {
      failed();
    }
  };

  const removeRule = (target: MoneyFeedRule) =>
    Alert.alert('このルールを削除しますか？', '作った記録はそのまま残ります。', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: () => {
          setRule(null);
          void deleteMoneyFeedRule(supabase, target.id)
            .then(onChanged)
            .catch(failed);
        },
      },
    ]);

  const saveAccount = async (next: MoneyWalletFeed) => {
    setAccount(null);
    try {
      await saveMoneyWalletFeed(supabase, familyId, next, feed.walletFeeds);
      await afterChange();
    } catch {
      failed();
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Gmail 取り込み" icon="back" onClose={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>状態</Text>
        <View style={styles.card}>
          <InfoRow label="最後に届いた" value={feedTimeLabel(feed.lastReceivedAt)} />
          <InfoRow label="この30日" value={`${feed.recentCount}件`} />
          <InfoRow label="未確認" value={`${open}件`} />
          {unreadable > 0 && <InfoRow label="読めないメール" value={`${unreadable}件`} />}
          <InfoRow label="取り込みの開始" value={feedTimeLabel(feed.settings.startAt)} />
          <Pressable accessibilityRole="button" onPress={issueToken} style={styles.cardButton}>
            <Text style={styles.link}>取り込みの鍵を作り直す</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>口座の対応</Text>
        <View style={styles.card}>
          {accountRows.length === 0 && <Text style={styles.cardEmpty}>まだ明細が届いていません</Text>}
          {accountRows.map((row, index) => (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              onPress={() => setAccount(row)}
              style={[styles.row, index > 0 && styles.rowDivided]}
            >
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{row.accountName}</Text>
                {row.toEmail && <Text style={styles.rowSub}>{row.toEmail}</Text>}
              </View>
              <Text style={[styles.rowValue, !row.walletFeed && styles.unset]} numberOfLines={1}>
                {row.walletFeed ? walletName(row.walletFeed.walletId) : '未設定'}
              </Text>
              <ChevronRight size={16} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>ルール</Text>
        <View style={styles.card}>
          {feed.rules.length === 0 && <Text style={styles.cardEmpty}>ルールはまだありません</Text>}
          {feed.rules.map((entry, index) => (
            <View key={entry.id} style={[styles.row, index > 0 && styles.rowDivided]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRule({ target: entry, draft: { ...entry } })}
                style={styles.flex}
              >
                <View style={styles.titleRow}>
                  <Text style={[styles.rowTitle, styles.shrink]} numberOfLines={1}>
                    {entry.name || FEED_ACTION_LABELS[entry.action]}
                  </Text>
                  {entry.learned && <Text style={styles.badge}>覚えた</Text>}
                </View>
                <Text style={styles.rowSub}>{feedRuleCondition(entry, walletName)}</Text>
                <Text style={styles.rowAction}>→ {feedRuleAction(entry, names)}</Text>
              </Pressable>
              <View style={styles.moves}>
                <Pressable accessibilityRole="button" accessibilityLabel="上へ" hitSlop={6} onPress={() => void moveRule(index, -1)}>
                  <ArrowUp size={18} color={index === 0 ? colors.border : colors.textMuted} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="下へ" hitSlop={6} onPress={() => void moveRule(index, 1)}>
                  <ArrowDown size={18} color={index === feed.rules.length - 1 ? colors.border : colors.textMuted} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={() => setRule({ target: null, draft: EMPTY_RULE })} style={styles.add}>
          <Plus size={18} color={colors.money} />
          <Text style={styles.addText}>ルールを足す</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>突き合わせの幅</Text>
        <View style={styles.card}>
          <DaysRow label="自動の記録との照合" value={feed.settings.estimateDays} onChange={(value) => void saveDays('estimateDays', value)} />
          <DaysRow label="手入力との確認" value={feed.settings.manualDays} onChange={(value) => void saveDays('manualDays', value)} divided />
        </View>
      </ScrollView>

      {token !== null && <TokenSheet token={token} onClose={() => setToken(null)} />}
      {account !== null && (
        <AccountSheet
          row={account}
          wallets={wallets}
          walletFeeds={feed.walletFeeds}
          onClose={() => setAccount(null)}
          onSubmit={(next) => void saveAccount(next)}
        />
      )}
      {rule !== null && (
        <RuleSheet
          target={rule.target}
          initial={rule.draft}
          wallets={wallets}
          categories={categories}
          budgets={budgets}
          records={records}
          recurring={recurring}
          onClose={() => setRule(null)}
          onSubmit={(draft) => void saveRule(rule.target, draft)}
          onDelete={rule.target ? () => removeRule(rule.target!) : undefined}
        />
      )}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function DaysRow({ label, value, onChange, divided }: { label: string; value: number; onChange: (value: number) => void; divided?: boolean }) {
  return (
    <View style={[styles.row, divided && styles.rowDivided]}>
      <Text style={[styles.rowTitle, styles.flex]}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="1日へらす" hitSlop={6} onPress={() => onChange(value - 1)} disabled={value <= 0}>
        <Minus size={18} color={value <= 0 ? colors.border : colors.textMuted} />
      </Pressable>
      <Text style={styles.days}>前後{value}日</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="1日ふやす" hitSlop={6} onPress={() => onChange(value + 1)} disabled={value >= 14}>
        <Plus size={18} color={value >= 14 ? colors.border : colors.textMuted} />
      </Pressable>
    </View>
  );
}

function TokenSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title="新しい取り込みの鍵"
        onClose={onClose}
        footer={
          <PrimaryButton
            label={copied ? 'コピーしました' : 'コピーする'}
            onPress={() => {
              void Clipboard.setStringAsync(token).then(() => setCopied(true));
            }}
          />
        }
      >
        <Text selectable style={styles.token}>
          {token}
        </Text>
        <Text style={styles.sub}>Apps Script の FEED_TOKEN に貼ってください。いまだけ表示します。</Text>
      </LogModalShell>
    </SheetModal>
  );
}

function AccountSheet({
  row,
  wallets,
  walletFeeds,
  onClose,
  onSubmit,
}: {
  row: AccountRow;
  wallets: MoneyWallet[];
  walletFeeds: MoneyWalletFeed[];
  onClose: () => void;
  onSubmit: (next: MoneyWalletFeed) => void;
}) {
  const [walletId, setWalletId] = useState<string | null>(row.walletFeed?.walletId ?? null);
  const current = walletFeeds.find((entry) => entry.walletId === walletId) ?? null;
  const [holderName, setHolderName] = useState(row.walletFeed?.holderName ?? '');
  const [email, setEmail] = useState(row.walletFeed?.holderZaimEmail ?? row.toEmail ?? '');
  const [kana, setKana] = useState(row.walletFeed?.holderKana ?? '');

  const pick = (id: string) => {
    setWalletId(id);
    const entry = walletFeeds.find((feed) => feed.walletId === id);
    if (entry && !row.walletFeed) {
      setHolderName(entry.holderName ?? '');
      setKana(entry.holderKana ?? '');
    }
  };

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={`「${row.accountName}」の口座`}
        onClose={onClose}
        footer={
          <PrimaryButton
            label="保存する"
            disabled={walletId === null}
            onPress={() =>
              walletId &&
              onSubmit({
                walletId,
                feedName: row.accountName,
                holderName: holderName.trim() || null,
                holderZaimEmail: email.trim() || null,
                holderKana: kana.trim() || null,
              })
            }
          />
        }
      >
        <Field label="かぞく手帳の出金元">
          <WalletChoices
            wallets={wallets.filter((wallet) => !wallet.archived || wallet.id === walletId)}
            selectedId={walletId}
            onPick={pick}
          />
        </Field>
        {current?.feedName && current.feedName !== row.accountName && (
          <Text style={styles.sub}>この出金元には「{current.feedName}」が結ばれています。保存すると「{row.accountName}」に変わります。</Text>
        )}
        <Field label="所持者">
          <TextInput style={styles.input} value={holderName} onChangeText={setHolderName} placeholder="本人" placeholderTextColor={colors.textFaint} />
        </Field>
        <Field label="通知の宛先">
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="example@gmail.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </Field>
        <Field label="名義カナ">
          <TextInput style={styles.input} value={kana} onChangeText={setKana} placeholder="ヤマダ タロウ" placeholderTextColor={colors.textFaint} />
        </Field>
      </LogModalShell>
    </SheetModal>
  );
}

const ACTIONS: MoneyFeedAction[] = ['record', 'link_recurring', 'ignore'];

function RuleSheet({
  target,
  initial,
  wallets,
  categories,
  budgets,
  records,
  recurring,
  onClose,
  onSubmit,
  onDelete,
}: {
  target: MoneyFeedRule | null;
  initial: MoneyFeedRuleDraft;
  wallets: MoneyWallet[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  records: MoneyRecord[];
  recurring: MoneyRecurring[];
  onClose: () => void;
  onSubmit: (draft: MoneyFeedRuleDraft) => void;
  onDelete?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<MoneyFeedRuleDraft>(initial);
  const [pickingCategory, setPickingCategory] = useState(false);
  const set = (patch: Partial<MoneyFeedRuleDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const accounts = wallets.filter((wallet) => !wallet.archived);
  const usableRecurring = recurring.filter((entry) => !entry.archived);
  const categoryName = categories.find((category) => category.id === draft.categoryId)?.name ?? null;
  const amount = (text: string): number | null => {
    const value = Number(text.replace(/[^0-9]/g, ''));
    return text.trim() === '' || !Number.isFinite(value) ? null : value;
  };

  const valid =
    (draft.action !== 'record' || draft.categoryId !== null) &&
    (draft.action !== 'link_recurring' || draft.recurringId !== null);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={target ? 'ルールを編集' : 'ルールを足す'}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" disabled={!valid} onPress={() => onSubmit({ ...draft, name: draft.name.trim(), pattern: draft.pattern.trim() })} />
            {onDelete && (
              <Pressable accessibilityRole="button" onPress={onDelete} style={styles.secondary}>
                <Text style={styles.deleteText}>削除</Text>
              </Pressable>
            )}
          </>
        }
      >
        <Field label="名前">
          <TextInput style={styles.input} value={draft.name} onChangeText={(name) => set({ name })} placeholder="例: ユニクロ" placeholderTextColor={colors.textFaint} />
        </Field>
        <Text style={styles.sectionTitle}>条件</Text>
        <Field label="口座">
          <ChipRow>
            <Chip label="どの口座でも" selected={draft.walletId === null} onPress={() => set({ walletId: null })} />
            {accounts.map((wallet) => (
              <Chip key={wallet.id} label={wallet.name} selected={draft.walletId === wallet.id} onPress={() => set({ walletId: wallet.id })} />
            ))}
          </ChipRow>
        </Field>
        {draft.match === 'key' ? (
          <Field label="内容">
            <Text style={styles.pattern}>{draft.pattern}</Text>
          </Field>
        ) : (
          <Field label="内容に含む文字">
            <TextInput style={styles.input} value={draft.pattern} onChangeText={(pattern) => set({ pattern })} placeholder="例: ユニクロ" placeholderTextColor={colors.textFaint} />
          </Field>
        )}
        <Field label="金額">
          <View style={styles.amountRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={draft.amountMin === null ? '' : String(draft.amountMin)}
              onChangeText={(text) => set({ amountMin: amount(text) })}
              placeholder="下限"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
            />
            <Text style={styles.tilde}>〜</Text>
            <TextInput
              style={[styles.input, styles.flex]}
              value={draft.amountMax === null ? '' : String(draft.amountMax)}
              onChangeText={(text) => set({ amountMax: amount(text) })}
              placeholder="上限"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
            />
          </View>
        </Field>

        <Text style={styles.sectionTitle}>動き</Text>
        <ChipRow>
          {ACTIONS.map((action) => (
            <Chip key={action} label={FEED_ACTION_LABELS[action]} selected={draft.action === action} onPress={() => set({ action })} />
          ))}
        </ChipRow>
        {draft.action === 'record' && (
          <>
            <ChipRow>
              <Chip label="支出" selected={draft.recordKind !== 'income'} onPress={() => set({ recordKind: 'expense', categoryId: null })} />
              <Chip label="収入" selected={draft.recordKind === 'income'} onPress={() => set({ recordKind: 'income', categoryId: null })} />
            </ChipRow>
            <Field label="カテゴリ">
              <Pressable accessibilityRole="button" onPress={() => setPickingCategory(true)} style={styles.select}>
                <Text style={[styles.selectText, !categoryName && styles.placeholder]}>{categoryName ?? 'カテゴリを選ぶ'}</Text>
                <ChevronRight size={18} color={colors.textFaint} />
              </Pressable>
            </Field>
            <Field label="お店">
              <TextInput style={styles.input} value={draft.store} onChangeText={(store) => set({ store })} placeholder="例: ユニクロ" placeholderTextColor={colors.textFaint} />
            </Field>
          </>
        )}
        {draft.action === 'link_recurring' && (
          <Field label="結ぶ固定費">
            <ChipRow>
              {usableRecurring.map((entry) => (
                <Chip key={entry.id} label={entry.name || entry.store || '（名前なし）'} selected={draft.recurringId === entry.id} onPress={() => set({ recurringId: entry.id })} />
              ))}
            </ChipRow>
          </Field>
        )}
        {draft.action === 'ignore' && <Text style={styles.sub}>記録を作りません。</Text>}
      </LogModalShell>
      {pickingCategory && (
        <Modal visible animationType="slide" onRequestClose={() => setPickingCategory(false)}>
          <View style={[styles.picker, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
            <CategoryPicker
              kind={draft.recordKind === 'income' ? 'income' : 'expense'}
              categories={categories}
              onPick={(choice) => {
                set({ categoryId: choice.categoryId });
                setPickingCategory(false);
              }}
              onClose={() => setPickingCategory(false)}
            />
          </View>
        </Modal>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  picker: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, marginTop: 12 },
  sub: { fontSize: 12, fontWeight: '500', lineHeight: 18, color: colors.textMuted },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  cardEmpty: { fontSize: 13, fontWeight: '500', color: colors.textFaint, padding: 14 },
  cardButton: { paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 },
  infoLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  infoValue: { fontSize: 13, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
  rowAction: { fontSize: 12, fontWeight: '600', color: colors.moneyText, marginTop: 2 },
  rowValue: { maxWidth: '50%', fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  unset: { color: colors.moneyOver },
  moves: { gap: 10 },
  link: { fontSize: 14, fontWeight: '700', color: colors.money },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.moneyText,
    backgroundColor: colors.moneySoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  days: { minWidth: 64, textAlign: 'center', fontSize: 14, fontWeight: '700', color: colors.text },
  token: { fontSize: 15, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
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
  pattern: { fontSize: 14, fontWeight: '600', color: colors.text },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tilde: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectText: { fontSize: 15, fontWeight: '600', color: colors.text },
  placeholder: { color: colors.textFaint },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
