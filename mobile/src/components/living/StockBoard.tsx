import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Check,
  ClipboardCheck,
  Clock,
  ListPlus,
  Minus,
  PackageCheck,
  Pencil,
  Plus,
  Settings2,
  ShoppingCart,
  Trash2,
  Utensils,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import type { StockItem, StockTarget } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  buildStockBoard,
  daysBetween,
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  nextInspectionOn,
  spanText,
  STORAGE_LABEL,
  type ExpiryLevel,
  type StockPlan,
  type StockStorage,
} from '@/lib/stockUtils';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import StockTargetDetail from './StockTargetDetail';
import { readinessColor, Ring, StockIcon, TONE } from './stockVisual';

// 防災備蓄の画面（docs/home.md §10.2・§10.2.1）。状態を見渡す「点検盤」。
// PWA版の `src/components/sukusuku/living/StockBoard.tsx` と同じ構成・項目・文言にしてある。
//
// 文字の一覧ではなく、図で読む画面にする:
//   上（固定）: 期限・不足・点検の3つの状況タイルと、保管場所（寝室／持ち出し）の切り替え。
//   中（スクロール）: 備え度のリング → 期限の見通し → 要対応 → 目標のタイル → 備品のタイル。
//   持ち出しは、バッグの中身を押して確かめるチェック表。
// 費用・ロットは目標のタイルを押した詳しい画面（StockTargetDetail）に置く。

const STORAGE_OPTIONS: { id: StockStorage; label: string }[] = [
  { id: 'home', label: STORAGE_LABEL.home },
  { id: 'carry', label: STORAGE_LABEL.carry },
];

type PlanKey = keyof StockPlan;
type Anchor = 'replacement' | 'short' | 'inspect';

/** 要対応の束で、初めから出すカードの数（残りは「ほかn件を見る」）。 */
const ATTENTION_LIMIT = 3;

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

const dateText = (on: string) => formatExpiry({ expiresOn: on, expiresMonthOnly: false });

