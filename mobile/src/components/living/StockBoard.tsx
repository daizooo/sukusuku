import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ListPlus, Minus, Plus } from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildStockBoard,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  nextInspectionOn,
  STORAGE_LABEL,
  unitPriceOf,
  type ExpiryLevel,
  type StockPlan,
  type StockStorage,
} from '@/lib/stockUtils';
import SegmentedTabs from '@/components/ui/SegmentedTabs';

// 防災備蓄の画面（docs/home.md §10.2・§10.2.1）。状態を見渡す「点検盤」。
// PWA版の `src/components/sukusuku/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 上（固定）: 備えの状況（件数・費用）と、保管場所（寝室／持ち出し）の切り替え。
// 中（スクロール）: 要対応 → 目標ごとの塊（期限順と必要数を1つに）→ その他の備品 → 備品（期限なし）。
// 持ち出しは、バッグの中身のチェック表にする。

const LEVEL_COLOR: Record<ExpiryLevel, string> = {
  expired: colors.alertText,
  soon: colors.alertText,
  year: colors.temperatureText,
  ok: colors.textMuted,
  none: colors.textFaint,
};

const STORAGE_OPTIONS: { id: StockStorage; label: string }[] = [
  { id: 'home', label: STORAGE_LABEL.home },
  { id: 'carry', label: STORAGE_LABEL.carry },
];

type PlanKey = keyof StockPlan;

type Anchor = 'short' | 'replacement' | 'inspect';

interface StockBoardProps {
  items: StockItem[];
  targets: StockTarget[];
  plan: StockPlan;
  /** 日本時間の今日（YYYY-MM-DD）。 */
  today: string;
  storage: StockStorage;
  onStorageChange: (storage: StockStorage) => void;
  onEditItem: (item: StockItem) => void;
  onEditTarget: (target: StockTarget) => void;
  onAddTarget: () => void;
  onStepPlan: (key: PlanKey, delta: number) => void;
  /** 不足を買い出しリストへ。 */
  onSendShortage: (target: StockTarget, shortage: number) => void;
  onRestock: (item: StockItem) => void;
  /** 「食べた/使った」（−1）。 */
  onUse: (item: StockItem) => void;
  onDiscard: (item: StockItem) => void;
  /** 点検した日（今日）を、ロットにまとめて記録する。 */
  onInspect: (items: StockItem[]) => void;
}

const dotted = (parts: (string | false | null | undefined)[]) => parts.filter((part) => part).join('・');
const dateText = (on: string) => formatExpiry({ expiresOn: on, expiresMonthOnly: false });

