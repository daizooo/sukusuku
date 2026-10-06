import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ticket } from 'lucide-react-native';
import type { SubsidyDraw } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import { insertSubsidyDraw, loadSubsidyDraws } from '@/lib/api/subsidyDraws';
import {
  MONTHLY_LIMIT,
  PITY_STREAK,
  PRICE_LIMIT,
  PRIZES,
  formatMonth,
  groupByMonth,
  isPity,
  missStreak,
  oddsPercent,
  parsePrice,
  pickPrize,
  priceError,
  prizeOf,
  remainingDraws,
  subsidyFor,
} from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import LotteryBall, { PRIZE_COLOR } from '@/components/living/LotteryBall';
import LotteryResultSheet from '@/components/living/LotteryResultSheet';

// 暮らしタブの「補助くじ」の面（docs/home.md §9）。PWA版の
// `src/components/sukusuku/living/LotteryPanel.tsx` と同じ項目・並び・文言。
//
// 家のルール: 趣味以外で必要なものを税込3,000円未満で買うとき、1人あたり月2回まで、
// 家族のお金から補助を出す。補助の額はくじ（ガラポン）で決める。
// 上（固定）にルール・今月の残り・入力、下（スクロール）に月ごとの履歴。
// 結果はDBへ記録してから見せる（引き直しができない）。

interface LotteryPanelProps {
  familyId: string | null;
  userId: string;
}