/** 期限の言い方の色。 */
const COUNTDOWN: Record<ExpiryLevel, { bg: string; fg: string }> = {
  expired: { bg: colors.dangerSurface, fg: colors.alertText },
  soon: { bg: colors.dangerSurface, fg: colors.alertText },
  year: { bg: colors.neutralSurface, fg: colors.textSubtle },
  ok: { bg: colors.neutralSurface, fg: colors.textMuted },
  none: { bg: colors.neutralSurface, fg: colors.textFaint },
};

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
  const { counts, overview, attention, readiness } = board;
  const scrollRef = useRef<ScrollView>(null);
  // 要対応の束の位置（要対応の見出しの位置＋束の位置）。
  const anchors = useRef<{ wrap: number } & Partial<Record<Anchor, number>>>({ wrap: 0 });
  // 持ち出しのチェック表で、確かめたロット（この画面の中だけ。点検した日の記録は「点検完了」で行う）。
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showPlan, setShowPlan] = useState(false);
  const [expanded, setExpanded] = useState<Set<Anchor>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const bagDue = attention.bag?.due === true;
  const inspectCount = counts.inspect + (bagDue ? 1 : 0);
  const expiryCount = counts.expired + counts.soon;
  const shortCount = attention.short.length;

  const jump = (anchor: Anchor) => {
    if (storage !== 'home') onStorageChange('home');
    const y = (anchors.current.wrap ?? 0) + (anchors.current[anchor] ?? 0);
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }), 50);
  };

  const confirmDiscard = (item: StockItem) =>
    Alert.alert(`${item.name}を処分しますか？`, '備蓄から削除します。', [
      { text: 'やめる', style: 'cancel' },
      { text: '処分する', style: 'destructive', onPress: () => onDiscard(item) },
    ]);

  // ---- 上の3つの状況タイル ----
  const statusTile = (anchor: Anchor, label: string, count: number, tone: 'alert' | 'warn', Icon: LucideIcon) => {
    const active = count > 0;
    const palette = !active
      ? { bg: colors.surface, border: colors.border, fg: colors.borderStrong }
      : tone === 'alert'
        ? { bg: colors.surface, border: '#fca5a5', fg: colors.alertText }
        : { bg: colors.surface, border: colors.borderStrong, fg: colors.text };
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? `${label} ${count}件の要対応へ` : `${label}は問題ありません`}
        disabled={!active}
        onPress={() => jump(anchor)}
        style={[styles.statusTile, { backgroundColor: palette.bg, borderColor: palette.border }]}
      >
        {active ? <Icon size={20} color={palette.fg} strokeWidth={2.4} /> : <Check size={20} color={palette.fg} strokeWidth={2.8} />}
        <View>
          <Text style={[styles.statusCount, { color: palette.fg }]}>{count}</Text>
          <Text style={[styles.statusLabel, { color: palette.fg }]}>{label}</Text>
        </View>
      </Pressable>
    );
  };

  // ---- 備え度のリング ----
  const ringColor = readinessColor(readiness);
  const hero = (
    <View style={styles.card}>
      <View style={styles.heroRow}>
        <Ring size={104} stroke={11} ratio={readiness / 100} color={ringColor}>
          <View style={styles.ringCenter}>
            <Text style={[styles.ringValue, { color: ringColor }]}>
              {readiness}
              <Text style={styles.ringPercent}>%</Text>
            </Text>
            <Text style={styles.ringLabel}>備え度</Text>
          </View>
        </Ring>
        <View style={styles.flex}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showPlan }}
            onPress={() => setShowPlan((prev) => !prev)}
            style={styles.planChip}
          >
            <Text style={styles.planChipText}>
              {plan.people}人 × {plan.days}日分
            </Text>
            <Settings2 size={13} color={colors.textSubtle} />
          </Pressable>
          {overview.shortageTotal > 0 ? (
            <Text style={styles.heroLine}>
              あと <Text style={styles.heroMoney}>{formatYen(overview.shortageTotal)}</Text> で揃う
            </Text>
          ) : (
            <Text style={styles.heroLine}>
              {overview.unpricedTargets > 0 ? '値段を入れると費用が出ます' : '必要な量が揃っています'}
            </Text>
          )}
          {overview.total > 0 && (
            <Text style={styles.heroSub}>
              全部で {formatYen(overview.total)}
              {overview.unpricedTargets > 0 ? `（未登録 ${overview.unpricedTargets}品目を除く）` : ''}
            </Text>
          )}
        </View>
      </View>
      {showPlan && (
        <View style={styles.planPanel}>
          {(
            [
              ['people', '人数', '人'],
              ['days', '日数', '日'],
              ['carryDays', 'バッグ', '日'],
            ] as [PlanKey, string, string][]
          ).map(([key, label, suffix]) => (
            <View key={key} style={styles.stepper}>
              <Text style={styles.stepperLabel}>{label}</Text>
              <View style={styles.inline}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label}を減らす`}
                  onPress={() => onStepPlan(key, -1)}
                  style={styles.stepButton}
                >
                  <Minus size={14} color={colors.textSubtle} />
                </Pressable>
                <Text style={styles.stepValue}>
                  {plan[key]}
                  {suffix}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label}を増やす`}
                  onPress={() => onStepPlan(key, 1)}
                  style={styles.stepButton}
                >
                  <Plus size={14} color={colors.textSubtle} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  // ---- 期限の見通し（1本の帯） ----
  const mix = [
    { key: 'expired', label: '切れ', count: counts.expired, color: '#dc2626' },
    { key: 'soon', label: '3か月内', count: counts.soon, color: '#374151' },
    { key: 'year', label: '1年内', count: counts.year, color: '#9ca3af' },
    { key: 'ok', label: 'それ以降', count: counts.ok, color: '#d1d5db' },
  ].filter((entry) => entry.count > 0);
  const mixTotal = mix.reduce((sum, entry) => sum + entry.count, 0);
  const outlook = mixTotal > 0 && (
    <View style={[styles.card, styles.cardPad]}>
      <Text style={styles.cardTitle}>期限の見通し</Text>
      <View style={styles.mixBar}>
        {mix.map((entry) => (
          <View key={entry.key} style={{ flex: entry.count, backgroundColor: entry.color }} />
        ))}
      </View>
      <View style={styles.legend}>
        {mix.map((entry) => (
          <View key={entry.key} style={styles.inline}>
            <View style={[styles.dot, { backgroundColor: entry.color }]} />
            <Text style={styles.legendText}>
              {entry.label} {entry.count}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );

  // ---- 要対応のカード ----
  const bubble = (item: { name: string; category: string }, fg: string, bg: string) => (
    <View style={[styles.bubble, { backgroundColor: bg }]}>
      <StockIcon name={item.name} category={item.category} size={22} color={fg} />
    </View>
  );

  const countdownChip = (item: StockItem) => {
    if (!item.expiresOn) return null;
    const tone = COUNTDOWN[expiryLevel(item.expiresOn, today)];
    return (
      <View style={[styles.chip, { backgroundColor: tone.bg }]}>
        <Text style={[styles.chipText, { color: tone.fg }]}>{expiryCountdown(item.expiresOn, today)}</Text>
      </View>
    );
  };

  const attentionBlock = (anchor: Anchor, title: string, tone: string, children: ReactNode[]) => {
    const open = expanded.has(anchor);
    const rows = open ? children : children.slice(0, ATTENTION_LIMIT);
    return (
      <View onLayout={(event) => (anchors.current[anchor] = event.nativeEvent.layout.y)} style={styles.block}>
        <Text style={[styles.blockTitle, { color: tone }]}>{title}</Text>
        {rows}
        {children.length > ATTENTION_LIMIT && (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (open) next.delete(anchor);
                else next.add(anchor);
                return next;
              })
            }
            style={styles.more}
          >
            <Text style={styles.moreText}>{open ? '閉じる' : `ほか${children.length - ATTENTION_LIMIT}件を見る`}</Text>
          </Pressable>
        )}
      </View>
    );
  };

  const actionButton = (label: string, onPress: () => void, Icon: LucideIcon, kind: 'main' | 'sub' | 'danger') => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.action, kind === 'main' ? styles.actionMain : styles.actionSub]}
    >
      <Icon size={14} color={kind === 'main' ? colors.primaryText : colors.textSubtle} />
      <Text
        style={[
          styles.actionText,
          { color: kind === 'main' ? colors.primaryText : colors.textSubtle },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  const bagInspectionAge = attention.bag?.lastOn
    ? `${spanText(daysBetween(attention.bag.lastOn, today))}前に点検`
    : 'まだ点検していません';

  const attentionView = (
    <View
      onLayout={(event) => (anchors.current.wrap = event.nativeEvent.layout.y)}
      style={styles.attentionWrap}
    >
      <Text style={styles.sectionTitle}>要対応</Text>

      {attention.replacement.lots.length > 0 &&
        attentionBlock(
          'replacement',
          `期限が近い・切れた${attention.replacement.total > 0 ? `　見込み ${formatYen(attention.replacement.total)}` : ''}`,
          colors.text,
          attention.replacement.lots.map(({ item, amount }) => (
            <View
              key={item.id}
              style={styles.card}
            >
              <Pressable accessibilityRole="button" onPress={() => onEditItem(item)} style={styles.cardTop}>
                {bubble(item, colors.textSubtle, colors.neutralSurface)}
                <View style={styles.flex}>
                  <View style={styles.inline}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.storage === 'carry' && (
                      <View style={styles.tag}>
                        <Text style={styles.tagText}>{STORAGE_LABEL.carry}</Text>
                      </View>
                    )}
                  </View>
                  <View style={[styles.inline, styles.gapTop]}>
                    {countdownChip(item)}
                    <Text style={styles.qty}>
                      {formatQuantity(item.quantity)}
                      {item.unit}
                    </Text>
                  </View>
                </View>
                {amount === null ? (
                  <Text style={styles.unpriced}>値段未登録</Text>
                ) : (
                  <Text style={styles.amount}>{formatYen(amount)}</Text>
                )}
              </Pressable>
              <View style={styles.actions}>
                {actionButton('買い替え', () => onRestock(item), PackageCheck, 'main')}
                {actionButton('使った', () => onUse(item), Utensils, 'sub')}
                {actionButton('処分', () => confirmDiscard(item), Trash2, 'danger')}
              </View>
            </View>
          )),
        )}

      {attention.short.length > 0 &&
        attentionBlock(
          'short',
          '足りないもの',
          colors.text,
          attention.short.map(({ status, cost }) => {
            const { target, required, have, shortage, carry } = status;
            const ratio = required > 0 ? have / required : 1;
            return (
              <View key={target.id} style={[styles.card, styles.cardTop]}>
                {bubble(target, colors.textSubtle, colors.neutralSurface)}
                <View style={styles.flex}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {target.name}
                  </Text>
                  <View style={styles.miniBar}>
                    <View style={[styles.miniFill, { width: `${Math.round(Math.min(1, ratio) * 100)}%` }]} />
                  </View>
                  <Text style={styles.shortText}>
                    {shortage > 0
                      ? `あと${formatQuantity(shortage)}${target.unit}`
                      : carry
                        ? `バッグにあと${formatQuantity(carry.shortage)}${target.unit}`
                        : ''}
                    {cost.shortageCost !== null && shortage > 0 ? `　${formatYen(cost.shortageCost)}` : ''}
                  </Text>
                </View>
                {shortage > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${target.name}の不足を買い出しリストへ`}
                    onPress={() => onSendShortage(target, shortage)}
                    style={styles.toList}
                  >
                    <ListPlus size={18} color={colors.primaryText} />
                    <Text style={styles.toListText}>リストへ</Text>
                  </Pressable>
                )}
              </View>
            );
          }),
        )}

      {(attention.inspect.length > 0 || bagDue) &&
        attentionBlock('inspect', '点検の時期', colors.text, [
          ...(attention.bag?.due
            ? [
                <View key="bag" style={[styles.card, styles.cardTop]}>
                  {bubble({ name: 'バッグ', category: '' }, colors.textSubtle, colors.neutralSurface)}
                  <View style={styles.flex}>
                    <Text style={styles.cardName}>持ち出しバッグ</Text>
                    <Text style={styles.warnText}>{bagInspectionAge}</Text>
                  </View>
                  {actionButton('確かめる', () => onStorageChange('carry'), ClipboardCheck, 'main')}
                </View>,
              ]
            : []),
          ...attention.inspect.map((item) => (
            <View key={item.id} style={[styles.card, styles.cardTop]}>
              <Pressable accessibilityRole="button" onPress={() => onEditItem(item)} style={[styles.inline, styles.flex, { gap: 12 }]}>
                {bubble(item, colors.textSubtle, colors.neutralSurface)}
                <View style={styles.flex}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.warnText}>
                    {item.inspectedOn ? `${spanText(daysBetween(item.inspectedOn, today))}前に点検` : '未点検'}
                  </Text>
                </View>
              </Pressable>
              {actionButton('点検した', () => onInspect([item]), Check, 'main')}
            </View>
          )),
        ])}
    </View>
  );

  // ---- 目標のタイル ----
  const targetTile = ({ status }: (typeof board.blocks)[number]) => {
    const { target, required, have, shortage, carry } = status;
    const ratio = required > 0 ? have / required : 1;
    const color = shortage > 0 ? TONE.alert : carry && carry.shortage > 0 ? TONE.warn : TONE.ok;
    return (
      <Pressable
        key={target.id}
        accessibilityRole="button"
        accessibilityLabel={`${target.name}の詳しい画面を開く`}
        onPress={() => setDetailId(target.id)}
        style={styles.tile2}
      >
        <Ring size={64} stroke={7} ratio={ratio} color={color}>
          <StockIcon name={target.name} category={target.category} size={26} color={color} />
        </Ring>
        <Text style={styles.tileName} numberOfLines={1}>
          {target.name}
        </Text>
        <Text style={styles.tileQty}>
          {formatQuantity(have)} / {formatQuantity(required)}
          {target.unit}
        </Text>
        <View style={[styles.chip, { backgroundColor: shortage > 0 ? colors.dangerSurface : colors.neutralSurface }]}>
          <Text style={[styles.chipText, { color: shortage > 0 ? colors.alertText : colors.textMuted }]}>
            {shortage > 0 ? `あと${formatQuantity(shortage)}${target.unit}` : '足りてる'}
          </Text>
        </View>
        {carry && (
          <Text style={[styles.tileBag, carry.shortage > 0 && { color: colors.alertText }]}>
            バッグ {formatQuantity(carry.have)}/{formatQuantity(carry.required)}
          </Text>
        )}
      </Pressable>
    );
  };

  // ---- 備品・その他のタイル ----
  const itemTile = (item: StockItem, chip: { text: string; bg: string; fg: string }) => (
    <Pressable key={item.id} accessibilityRole="button" onPress={() => onEditItem(item)} style={styles.tile3}>
      <View style={styles.tileIcon}>
        <StockIcon name={item.name} category={item.category} size={24} color={colors.textSubtle} />
      </View>
      <Text style={styles.itemName} numberOfLines={2}>
        {item.name}
      </Text>
      <View style={[styles.chip, { backgroundColor: chip.bg }]}>
        <Text style={[styles.chipText, { color: chip.fg }]}>{chip.text}</Text>
      </View>
    </Pressable>
  );

  const equipmentChip = (item: StockItem) => {
    const none = { text: '点検なし', bg: colors.neutralSurface, fg: colors.textFaint };
    if (item.inspectIntervalMonths === null) return none;
    const next = nextInspectionOn(item);
    if (next === null) return none;
    if (next <= today) return { text: '点検の時期', bg: colors.dangerSurface, fg: colors.alertText };
    return { text: `点検まで${spanText(daysBetween(today, next))}`, bg: colors.neutralSurface, fg: colors.textMuted };
  };

  const homeOthers = board.others.filter((item) => item.storage === 'home');
  const hasAttention = expiryCount > 0 || shortCount > 0 || inspectCount > 0;

  const homeView = (
    <>
      {hero}
      {outlook}
      {hasAttention && attentionView}
      <View style={styles.block}>
        <Text style={styles.sectionTitle}>目標ごとの備え</Text>
        <View style={styles.grid}>{board.blocks.map(targetTile)}</View>
        <Pressable accessibilityRole="button" onPress={onAddTarget} style={styles.addTarget}>
          <Plus size={14} color={colors.textSubtle} />
          <Text style={styles.addTargetText}>目標（必要数）を追加</Text>
        </Pressable>
      </View>

      {homeOthers.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>その他の備蓄</Text>
          <View style={styles.grid}>
            {homeOthers.map((item) => {
              const tone = item.expiresOn ? COUNTDOWN[expiryLevel(item.expiresOn, today)] : COUNTDOWN.none;
              return itemTile(item, {
                text: item.expiresOn ? expiryCountdown(item.expiresOn, today) : '期限なし',
                bg: tone.bg,
                fg: tone.fg,
              });
            })}
          </View>
        </View>
      )}

      {board.equipment.length > 0 && (
        <View style={styles.block}>
          <View style={styles.inline}>
            <Text style={[styles.sectionTitle, styles.flex]}>備品（期限なし）</Text>
            {board.equipment.some((item) => item.inspectIntervalMonths !== null) && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onInspect(board.equipment.filter((item) => item.inspectIntervalMonths !== null))}
                style={styles.bulk}
              >
                <Wrench size={13} color={colors.textSubtle} />
                <Text style={styles.bulkText}>まとめて点検した</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.grid}>{board.equipment.map((item) => itemTile(item, equipmentChip(item)))}</View>
        </View>
      )}
    </>
  );

  // ---- 持ち出し: バッグの中身を押して確かめる ----
  const bagLots = items.filter((item) => item.storage === 'carry' && item.quantity > 0);
  const doneCount = bagLots.filter((item) => checked.has(item.id)).length;
  const allChecked = bagLots.length > 0 && doneCount === bagLots.length;
  const carryShortages = board.blocks.filter((block) => (block.status.carry?.shortage ?? 0) > 0);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const carryView = (
    <>
      <View style={[styles.card, styles.heroRow, { borderColor: colors.border }]}>
        <Ring
          size={88}
          stroke={10}
          ratio={bagLots.length === 0 ? 0 : doneCount / bagLots.length}
          color={allChecked ? TONE.ok : TONE.accent}
        >
          <View style={styles.ringCenter}>
            <Text style={styles.bagValue}>
              {doneCount}
              <Text style={styles.bagTotal}>/{bagLots.length}</Text>
            </Text>
            <Text style={styles.ringLabel}>確認</Text>
          </View>
        </Ring>
        <View style={styles.flex}>
          <Text style={styles.cardName}>{plan.carryDays}日分のバッグ</Text>
          <Text style={[styles.bagAge, attention.bag?.due && { color: colors.alertText }]}>
            {attention.bag ? bagInspectionAge : 'バッグは空です'}
          </Text>
          {attention.bag && (
            <Text style={styles.heroSub}>
              {attention.bag.due ? '点検の時期です' : `次は ${dateText(attention.bag.nextOn)} ごろ`}
            </Text>
          )}
        </View>
      </View>

      {carryShortages.length > 0 && (
        <View style={styles.shortBox}>
          <Text style={styles.shortBoxTitle}>足りないもの</Text>
          <View style={styles.legend}>
            {carryShortages.map(({ status }) => (
              <View key={status.target.id} style={styles.shortPill}>
                <Text style={styles.shortPillText}>
                  {status.target.name} あと{formatQuantity(status.carry?.shortage ?? 0)}
                  {status.target.unit}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {bagLots.length === 0 ? (
        <Text style={styles.empty}>持ち出しバッグには何も入っていません</Text>
      ) : (
        <View style={styles.grid}>
          {bagLots.map((item) => {
            const on = checked.has(item.id);
            const tone = item.expiresOn ? COUNTDOWN[expiryLevel(item.expiresOn, today)] : null;
            return (
              <View key={item.id} style={[styles.bagTile, on && styles.bagTileOn]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${item.name}を確かめた`}
                  onPress={() => toggle(item.id)}
                  style={styles.bagBody}
                >
                  <View style={[styles.tileIcon, on && { backgroundColor: TONE.accent }]}>
                    {on ? (
                      <Check size={26} color={colors.primaryText} strokeWidth={3} />
                    ) : (
                      <StockIcon name={item.name} category={item.category} size={24} color={colors.textSubtle} />
                    )}
                  </View>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.bagQty}>
                    {formatQuantity(item.quantity)}
                    {item.unit}
                  </Text>
                  {item.expiresOn && tone && (
                    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
                      <Text style={[styles.chipText, { color: tone.fg }]}>{expiryCountdown(item.expiresOn, today)}</Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}を編集`}
                  onPress={() => onEditItem(item)}
                  hitSlop={6}
                  style={styles.bagEdit}
                >
                  <Pencil size={13} color={colors.textFaint} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </>
  );

  const detail = board.blocks.find((block) => block.status.target.id === detailId) ?? null;

  return (
    <>
      <View style={styles.statusRow}>
        {statusTile('replacement', '期限', expiryCount, 'alert', Clock)}
        {statusTile('short', '不足', shortCount, 'alert', ShoppingCart)}
        {statusTile('inspect', '点検', inspectCount, 'warn', Wrench)}
      </View>

      <SegmentedTabs
        options={STORAGE_OPTIONS}
        value={storage}
        onChange={onStorageChange}
        accessibilityLabel="保管場所"
        style={styles.tabs}
      />

      <View style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.content, storage === 'carry' && bagLots.length > 0 && styles.contentWithFooter]}
        >
          {storage === 'home' ? homeView : carryView}
        </ScrollView>
        {storage === 'carry' && bagLots.length > 0 && (
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={!allChecked}
              onPress={() => {
                onInspect(bagLots);
                setChecked(new Set());
              }}
              style={[styles.finish, allChecked && styles.finishOn]}
            >
              <Text style={[styles.finishText, allChecked && { color: colors.primaryText }]}>
                {allChecked ? '点検完了（今日の日付を残す）' : `あと${bagLots.length - doneCount}つ確かめましょう`}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {detail && (
        <StockTargetDetail
          status={detail.status}
          cost={detail.cost}
          lots={detail.lots}
          plan={plan}
          today={today}
          onClose={() => setDetailId(null)}
          onEditTarget={() => {
            setDetailId(null);
            onEditTarget(detail.status.target);
          }}
          onEditItem={(item) => {
            setDetailId(null);
            onEditItem(item);
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gapTop: { marginTop: 4 },
  statusRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  statusTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusCount: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statusLabel: { fontSize: 11, fontWeight: '700', opacity: 0.85 },
  tabs: { marginHorizontal: 16, marginBottom: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  contentWithFooter: { paddingBottom: 96 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardPad: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  cardTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  cardName: { fontSize: 14, fontWeight: '700', color: colors.text, flexShrink: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  ringCenter: { alignItems: 'center' },
  ringValue: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ringPercent: { fontSize: 12, fontWeight: '700' },
  ringLabel: { fontSize: 10, fontWeight: '700', color: colors.textFaint, marginTop: 2 },
  planChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: colors.neutralSurface,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  planChipText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  heroLine: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 8 },
  heroMoney: { fontSize: 18, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  heroSub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2, fontVariant: ['tabular-nums'] },
  planPanel: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 12,
  },
  stepper: { alignItems: 'center', gap: 4 },
  stepperLabel: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  stepValue: { minWidth: 32, textAlign: 'center', fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  mixBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.neutralSurface },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  attentionWrap: { gap: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  block: { gap: 8 },
  blockTitle: { fontSize: 14, fontWeight: '700' },
  more: { paddingVertical: 6, alignItems: 'center' },
  moreText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  bubble: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  chip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  qty: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  amount: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  unpriced: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  tag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: colors.neutralSurface },
  tagText: { fontSize: 10, fontWeight: '700', color: colors.textSubtle },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  actionMain: { backgroundColor: TONE.accent },
  actionSub: { backgroundColor: colors.neutralSurface },
  actionText: { fontSize: 12, fontWeight: '700' },
  miniBar: { height: 6, borderRadius: 3, backgroundColor: colors.neutralSurface, overflow: 'hidden', marginTop: 6 },
  miniFill: { height: 6, borderRadius: 3, backgroundColor: TONE.alert },
  shortText: { fontSize: 11, fontWeight: '700', color: colors.alertText, marginTop: 4, fontVariant: ['tabular-nums'] },
  warnText: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginTop: 2 },
  toList: { alignItems: 'center', gap: 2, borderRadius: 12, backgroundColor: TONE.accent, paddingHorizontal: 12, paddingVertical: 8 },
  toListText: { fontSize: 10, fontWeight: '700', color: colors.primaryText },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile2: {
    width: '48.4%',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
    tileName: { fontSize: 14, fontWeight: '700', color: colors.text, alignSelf: 'stretch', textAlign: 'center' },
  tileQty: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  tileBag: { fontSize: 10, fontWeight: '700', color: colors.textFaint, fontVariant: ['tabular-nums'] },
  tile3: {
    width: '31.4%',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
    paddingVertical: 12,
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  itemName: { fontSize: 13, fontWeight: '700', color: colors.text, textAlign: 'center', minHeight: 32, lineHeight: 16 },
  addTarget: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  addTargetText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  bulk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    backgroundColor: colors.neutralSurface,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bulkText: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  bagValue: { fontSize: 22, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  bagTotal: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  bagAge: { fontSize: 11, fontWeight: '700', color: colors.textFaint, marginTop: 2 },
  shortBox: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 12, gap: 6 },
  shortBoxTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  shortPill: { borderRadius: 999, backgroundColor: colors.dangerSurface, paddingHorizontal: 10, paddingVertical: 4 },
  shortPillText: { fontSize: 11, fontWeight: '700', color: colors.alertText, fontVariant: ['tabular-nums'] },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  bagTile: {
    width: '48.4%',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bagTileOn: { borderColor: TONE.accent, backgroundColor: colors.background },
  bagBody: { alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingTop: 16, paddingBottom: 12 },
  bagQty: { fontSize: 12, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  bagEdit: { position: 'absolute', top: 8, right: 8 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 8, backgroundColor: colors.background },
  finish: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.neutralSurface },
  finishOn: { backgroundColor: TONE.accent },
  finishText: { fontSize: 14, fontWeight: '700', color: colors.textFaint },
});