export default function StockBoard({
  items,
  targets,
  plan,
  today,
  storage,
  onStorageChange,
  onEditItem,
  onEditTarget,
  onAddTarget,
  onStepPlan,
  onSendShortage,
  onRestock,
  onUse,
  onDiscard,
  onInspect,
}: StockBoardProps) {
  const board = useMemo(() => buildStockBoard(items, targets, plan, today), [items, targets, plan, today]);
  const { counts, overview, attention } = board;
  const scrollRef = useRef<ScrollView>(null);
  const anchors = useRef<Partial<Record<Anchor, number>>>({});
  // 持ち出しのチェック表で、確かめたロット（この画面の中だけ。点検した日の記録は「点検した」で行う）。
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const jump = (anchor: Anchor) => {
    if (storage !== 'home') onStorageChange('home');
    scrollRef.current?.scrollTo({ y: Math.max(0, (anchors.current[anchor] ?? 0) - 8), animated: true });
  };

  const badges = [
    counts.short > 0 && { key: 'short', anchor: 'short' as const, text: `不足 ${counts.short}品目`, warm: true },
    counts.carryShort > 0 && {
      key: 'carry',
      anchor: 'short' as const,
      text: `持ち出し不足 ${counts.carryShort}品目`,
      warm: true,
    },
    counts.expired > 0 && { key: 'expired', anchor: 'replacement' as const, text: `期限切れ ${counts.expired}件`, warm: false },
    counts.soon > 0 && { key: 'soon', anchor: 'replacement' as const, text: `3か月以内 ${counts.soon}件`, warm: false },
    counts.inspect + (attention.bag?.due ? 1 : 0) > 0 && {
      key: 'inspect',
      anchor: 'inspect' as const,
      text: `点検の時期 ${counts.inspect + (attention.bag?.due ? 1 : 0)}件`,
      warm: true,
    },
  ].filter((badge) => badge !== false);

  const confirmDiscard = (item: StockItem) =>
    Alert.alert(`${item.name}を処分しますか？`, '備蓄から削除します。', [
      { text: 'やめる', style: 'cancel' },
      { text: '処分する', style: 'destructive', onPress: () => onDiscard(item) },
    ]);

  const lotRow = (item: StockItem, index: number, options: { showStorage?: boolean } = {}) => {
    const level = expiryLevel(item.expiresOn, today);
    const unit = unitPriceOf(item);
    const target = targets.find((row) => row.id === item.targetId);
    const price = item.price === null ? null : `${formatYen(item.price)}/${item.unit || '個'}`;
    const perUnit = unit !== null && target ? `${formatYen(unit)}/${target.unit}` : null;
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        onPress={() => onEditItem(item)}
        style={[styles.lot, index > 0 && styles.divided]}
      >
        <View style={styles.flex}>
          <View style={styles.inline}>
            {options.showStorage && item.storage === 'carry' && (
              <View style={styles.tag}>
                <Text style={styles.tagText}>{STORAGE_LABEL.carry}</Text>
              </View>
            )}
            <Text style={styles.lotName}>{item.name}</Text>
          </View>
          {(item.note !== '' || price) && (
            <Text style={styles.sub}>{dotted([item.note, price, perUnit])}</Text>
          )}
        </View>
        <View style={styles.right}>
          <Text style={styles.quantity}>
            {formatQuantity(item.quantity)}
            {item.unit}
          </Text>
          <Text style={[styles.expiry, { color: LEVEL_COLOR[level] }]}>
            {item.expiresOn ? `${level === 'expired' ? '切れ ' : ''}${formatExpiry(item)}` : '期限なし'}
          </Text>
        </View>
      </Pressable>
    );
  };

  const inspectionLine = (item: StockItem) => {
    if (item.inspectIntervalMonths === null) return '点検しない';
    const next = nextInspectionOn(item);
    return dotted([
      `${item.inspectIntervalMonths}か月ごと`,
      item.inspectedOn ? `前回 ${dateText(item.inspectedOn)}` : '未点検',
      next && `次 ${dateText(next)}`,
    ]);
  };

  const stepper = (key: PlanKey, label: string, suffix: string) => (
    <View style={styles.inline}>
      <Text style={styles.planLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}を減らす`}
        onPress={() => onStepPlan(key, -1)}
        style={styles.planButton}
      >
        <Minus size={14} color={colors.textSubtle} />
      </Pressable>
      <Text style={styles.planValue}>
        {plan[key]}
        {suffix}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}を増やす`}
        onPress={() => onStepPlan(key, 1)}
        style={styles.planButton}
      >
        <Plus size={14} color={colors.textSubtle} />
      </Pressable>
    </View>
  );

  // ---- 持ち出し: バッグの中身のチェック表 ----
  const bagLots = items.filter((item) => item.storage === 'carry' && item.quantity > 0);
  const bagByCategory = bagLots.reduce<Record<string, StockItem[]>>((groups, item) => {
    const key = item.category.trim() || 'その他';
    (groups[key] ??= []).push(item);
    return groups;
  }, {});
  const carryShortages = board.blocks.filter((block) => (block.status.carry?.shortage ?? 0) > 0);

  const carryView = (
    <>
      {attention.bag && (
        <View style={[styles.card, styles.inspectCard, attention.bag.due && styles.alertCard]}>
          <View style={styles.flex}>
            <Text style={styles.groupTitle}>{plan.carryDays}日分のバッグの点検</Text>
            <Text style={[styles.sub, attention.bag.due && styles.alertText]}>
              {attention.bag.lastOn ? `前回 ${dateText(attention.bag.lastOn)}` : '未点検'}・次 {dateText(attention.bag.nextOn)}
              {attention.bag.due ? '（時期です）' : ''}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => onInspect(bagLots)} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>点検した</Text>
          </Pressable>
        </View>
      )}
      {carryShortages.length > 0 && (
        <View style={[styles.card, styles.alertCard, styles.cardPad]}>
          <Text style={[styles.groupTitle, styles.alertText]}>足りないもの</Text>
          {carryShortages.map(({ status }) => (
            <Text key={status.target.id} style={styles.alertLine}>
              {status.target.name} {formatQuantity(status.carry?.have ?? 0)} / {formatQuantity(status.carry?.required ?? 0)}
              {status.target.unit}
            </Text>
          ))}
        </View>
      )}
      {bagLots.length === 0 ? (
        <Text style={styles.empty}>持ち出しバッグには何も入っていません</Text>
      ) : (
        Object.entries(bagByCategory).map(([category, rows]) => (
          <View key={category}>
            <Text style={styles.sectionLabel}>{category}</Text>
            <View style={styles.card}>
              {rows.map((item, index) => {
                const on = checked.has(item.id);
                const level = expiryLevel(item.expiresOn, today);
                return (
                  <View key={item.id} style={[styles.lot, index > 0 && styles.divided]}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${item.name}を確かめた`}
                      onPress={() =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                      hitSlop={6}
                      style={[styles.box, on && styles.boxOn]}
                    >
                      {on && <Check size={14} color={colors.primaryText} />}
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => onEditItem(item)} style={styles.lotBody}>
                      <Text style={[styles.lotName, styles.flex]}>{item.name}</Text>
                      <Text style={styles.quantity}>
                        {formatQuantity(item.quantity)}
                        {item.unit}
                      </Text>
                      <Text style={[styles.expiry, styles.checkExpiry, { color: LEVEL_COLOR[level] }]}>
                        {item.expiresOn ? formatExpiry(item) : '—'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        ))
      )}
      {bagLots.length > 0 && <Text style={styles.footnote}>チェックはこの画面の中だけ。「点検した」で日付を残します</Text>}
    </>
  );

  // ---- 寝室: 要対応 → 目標ごとの塊 → その他 → 備品 ----
  const hasAttention =
    attention.short.length > 0 ||
    attention.replacement.lots.length > 0 ||
    attention.inspect.length > 0 ||
    attention.bag?.due === true;

  const homeView = (
    <>
      {hasAttention && <Text style={styles.heading}>要対応</Text>}

      {attention.short.length > 0 && (
        <View onLayout={(event) => (anchors.current.short = event.nativeEvent.layout.y)}>
          <Text style={styles.groupHeading}>足りないもの {attention.short.length}品目</Text>
          <View style={styles.card}>
            {attention.short.map(({ status, cost }, index) => {
              const { target, shortage, carry } = status;
              return (
                <View key={target.id} style={[styles.attention, index > 0 && styles.divided]}>
                  <View style={styles.flex}>
                    <Text style={styles.lotName}>{target.name}</Text>
                    <Text style={[styles.sub, styles.alertText]}>
                      {dotted([
                        shortage > 0 && `あと${formatQuantity(shortage)}${target.unit}不足`,
                        carry && carry.shortage > 0 && `持ち出し あと${formatQuantity(carry.shortage)}${target.unit}`,
                      ])}
                    </Text>
                    <Text style={styles.sub}>
                      {cost.shortageCost !== null && shortage > 0
                        ? `買い足し ${formatYen(cost.shortageCost)}`
                        : cost.unitPrice === null
                          ? '値段未登録'
                          : ''}
                    </Text>
                  </View>
                  {shortage > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${target.name}の不足を買い出しリストへ`}
                      onPress={() => onSendShortage(target, shortage)}
                      style={styles.toList}
                    >
                      <ListPlus size={16} color={colors.alertText} />
                      <Text style={styles.toListText}>リストへ</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {attention.replacement.lots.length > 0 && (
        <View onLayout={(event) => (anchors.current.replacement = event.nativeEvent.layout.y)}>
          <Text style={styles.groupHeading}>
            期限が近い・切れた {attention.replacement.lots.length}件
            {attention.replacement.total > 0 ? `・買い替え見込み ${formatYen(attention.replacement.total)}` : ''}
            {attention.replacement.unpriced > 0 ? `（値段未登録 ${attention.replacement.unpriced}件は含まず）` : ''}
          </Text>
          <View style={styles.card}>
            {attention.replacement.lots.map(({ item, level, amount }, index) => (
              <View key={item.id} style={[styles.attentionBlock, index > 0 && styles.divided]}>
                <Pressable accessibilityRole="button" onPress={() => onEditItem(item)} style={styles.attention}>
                  <View style={styles.flex}>
                    <View style={styles.inline}>
                      {item.storage === 'carry' && (
                        <View style={styles.tag}>
                          <Text style={styles.tagText}>{STORAGE_LABEL.carry}</Text>
                        </View>
                      )}
                      <Text style={styles.lotName}>{item.name}</Text>
                    </View>
                    <Text style={styles.sub}>{item.note}</Text>
                  </View>
                  <View style={styles.right}>
                    <Text style={styles.quantity}>
                      {formatQuantity(item.quantity)}
                      {item.unit}
                    </Text>
                    <Text style={[styles.expiry, { color: LEVEL_COLOR[level] }]}>
                      {level === 'expired' ? '切れ ' : ''}
                      {formatExpiry(item)}
                    </Text>
                    <Text style={styles.expiry}>
                      {amount === null ? '値段未登録' : <Text style={styles.money}>{formatYen(amount)}</Text>}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" onPress={() => onRestock(item)} style={styles.primaryButton}>
                    <Text style={styles.primaryButtonText}>買い替えた</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => onUse(item)} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>食べた・使った −1</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => confirmDiscard(item)} style={styles.secondaryButton}>
                    <Text style={[styles.secondaryButtonText, styles.dangerText]}>処分</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {(attention.inspect.length > 0 || attention.bag?.due) && (
        <View onLayout={(event) => (anchors.current.inspect = event.nativeEvent.layout.y)}>
          <Text style={styles.groupHeading}>点検の時期</Text>
          <View style={styles.card}>
            {attention.bag?.due && (
              <View style={styles.attention}>
                <View style={styles.flex}>
                  <Text style={styles.lotName}>持ち出しバッグ</Text>
                  <Text style={styles.sub}>
                    {attention.bag.lastOn ? `前回 ${dateText(attention.bag.lastOn)}` : '未点検'}・中身を確かめましょう
                  </Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => onStorageChange('carry')} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>チェック表へ</Text>
                </Pressable>
              </View>
            )}
            {attention.inspect.map((item, index) => (
              <View key={item.id} style={[styles.attention, (index > 0 || attention.bag?.due) && styles.divided]}>
                <Pressable accessibilityRole="button" onPress={() => onEditItem(item)} style={styles.flex}>
                  <Text style={styles.lotName}>{item.name}</Text>
                  <Text style={styles.sub}>{inspectionLine(item)}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => onInspect([item])} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>点検した</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.planRow}>
        <Text style={styles.heading}>目標ごとの備え</Text>
        <View style={styles.planSteppers}>
          {stepper('people', '人数', '人')}
          {stepper('days', '日数', '日')}
          {stepper('carryDays', '持ち出し', '日')}
        </View>
      </View>

      {board.blocks.map(({ status, cost, lots }) => {
        const { target, required, have, shortage, carry } = status;
        const homeLots = lots.filter((item) => item.storage === 'home');
        const ratio = required > 0 ? Math.min(1, have / required) : 1;
        const rule = target.perPersonDay
          ? `1人1日 ${formatQuantity(target.quantity)}${target.unit}・${plan.people}人で ${formatQuantity(cost.daily ?? 0)}${target.unit}/日`
          : '決まった数';
        return (
          <View key={target.id} style={[styles.card, shortage > 0 && styles.shortCard]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${target.name}の必要数を直す`}
              onPress={() => onEditTarget(target)}
              style={styles.blockHead}
            >
              <View style={styles.inline}>
                <Text style={[styles.blockName, styles.flex]}>{target.name}</Text>
                <Text style={styles.quantity}>
                  {formatQuantity(have)} / {formatQuantity(required)}
                  {target.unit}
                </Text>
              </View>
              <View style={styles.bar}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${Math.round(ratio * 100)}%`, backgroundColor: shortage > 0 ? colors.alertText : colors.doneText },
                  ]}
                />
              </View>
              <Text style={styles.sub}>{dotted([rule, target.note])}</Text>
              <Text style={[styles.sub, shortage > 0 ? styles.alertText : styles.okText]}>
                {shortage > 0 ? `あと${formatQuantity(shortage)}${target.unit} 不足` : '足りています'}
                {carry
                  ? `・持ち出し ${formatQuantity(carry.have)} / ${formatQuantity(carry.required)}${target.unit}${carry.shortage > 0 ? ' 不足' : ''}`
                  : ''}
              </Text>
              <Text style={styles.sub}>
                {cost.unitPrice === null
                  ? '値段未登録'
                  : dotted([
                      `${plan.days}日分 ${formatYen(cost.total ?? 0)}`,
                      shortage > 0 && `買い足し ${formatYen(cost.shortageCost ?? 0)}`,
                      `${target.unit}あたり ${formatYen(cost.unitPrice)}`,
                    ])}
              </Text>
            </Pressable>
            {homeLots.length === 0 ? (
              <Text style={styles.emptyLot}>寝室にはありません</Text>
            ) : (
              homeLots.map((item) => lotRow(item, 1))
            )}
          </View>
        );
      })}

      {board.others.length > 0 && (
        <View>
          <Text style={styles.sectionLabel}>その他の備品</Text>
          <View style={styles.card}>
            {board.others.filter((item) => item.storage === 'home').map((item, index) => lotRow(item, index))}
          </View>
        </View>
      )}

      {board.equipment.length > 0 && (
        <View>
          <View style={styles.equipmentHead}>
            <Text style={[styles.sectionLabel, styles.flex]}>備品（期限なし）</Text>
            {board.equipment.some((item) => item.inspectIntervalMonths !== null) && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onInspect(board.equipment.filter((item) => item.inspectIntervalMonths !== null))}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>まとめて点検した</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.card}>
            {board.equipment.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => onEditItem(item)}
                style={[styles.lot, index > 0 && styles.divided]}
              >
                <View style={styles.flex}>
                  <View style={styles.inline}>
                    {item.storage === 'carry' && (
                      <View style={styles.tag}>
                        <Text style={styles.tagText}>{STORAGE_LABEL.carry}</Text>
                      </View>
                    )}
                    <Text style={styles.lotName}>{item.name}</Text>
                  </View>
                  <Text
                    style={[
                      styles.sub,
                      item.inspectIntervalMonths !== null && nextInspectionOn(item)! <= today && styles.alertText,
                    ]}
                  >
                    {dotted([item.category, inspectionLine(item)])}
                  </Text>
                </View>
                <Text style={styles.quantity}>
                  {formatQuantity(item.quantity)}
                  {item.unit}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <Pressable accessibilityRole="button" onPress={onAddTarget} style={styles.addTarget}>
        <Plus size={14} color={colors.navActiveText} />
        <Text style={styles.addTargetText}>目標（必要数）を追加</Text>
      </Pressable>
    </>
  );

  return (
    <>
      <View style={styles.status}>
        {badges.length === 0 ? (
          <Text style={styles.calm}>不足も、期限が近いものも、点検の時期のものもありません</Text>
        ) : (
          <View style={styles.badges}>
            {badges.map((badge) => (
              <Pressable
                key={badge.key}
                accessibilityRole="button"
                accessibilityLabel={`${badge.text}の要対応へ`}
                onPress={() => jump(badge.anchor)}
                style={[styles.badge, badge.warm ? styles.badgeWarm : styles.badgeAlert]}
              >
                <Text style={[styles.badgeText, badge.warm ? styles.warmText : styles.alertText]}>{badge.text}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.costLine}>
          {plan.people}人×{plan.days}日分を揃える {formatYen(overview.total)}・足りない分の買い足し{' '}
          {formatYen(overview.shortageTotal)}
          {overview.unpricedTargets > 0 ? `（値段未登録 ${overview.unpricedTargets}品目は含まず）` : ''}
        </Text>
      </View>

      <SegmentedTabs
        options={STORAGE_OPTIONS}
        value={storage}
        onChange={onStorageChange}
        accessibilityLabel="保管場所"
        style={styles.tabs}
      />

      <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.content}>
        {storage === 'home' ? homeView : carryView}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  badgeAlert: { backgroundColor: colors.alertSurface },
  badgeWarm: { backgroundColor: colors.temperatureSurface },
  badgeText: { fontSize: 12, fontWeight: '700' },
  alertText: { color: colors.alertText },
  warmText: { color: colors.temperatureText },
  okText: { color: colors.doneText },
  dangerText: { color: colors.danger },
  calm: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  costLine: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  tabs: { marginHorizontal: 16, marginBottom: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  heading: { fontSize: 15, fontWeight: '700', color: colors.text },
  groupHeading: { fontSize: 12, fontWeight: '700', color: colors.alertText, marginBottom: 6 },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardPad: { padding: 12, gap: 4 },
  shortCard: { borderColor: colors.alertSurface },
  alertCard: { backgroundColor: colors.dangerSurface },
  inspectCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  alertLine: { fontSize: 13, fontWeight: '700', color: colors.alertText, fontVariant: ['tabular-nums'] },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  attention: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  attentionBlock: { paddingBottom: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12 },
  primaryButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.navActive },
  primaryButtonText: { fontSize: 12, fontWeight: '700', color: colors.primaryText },
  secondaryButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.neutralSurface },
  secondaryButtonText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  toList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: colors.alertSurface,
  },
  toListText: { fontSize: 12, fontWeight: '700', color: colors.alertText },
  planRow: { gap: 6, marginTop: 4 },
  planSteppers: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  planLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  planButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  planValue: {
    minWidth: 32,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  blockHead: { paddingHorizontal: 12, paddingVertical: 10, gap: 4, backgroundColor: colors.surface },
  blockName: { fontSize: 15, fontWeight: '700', color: colors.text },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.neutralSurface, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  lot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  lotBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  lotName: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  quantity: { fontSize: 13, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  expiry: { fontSize: 11, fontWeight: '700', marginTop: 2, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  checkExpiry: { minWidth: 64, textAlign: 'right' },
  money: { fontSize: 11, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  tag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: colors.diaperSurface },
  tagText: { fontSize: 10, fontWeight: '700', color: colors.diaperText },
  emptyLot: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textFaint,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  equipmentHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  addTarget: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10 },
  addTargetText: { fontSize: 12, fontWeight: '700', color: colors.navActiveText },
  footnote: { fontSize: 11, fontWeight: '500', color: colors.textFaint, textAlign: 'center' },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.doneText, borderColor: colors.doneText },
});