export default function LotteryPanel({ familyId, userId }: LotteryPanelProps) {
  const [draws, setDraws] = useState<SubsidyDraw[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [itemName, setItemName] = useState('');
  const [priceText, setPriceText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [result, setResult] = useState<SubsidyDraw | null>(null);

  useEffect(() => {
    if (!familyId) return;
    let isMounted = true;
    void (async () => {
      try {
        const [loaded, members] = await Promise.all([
          loadSubsidyDraws(supabase, familyId),
          listFamilyMembers(supabase, familyId),
        ]);
        if (!isMounted) return;
        setDraws(loaded);
        setNames(Object.fromEntries(members.map((member) => [member.id, member.name])));
      } catch {
        // 読めなかったぶんは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [familyId]);

  const now = new Date();
  const remaining = remainingDraws(draws, userId, now);
  const streak = missStreak(draws, userId);
  const odds = oddsPercent(streak);
  const groups = useMemo(() => groupByMonth(draws), [draws]);

  const spin = async (name: string, price: number) => {
    if (!familyId || isDrawing) return;
    setIsDrawing(true);
    try {
      const prize = pickPrize(Math.random, streak);
      const created = await insertSubsidyDraw(supabase, familyId, userId, {
        itemName: name,
        price,
        prize: prize.id,
        subsidy: subsidyFor(prize.id, price),
      });
      setDraws((prev) => [created, ...prev]);
      setItemName('');
      setPriceText('');
      setResult(created);
    } catch {
      Alert.alert(
        'くじを引けませんでした',
        '電波のあるところでもう一度お試しください。今月の回数を使い切っているときも引けません。',
      );
    } finally {
      setIsDrawing(false);
    }
  };

  const confirmSpin = () => {
    const price = parsePrice(priceText);
    const problem = itemName.trim() === '' ? '買うものを入れてください' : priceError(price);
    setError(problem);
    if (problem !== null || price === null) return;
    const name = itemName.trim();
    Alert.alert(
      'ガラポンを回しますか？',
      `${name}（税込 ${formatPrice(price)}）\n回すと今月の福引券を1回使います。引き直しはできません。`,
      [
        { text: 'やめる', style: 'cancel' },
        { text: '回す', onPress: () => void spin(name, price) },
      ],
    );
  };

  const canDraw = !isLoading && remaining > 0 && !isDrawing && familyId !== null;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.rule}>
          趣味以外で必要なもの・税込{PRICE_LIMIT.toLocaleString('ja-JP')}円未満なら、月{MONTHLY_LIMIT}回まで
          家族のお金から補助が出ます
        </Text>
        <View style={styles.ticketRow}>
          <Text style={styles.ticketLabel}>今月の福引券</Text>
          <View style={styles.tickets}>
            {Array.from({ length: MONTHLY_LIMIT }, (_, index) => (
              <Ticket
                key={index}
                size={22}
                color={index < remaining ? colors.milkMark : colors.borderStrong}
                fill={index < remaining ? colors.milkBadge : 'transparent'}
              />
            ))}
          </View>
          <Text style={styles.ticketCount}>
            {isLoading ? '…' : remaining > 0 ? `あと${remaining}回` : '使い切りました'}
          </Text>
        </View>
        {streak > 0 && (
          <Text style={[styles.streak, isPity(streak) && styles.streakPity]}>
            {isPity(streak)
              ? `ティッシュ${streak}連続。次は白玉が抜けます`
              : `ティッシュ${streak}連続。あと${PITY_STREAK - streak}回続くと、次は白玉が抜けます`}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={itemName}
          onChangeText={setItemName}
          placeholder="買うもの（例: 洗濯ネット）"
          placeholderTextColor={colors.textFaint}
          editable={remaining > 0}
        />
        <View style={styles.priceRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={priceText}
            onChangeText={setPriceText}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="税込の価格（円）"
            placeholderTextColor={colors.textFaint}
            editable={remaining > 0}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canDraw }}
            disabled={!canDraw}
            onPress={confirmSpin}
            style={[styles.spinButton, !canDraw && styles.spinButtonDisabled]}
          >
            <Text style={styles.spinButtonText}>ガラポン！</Text>
          </Pressable>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.odds}>
          {PRIZES.map((prize) => {
            const percent = odds.find((entry) => entry.prize.id === prize.id)?.percent ?? 0;
            return (
              <View key={prize.id} style={styles.oddsItem}>
                <LotteryBall prize={prize.id} size={14} />
                <Text style={styles.oddsText}>
                  {prize.amount === null ? '全額' : prize.amount === 0 ? '自腹' : formatPrice(prize.amount)} {percent}%
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
      ) : draws.length === 0 ? (
        <View style={[styles.centered, styles.flex]}>
          <Text style={styles.message}>まだ引いていません。買うものと価格を入れて、ガラポン！</Text>
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
          {groups.map((group) => (
            <View key={group.month} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{formatMonth(group.month, now)}</Text>
                <Text style={styles.groupTotal}>
                  家族のお金から {formatPrice(group.subsidyTotal)}（{group.draws.length}回）
                </Text>
              </View>
              <View style={styles.list}>
                {group.draws.map((draw, index) => {
                  const date = new Date(draw.drawnAt);
                  const who = draw.drawnBy ? (names[draw.drawnBy] ?? '家族') : '家族';
                  return (
                    <View key={draw.id} style={[styles.row, index > 0 && styles.rowDivided]}>
                      <LotteryBall prize={draw.prize} size={28} />
                      <View style={styles.flex}>
                        <Text style={styles.name} numberOfLines={1}>
                          {draw.itemName || '（名前なし）'}
                        </Text>
                        <Text style={styles.sub}>
                          {who}・{date.getMonth() + 1}/{date.getDate()}・税込 {formatPrice(draw.price)}・
                          {prizeOf(draw.prize).name}
                        </Text>
                      </View>
                      <Text
                        style={[styles.subsidy, draw.subsidy === 0 ? styles.subsidyNone : { color: PRIZE_COLOR[draw.prize].text }]}
                      >
                        {draw.subsidy === 0 ? '自腹' : formatPrice(draw.subsidy)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {result !== null && <LotteryResultSheet draw={result} onClose={() => setResult(null)} />}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rule: { fontSize: 12, fontWeight: '500', color: colors.textSubtle },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  tickets: { flexDirection: 'row', gap: 4 },
  ticketCount: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  streak: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  streakPity: { color: colors.doneText },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    backgroundColor: colors.surface,
    fontVariant: ['tabular-nums'],
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spinButton: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.navActive,
  },
  spinButtonDisabled: { backgroundColor: colors.borderStrong },
  spinButtonText: { fontSize: 14, fontWeight: '700', color: colors.primaryText },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  odds: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  oddsItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  oddsText: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  group: { gap: 4 },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  groupTotal: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2, fontVariant: ['tabular-nums'] },
  subsidy: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  subsidyNone: { color: colors.textFaint },
});
