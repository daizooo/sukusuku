import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ban, Undo2 } from 'lucide-react-native';
import type { FeedingEntryMode, FeedingMethod, PumpedBatch, PumpingLog } from '@/types/app';
import { FEEDING_ENTRY_MODE_OPTIONS, FEEDING_METHOD_OPTIONS, pumpedStockMl } from '@/lib/careLogUtils';
import { colors } from '@/lib/theme';
import {
  DeleteButton,
  FieldLabel,
  HintBanner,
  NoteField,
  NumberInput,
  Segmented,
  SubmitButton,
} from '@/components/ui/form';
import DateTimeField from '@/components/ui/DateTimeField';
import LogModalShell, { LOG_SHEET_HEIGHT } from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 搾乳の記録。Web版の `src/components/sukusuku/modals/PumpingLogModal.tsx` を
// React Nativeに置き換えたもの。入力の順序・既定値・保存する中身は同じにしてある。
//
// 1件が搾乳ストックの1パック（母乳パック1つぶん）にあたる。
// 搾れる量は毎回まちまちで、決まった刻みのボタンでは当てはまらないため、
// 量は数値の直接入力だけにしている。飲ませるときは授乳の記録で「搾乳」を選び、
// ここでためたパックの中から使うものを選ぶ（入力画面は「飲ませた／搾った」で行き来する）。

export interface PumpingLogInput {
  amountMl: number;
  time: Date;
  note: string;
  /** 飲ませずに丸ごと捨てたときの日時。捨てていなければ入れない。 */
  discardedAt?: Date;
}

interface PumpingLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: PumpingLog | null;
  /** 新規追加時に記録する日。過去の日を表示中でもその日に登録する。 */
  baseDate: Date;
  /** 搾乳ストックの全量（使用済みも含む）。残りの表示に使う。 */
  pumpedBatches: PumpedBatch[];
  /**
   * 授乳の入力画面へ戻る（新規追加のときだけ出す）。「飲ませた」に切り替えたときと、
   * 種類を母乳・ミルクに変えたときに呼ぶ。戻った先で選んでおく種類を渡す。
   */
  onSwitchToFeeding: (method: FeedingMethod) => void;
  onClose: () => void;
  onSubmit: (input: PumpingLogInput) => void;
  onDelete: () => void;
}

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function PumpingLogModal({
  show,
  ...props
}: PumpingLogModalProps & { show: boolean }) {
  return (
    <SheetModal visible={show} onClose={props.onClose} height={LOG_SHEET_HEIGHT}>
      {show ? <PumpingLogModalBody {...props} /> : null}
    </SheetModal>
  );
}

function PumpingLogModalBody({
  log,
  baseDate,
  pumpedBatches,
  onSwitchToFeeding,
  onClose,
  onSubmit,
  onDelete,
}: PumpingLogModalProps) {
  // 読めない値を入れている途中でも入力欄は書き換えられるよう、入力は文字列のまま持つ。
  const [amount, setAmount] = useState(() => (log ? String(log.amountMl) : ''));
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  const [time, setTime] = useState(() => {
    if (log) return log.time;
    const now = new Date();
    const at = new Date(baseDate);
    at.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return at;
  });
  const [note, setNote] = useState(log?.note ?? '');
  // 置きすぎた分などを飲ませずに捨てるとき。保存したときにストックから外れる。
  const [discarded, setDiscarded] = useState(() => !!log?.discardedAt);

  // すでに授乳の記録で使われている搾乳は、量を直すとその記録の量とずれる。
  const isUsed = pumpedBatches.some((batch) => batch.id === log?.id && batch.usedBy !== null);
  // 保存済みの内容として破棄されているか。切り替えた結果どうなるかの説明に使う。
  const wasDiscarded = !!log?.discardedAt;

  const parsed = Number(amount);
  const amountMl =
    amount !== '' && Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;

  const handleSubmit = () => {
    if (amountMl === null) return;
    onSubmit({
      amountMl,
      time,
      note,
      // 捨てた日時は最初に捨てたときのまま。取り消したら印ごと外してストックに戻す。
      discardedAt: discarded ? (log?.discardedAt ?? new Date()) : undefined,
    });
  };

  return (
    <LogModalShell
      title={log ? '搾乳の記録を編集' : '搾乳を記録'}
      onClose={onClose}
      // 授乳の入力画面で「搾乳」を選んだときと同じ並び・同じ位置に出す。行き来しても
      // 切り替えが動かないので、そのまま下の欄に入力できる。
      subheader={
        !log ? (
          <View style={styles.switchers}>
            <View>
              <FieldLabel>種類</FieldLabel>
              <Segmented
                options={FEEDING_METHOD_OPTIONS}
                value={'pumped' as FeedingMethod}
                onChange={(next) => {
                  // 母乳・ミルクは飲ませた分の記録なので、その種類で授乳の入力画面へ戻る。
                  if (next !== 'pumped') onSwitchToFeeding(next);
                }}
              />
            </View>
            <View>
              <FieldLabel>搾乳を</FieldLabel>
              <Segmented
                options={FEEDING_ENTRY_MODE_OPTIONS}
                value={'pump' as FeedingEntryMode}
                onChange={(next) => {
                  if (next === 'feed') onSwitchToFeeding('pumped');
                }}
              />
            </View>
          </View>
        ) : null
      }
      footer={
        <>
          <SubmitButton accent="pumping" onPress={handleSubmit} disabled={amountMl === null}>
            保存する
          </SubmitButton>
          {/* 飲ませずに捨てるとき。搾った記録そのものは残すので、削除とは別に置く。
              すでに飲ませた分は捨てようがないため、使われていないパックにだけ出す。 */}
          {log && !isUsed && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setDiscarded((prev) => !prev)}
              style={styles.discard}
            >
              {discarded ? (
                <>
                  <Undo2 size={14} color={colors.pumpingText} />
                  <Text style={styles.discardText}>破棄をやめる</Text>
                </>
              ) : (
                <>
                  <Ban size={14} color={colors.pumpingText} />
                  <Text style={styles.discardText}>このパックを丸ごと破棄する</Text>
                </>
              )}
            </Pressable>
          )}
          {log && <DeleteButton onPress={onDelete} />}
        </>
      }
    >
      <HintBanner accent="pumping">
        {isUsed
          ? 'この搾乳は授乳の記録ですでに飲ませた分です。量を直すと、その記録の量とずれます。'
          : discarded
            ? wasDiscarded
              ? 'このパックは破棄した分です。搾乳ストックには入っていません。'
              : '保存すると、このパックは搾乳ストックから外れます。搾った記録は残ります。'
            : wasDiscarded
              ? '保存すると、このパックは搾乳ストックに戻ります。'
              : `搾乳ストックの残りは ${pumpedStockMl(pumpedBatches)}ml。飲ませるときは上の「飲ませた」に切り替えて、ここで記録した分から選びます。`}
      </HintBanner>

      <View>
        <FieldLabel>搾乳した量（ml）</FieldLabel>
        <NumberInput
          value={amount}
          onChangeText={setAmount}
          placeholder="ml を直接入力"
          accessibilityLabel="搾乳した量"
        />
      </View>

      <DateTimeField label="日時" value={time} onChange={setTime} maximumDate={new Date()} />
      <NoteField value={note} onChange={setNote} placeholder="よく出た / 冷凍した など" />
    </LogModalShell>
  );
}

const styles = StyleSheet.create({
  switchers: { gap: 12 },
  discard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  discardText: { fontSize: 12, fontWeight: '500', color: colors.pumpingText },
});
