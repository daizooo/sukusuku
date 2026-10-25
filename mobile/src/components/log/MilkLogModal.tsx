import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  BreastSide,
  FeedingEntryMode,
  FeedingMethod,
  MilkLog,
  PumpedBatch,
} from '@/types/app';
import {
  FEEDING_ENTRY_MODE_OPTIONS,
  FEEDING_METHOD_OPTIONS,
  formatBatchTime,
  formatStopwatch,
  getSideLabel,
  pumpedStockMl,
  selectablePumpedBatches,
  sumBatchesMl,
} from '@/lib/careLogUtils';
import {
  NURSING_ALARM_MINUTES,
  NURSING_SIDES,
  nursingMinutes,
  type NursingSideValues,
  type NursingTimer,
} from '@/lib/nursingTimer';
import { isSameDay } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import {
  DeleteButton,
  FieldLabel,
  HintBanner,
  NoteField,
  NumberInput,
  OptionGrid,
  Segmented,
  SubmitButton,
} from '@/components/ui/form';
import DateTimeField from '@/components/ui/DateTimeField';
import LogModalShell, { LOG_SHEET_HEIGHT } from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 授乳・ミルクの記録。Web版の `src/components/sukusuku/modals/MilkLogModal.tsx` を
// React Nativeに置き換えたもの。入力の順序・既定値・保存する中身は同じにしてある。

export interface MilkLogInput {
  method: FeedingMethod;
  amountMl?: number;
  /** method: 'pumped' のとき、飲ませた搾乳の記録のid。 */
  pumpedFrom?: string[];
  /** method: 'pumped' で飲みきれず捨てた量(ml)。捨てた分がなければ入れない。 */
  discardedMl?: number;
  leftMinutes?: number;
  rightMinutes?: number;
  lastSide?: BreastSide;
  time: Date;
  note: string;
}

interface MilkLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: MilkLog | null;
  /** 新規追加時に記録する日。過去の日を表示中でもその日に登録する。 */
  baseDate: Date;
  /** 直近の授乳から割り出した「次に飲ませる側」。判断材料がなければ null。 */
  nextSide: BreastSide | null;
  /** 母乳の左右別ストップウォッチ。新規に記録するときだけ使う。 */
  timer: NursingTimer;
  /** 搾乳ストックの全量（使用済みも含む）。「搾乳」を選んだときの選択肢に使う。 */
  pumpedBatches: PumpedBatch[];
  /** パックを破棄する / 取り消す。ストックから外す・戻す。 */
  onDiscardBatch: (id: string, discarded: boolean) => void;
  /** 搾乳の入力画面へ移る（「搾った」に切り替えたとき）。 */
  onSwitchToPumping: () => void;
  /** 搾乳の入力画面から戻ってきたときに選んでおく種類。 */
  initialMethod?: FeedingMethod;
  onClose: () => void;
  onSubmit: (input: MilkLogInput) => void;
  onDelete: () => void;
}

const SIDE_OPTIONS: { value: BreastSide; label: string }[] = [
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
];

/** 分数の入力欄に出す文字。未入力なら空。 */
const toMinutesText = (minutes: number | undefined): string =>
  minutes === undefined ? '' : String(minutes);

/**
 * 計測を始めた時刻を、記録の日時の初期値として使えるならその時刻を返す。
 *
 * 授乳の記録の日時は「飲ませ始めた時刻」。保存するのは飲ませ終えたあとなので、
 * 保存した時刻を入れると実際より後ろにずれ、「次の授乳の目安」もその分だけ遅れる。
 *
 * 使わないのは次の2つ。
 * - 過去の日を開いているとき（その日の記録を後から足している。いまの計測とは別）
 * - 止め忘れたまま何時間も残っている計測（そのまま入れると明らかに違う時刻になる。
 *   どの授乳も数十分で終わるので、これを超えたら計測が残っているだけと見る）
 */
const MEASURED_START_MAX_MS = 6 * 60 * 60_000;

const measuredStartTime = (
  sessionStartedAt: number | null,
  baseDate: Date,
  now: Date,
): Date | null => {
  if (!sessionStartedAt) return null;
  const elapsed = now.getTime() - sessionStartedAt;
  if (elapsed < 0 || elapsed > MEASURED_START_MAX_MS) return null;
  const startedAt = new Date(sessionStartedAt);
  if (!isSameDay(startedAt, baseDate)) return null;
  // 秒は持たない（他の記録と同じく分まで）。
  startedAt.setSeconds(0, 0);
  return startedAt;
};

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function MilkLogModal({ show, ...props }: MilkLogModalProps & { show: boolean }) {
  return (
    <SheetModal visible={show} onClose={props.onClose} height={LOG_SHEET_HEIGHT}>
      {show ? <MilkLogModalBody {...props} /> : null}
    </SheetModal>
  );
}

function MilkLogModalBody({
  log,
  baseDate,
  nextSide,
  timer,
  pumpedBatches,
  onDiscardBatch,
  onSwitchToPumping,
  initialMethod,
  onClose,
  onSubmit,
  onDelete,
}: MilkLogModalProps) {
  const [method, setMethod] = useState<FeedingMethod>(log?.method ?? initialMethod ?? 'breast');
  // 「搾乳」で飲ませる搾乳ストック。編集中なら、その記録が使っているパックを選んだ状態で開く。
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>(() => log?.pumpedFrom ?? []);
  // 「ミルク」の量は自由記入のみ。読めない値のままでは保存できないようにする。
  const [amountInput, setAmountInput] = useState(() => (log?.amountMl ? String(log.amountMl) : ''));
  // 「搾乳」で実際に飲んだ量。飲みきれず量を打ち直したときだけ、この入力欄の側で持つ。
  const [drankInput, setDrankInput] = useState(() =>
    log?.method === 'pumped' && log.discardedMl ? String(log.amountMl ?? 0) : '',
  );
  // 打ち直していない間は、選んだ搾乳の合計（＝全部飲んだ）をそのまま使う。
  const [drankEdited, setDrankEdited] = useState(
    () => !!(log?.method === 'pumped' && log.discardedMl),
  );
  // 計測した時間があれば、開き直したときもその値から始める。
  const measured = !log && timer.hasSession;
  // 未選択と「0分」を区別するため、初期値は undefined にしておく。
  const initialLeft = log?.leftMinutes ?? (measured ? nursingMinutes(timer.elapsed.left) : undefined);
  const initialRight =
    log?.rightMinutes ?? (measured ? nursingMinutes(timer.elapsed.right) : undefined);
  const [leftMinutes, setLeftMinutes] = useState<number | undefined>(initialLeft);
  const [rightMinutes, setRightMinutes] = useState<number | undefined>(initialRight);
  // ボタンに無い分数は直接入力欄の側で持つ。
  const [customLeft, setCustomLeft] = useState(() => toMinutesText(initialLeft));
  const [customRight, setCustomRight] = useState(() => toMinutesText(initialRight));
  const [lastSide, setLastSide] = useState<BreastSide | undefined>(log?.lastSide);
  // 分数を手で選び直した側は、計測した値より手入力を優先する。
  const [editedLeft, setEditedLeft] = useState(false);
  const [editedRight, setEditedRight] = useState(false);
  // 「最後に飲ませた側」を手で選び直したときも、計測した側より手入力を優先する。
  const [editedSide, setEditedSide] = useState(false);
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  // ただし母乳を測っているなら、その計測を始めた時刻（＝飲ませ始めた時刻）を出す。
  const [time, setTime] = useState(() => {
    if (log) return log.time;
    const now = new Date();
    // 測っているのは母乳なので、母乳で開いたときだけ。ミルクや搾乳で開いたなら
    // いまの時刻のまま（測っている授乳とは別の記録を足しに来ている）。
    const measuredStart =
      method === 'breast' ? measuredStartTime(timer.sessionStartedAt, baseDate, now) : null;
    if (measuredStart) return measuredStart;
    const at = new Date(baseDate);
    at.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return at;
  });
  const [note, setNote] = useState(log?.note ?? '');

  // 過去の記録を編集しているときは、いま計測しているものと混ざらないよう出さない。
  const showTimer = !log && method === 'breast';

  // 選べる搾乳ストック。編集中の記録が使っているパックも、選び直せるよう残す。
  const selectableBatches = selectablePumpedBatches(pumpedBatches, log?.id);
  const selectedBatches = selectableBatches.filter((batch) => selectedBatchIds.includes(batch.id));
  // 「搾乳」で用意した量は、選んだ搾乳の合計。
  const selectedMl = sumBatchesMl(selectedBatches);
  // 実際に飲んだ量。打ち直していなければ用意した量をそのまま飲んだものとして扱う。
  // 読めない値を入れている途中は null にして、そのままでは保存できないようにする。
  const parsedDrank = Number(drankInput);
  const drankMl = !drankEdited
    ? selectedMl
    : drankInput !== '' && Number.isFinite(parsedDrank) && parsedDrank >= 0
      ? Math.round(parsedDrank)
      : null;
  // 用意した搾乳は飲みきれなくても取っておけないため、余った分は捨てる。
  const discardedMl = drankMl === null ? 0 : Math.max(0, selectedMl - drankMl);
  // 用意した量より多くは飲めない。パックを選び足すよう促す。
  const drankTooMuch = drankMl !== null && drankMl > selectedMl;
  const pumpedInvalid = selectedBatches.length === 0 || drankMl === null || drankTooMuch;

  // 自由記入の量(ml)。読めない値を入れている途中は null にして、そのままでは保存できないようにする。
  const parsedAmount = Number(amountInput);
  const amountMl =
    amountInput !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0
      ? Math.round(parsedAmount)
      : null;
  const formulaInvalid = amountMl === null;

  // 捨てたパックは飲ませられないので、選んでいたら外しておく。
  const handleDiscardBatch = (id: string) => {
    setSelectedBatchIds((prev) => prev.filter((x) => x !== id));
    onDiscardBatch(id, true);
  };

  const toggleBatch = (id: string) =>
    setSelectedBatchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  // 計測した時間をそのまま記録する。計測中のまま保存されても、その分を含める。
  // 分数を手で選び直した側は、その値を優先する。
  const measuring = showTimer && timer.hasSession;
  const recordedLeft =
    measuring && !editedLeft ? nursingMinutes(timer.elapsed.left) : (leftMinutes ?? 0);
  const recordedRight =
    measuring && !editedRight ? nursingMinutes(timer.elapsed.right) : (rightMinutes ?? 0);
  // 「最後に飲ませた側」も分数と同じで、計測中は計測した側をそのまま出す。
  //
  // PWA版は開いた時点の計測を初期値に入れているが、ネイティブ版は控えの読み戻しが
  // 非同期なので、それでは間に合わないことがある（お知らせのタップで起動と同時に
  // この画面が開く場合など）。分数は計測から出し直していて埋まるのに側だけ空、
  // という食い違いが出るため、側も同じ出し方にそろえる。
  const recordedSide = measuring && !editedSide ? (timer.lastSide ?? undefined) : lastSide;

  // 分数を手で決め直したときの反映。ボタン・直接入力のどちらからでもここを通る。
  const applyMinutes = (side: BreastSide, minutes: number | undefined, custom: string) => {
    if (side === 'left') {
      setLeftMinutes(minutes);
      setCustomLeft(custom);
      setEditedLeft(true);
    } else {
      setRightMinutes(minutes);
      setCustomRight(custom);
      setEditedRight(true);
    }
  };

  const handleCustomMinutes = (side: BreastSide, value: string) => {
    const parsed = Number(value);
    // 読めない値を入れている途中でも入力欄は書き換えられるようにする。
    const minutes =
      value !== '' && Number.isFinite(parsed) && parsed >= 0
        ? Math.round(parsed)
        : side === 'left'
          ? leftMinutes
          : rightMinutes;
    applyMinutes(side, minutes, value);
  };

  // 計測した時間を分数の入力欄へ入れる。
  const applyTotal = (total: NursingSideValues) => {
    const left = nursingMinutes(total.left);
    const right = nursingMinutes(total.right);
    setLeftMinutes(left);
    setRightMinutes(right);
    setCustomLeft(toMinutesText(left));
    setCustomRight(toMinutesText(right));
  };

  // 計測を始める・止める・切り替えるたびに、その時点の合計を分数の入力欄へ入れる。
  // 押した側が「最後に飲ませた側」になる。
  const handleToggleSide = (side: BreastSide) => {
    applyTotal(timer.toggleSide(side));
    setLastSide(side);
    setEditedSide(false);
    // 測り直した側は計測の値に戻す。
    if (side === 'left') setEditedLeft(false);
    else setEditedRight(false);
  };

  /** 測り始めた授乳ごと取りやめる。記録は作らず、計測だけを捨てて画面を閉じる。 */
  const handleDeleteSession = () => {
    timer.reset();
    onClose();
  };

  const handleResetTimer = () => {
    timer.reset();
    setLeftMinutes(undefined);
    setRightMinutes(undefined);
    setCustomLeft('');
    setCustomRight('');
    setLastSide(undefined);
    setEditedLeft(false);
    setEditedRight(false);
    setEditedSide(false);
  };

  const handleSubmit = () => {
    const base = { method, time, note };
    if (method === 'pumped') {
      if (pumpedInvalid || drankMl === null) return;
      onSubmit({
        ...base,
        amountMl: drankMl,
        pumpedFrom: selectedBatches.map((batch) => batch.id),
        discardedMl: discardedMl > 0 ? discardedMl : undefined,
      });
      return;
    }
    if (method === 'formula') {
      if (amountMl === null) return;
      onSubmit({ ...base, amountMl });
      return;
    }
    const left = recordedLeft;
    const right = recordedRight;
    onSubmit({
      ...base,
      leftMinutes: left,
      rightMinutes: right,
      // どちらも0分のときは「最後に飲ませた側」も残さない。
      lastSide: left === 0 && right === 0 ? undefined : recordedSide,
    });
  };

  return (
    <LogModalShell
      title={log ? '授乳の記録を編集' : '授乳を記録'}
      onClose={onClose}
      // 母乳/搾乳/ミルクの切り替えは、選び直したときに動かないよう一番上に固定しておく。
      subheader={
        <View style={styles.switchers}>
          <View>
            <FieldLabel>種類</FieldLabel>
            <Segmented options={FEEDING_METHOD_OPTIONS} value={method} onChange={setMethod} />
          </View>
          {/* 搾った分は飲ませた分とは別の記録（搾乳ストックの1パック）になるので、押すと
              搾乳の入力画面へ移る。搾乳以外では関わらないため、搾乳を選んだときだけ出す。
              入力欄と一緒にスクロールして流れていかないよう、種類のすぐ下に固定して置く。
              編集中は記録の種類を変えられないので出さない。 */}
          {!log && method === 'pumped' && (
            <View>
              <FieldLabel>搾乳を</FieldLabel>
              <Segmented
                options={FEEDING_ENTRY_MODE_OPTIONS}
                value={'feed' as FeedingEntryMode}
                onChange={(next) => {
                  if (next === 'pump') onSwitchToPumping();
                }}
              />
            </View>
          )}
        </View>
      }
      footer={
        <>
          <SubmitButton
            accent="milk"
            onPress={handleSubmit}
            disabled={
              (method === 'pumped' && pumpedInvalid) || (method === 'formula' && formulaInvalid)
            }
          >
            保存する
          </SubmitButton>
          {log ? (
            <DeleteButton onPress={onDelete} />
          ) : (
            // 記録にする前でも、測り始めた授乳ごと取りやめられるようにする。
            // 間違えて始めた計測が、記録するまで消せないままになるのを避ける。
            timer.hasSession && (
              <DeleteButton label="計測中の授乳を削除する" onPress={handleDeleteSession} />
            )
          )}
        </>
      }
    >
        {method === 'breast' ? (
          <>
            {!log && nextSide && (
              <HintBanner accent="milk">
                前回は{getSideLabel(nextSide === 'left' ? 'right' : 'left')}で終了 → 次は
                {getSideLabel(nextSide)}からがおすすめ
              </HintBanner>
            )}
            {showTimer && (
              <NursingStopwatch
                elapsed={timer.elapsed}
                runningSide={timer.runningSide}
                hasSession={timer.hasSession}
                recordedLeft={recordedLeft}
                recordedRight={recordedRight}
                onToggleSide={handleToggleSide}
                onReset={handleResetTimer}
              />
            )}
            {/* 計測中は経過時間（分）をそのまま入れておく。手で直した側はその値を優先する。 */}
            <View style={styles.minuteRow}>
              <MinuteField
                label="左（分）"
                value={measuring && !editedLeft ? String(recordedLeft) : customLeft}
                onChange={(value) => handleCustomMinutes('left', value)}
              />
              <MinuteField
                label="右（分）"
                value={measuring && !editedRight ? String(recordedRight) : customRight}
                onChange={(value) => handleCustomMinutes('right', value)}
              />
            </View>
            <View>
              <FieldLabel>最後に飲ませた側</FieldLabel>
              <OptionGrid
                options={SIDE_OPTIONS}
                value={recordedSide}
                onChange={(value) => {
                  setLastSide(value);
                  setEditedSide(true);
                }}
                columns={2}
                accent="milk"
              />
            </View>
          </>
        ) : method === 'pumped' ? (
          <>
            <PumpedBatchPicker
              batches={selectableBatches}
              selectedIds={selectedBatchIds}
              selectedMl={selectedMl}
              stockMl={pumpedStockMl(pumpedBatches)}
              onToggle={toggleBatch}
              onDiscard={handleDiscardBatch}
              onUndoDiscard={(id) => onDiscardBatch(id, false)}
            />
            {selectableBatches.length > 0 && (
              <DrankAmountField
                value={drankEdited ? drankInput : selectedMl > 0 ? String(selectedMl) : ''}
                preparedMl={selectedMl}
                discardedMl={discardedMl}
                tooMuch={drankTooMuch}
                edited={drankEdited}
                onChange={(next) => {
                  setDrankEdited(true);
                  setDrankInput(next);
                }}
                onResetToPrepared={() => {
                  setDrankEdited(false);
                  setDrankInput('');
                }}
              />
            )}
          </>
        ) : (
          <View>
            <FieldLabel>量（ml）</FieldLabel>
            <NumberInput
              value={amountInput}
              onChangeText={setAmountInput}
              placeholder="ml を直接入力"
              accessibilityLabel="量（ml）"
            />
          </View>
        )}

      <DateTimeField label="日時" value={time} onChange={setTime} maximumDate={new Date()} />
      <NoteField value={note} onChange={setNote} placeholder="よく飲んだ / 途中で寝た など" />
    </LogModalShell>
  );
}

interface PumpedBatchPickerProps {
  /** 選べる搾乳（まだ使っていないパック + 編集中の記録が使っているパック）。古い順。 */
  batches: PumpedBatch[];
  selectedIds: string[];
  /** 選んだ搾乳の合計(ml)。これが飲ませるために用意した量になる。 */
  selectedMl: number;
  /** ストック全体の残り(ml)。編集中の記録が使っている分は含まない。 */
  stockMl: number;
  onToggle: (id: string) => void;
  /** 置きすぎた分などをここで捨てる。 */
  onDiscard: (id: string) => void;
  onUndoDiscard: (id: string) => void;
}

/**
 * 飲ませる搾乳を搾乳ストックから選ぶ。選んだパックの合計が、飲ませるために用意した量になる。
 *
 * どれだけ用意したかは、どの搾乳を使ったかで決まる（母乳パック1つ＝1回の搾乳）ため、
 * ここはパックを選ぶ形にしている。実際に飲んだ量は下の「飲んだ量」で直す。
 * 並びは搾った順（古いものから使う）。
 */
function PumpedBatchPicker({
  batches,
  selectedIds,
  selectedMl,
  stockMl,
  onToggle,
  onDiscard,
  onUndoDiscard,
}: PumpedBatchPickerProps) {
  // 直前に破棄したパック。取り消せるよう、一覧から消えたあとも覚えておく。
  const [discardedBatch, setDiscardedBatch] = useState<PumpedBatch | null>(null);

  const handleDiscard = (batch: PumpedBatch) => {
    setDiscardedBatch(batch);
    onDiscard(batch.id);
  };

  const handleUndo = () => {
    if (!discardedBatch) return;
    onUndoDiscard(discardedBatch.id);
    setDiscardedBatch(null);
  };

  const discardedNotice = discardedBatch ? (
    <View style={styles.discardedNotice}>
      <Text style={styles.discardedText} numberOfLines={1}>
        {formatBatchTime(discardedBatch)}（{discardedBatch.amountMl}ml）を破棄しました
      </Text>
      <Pressable accessibilityRole="button" onPress={handleUndo} hitSlop={6}>
        <Text style={styles.undoText}>取り消す</Text>
      </Pressable>
    </View>
  ) : null;

  if (batches.length === 0) {
    return (
      <View style={styles.pickerEmpty}>
        {discardedNotice}
        <HintBanner accent="pumping">
          搾乳ストックがありません。上の「搾った」に切り替えて、搾った分を先に記録してください。
        </HintBanner>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.pickerHeader}>
        <FieldLabel>飲ませる搾乳を選ぶ</FieldLabel>
        <Text style={styles.stock}>残り {stockMl}ml</Text>
      </View>

      {discardedNotice}

      <View style={[styles.batchList, discardedBatch && styles.batchListSpaced]}>
        {batches.map((batch) => {
          const selected = selectedIds.includes(batch.id);
          return (
            <View key={batch.id} style={[styles.batchRow, selected && styles.batchSelected]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onToggle(batch.id)}
                style={styles.batch}
              >
                <Text style={[styles.batchTime, selected && styles.batchTextSelected]}>
                  {selected ? '✓ ' : ''}
                  {formatBatchTime(batch)}
                </Text>
                <Text style={[styles.batchAmount, selected && styles.batchTextSelected]}>
                  {batch.amountMl}ml
                </Text>
              </Pressable>
              {/* 置きすぎた分をここで捨てる。すでに飲ませたパックは捨てようがないので出さない。 */}
              {batch.usedBy === null && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${formatBatchTime(batch)}の搾乳を破棄する`}
                  onPress={() => handleDiscard(batch)}
                  style={[styles.batchDiscard, selected && styles.batchDiscardSelected]}
                >
                  <Text style={styles.batchDiscardText}>破棄</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      <Text style={styles.batchSummary}>
        {selectedIds.length === 0
          ? '搾乳を選んでください'
          : `合計 ${selectedMl}ml を用意`}
      </Text>
    </View>
  );
}

interface DrankAmountFieldProps {
  /** 入力欄に出す値。打ち直していなければ用意した量がそのまま入る。 */
  value: string;
  /** 選んだ搾乳の合計(ml)。 */
  preparedMl: number;
  /** 飲みきれずに捨てる量(ml)。 */
  discardedMl: number;
  /** 用意した量より多い量が入っているか。 */
  tooMuch: boolean;
  /** 量を打ち直したあとか。 */
  edited: boolean;
  onChange: (value: string) => void;
  onResetToPrepared: () => void;
}

/**
 * 実際に飲んだ量。飲みきれないことがあるので、用意した量から自由に打ち直せるようにしている。
 *
 * 記録に残るのはここに入れた量で、用意した搾乳との差は飲み残しとして捨てた扱いになる
 * （飲み残しは取っておけないため、選んだパックは飲みきれなくてもストックから外れる）。
 */
function DrankAmountField({
  value,
  preparedMl,
  discardedMl,
  tooMuch,
  edited,
  onChange,
  onResetToPrepared,
}: DrankAmountFieldProps) {
  return (
    <View>
      <View style={styles.pickerHeader}>
        <FieldLabel>飲んだ量（ml）</FieldLabel>
        {edited && (
          <Pressable accessibilityRole="button" onPress={onResetToPrepared} hitSlop={8}>
            <Text style={styles.drankReset}>全部飲んだ</Text>
          </Pressable>
        )}
      </View>
      <NumberInput
        value={value}
        onChangeText={onChange}
        placeholder="ml を直接入力"
        accessibilityLabel="飲んだ量（ml）"
      />
      <Text style={[styles.note, tooMuch && styles.noteAlert]}>
        {tooMuch
          ? `用意した ${preparedMl}ml より多くは飲めません。搾乳を選び足してください。`
          : discardedMl > 0
            ? `飲み残し ${discardedMl}ml は捨てた扱いで記録します。`
            : '飲みきれなかったときは、実際に飲んだ量に直してください。'}
      </Text>
    </View>
  );
}

interface MinuteFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * 母乳の授乳時間（分）。計測した経過時間が入り、手で直すこともできる。
 * 計測を止め忘れて長い時間が入ってしまったときも、ここで実際の時間に直せる。
 */
function MinuteField({ label, value, onChange }: MinuteFieldProps) {
  return (
    <View style={styles.minuteField}>
      <FieldLabel>{label}</FieldLabel>
      <NumberInput
        value={value}
        onChangeText={onChange}
        placeholder="分"
        accessibilityLabel={label}
      />
    </View>
  );
}

interface NursingStopwatchProps {
  /** 左右それぞれの時間(ミリ秒)。計測中の分を含む。 */
  elapsed: NursingSideValues;
  runningSide: BreastSide | null;
  hasSession: boolean;
  /** この内容で保存したときに記録される分数。 */
  recordedLeft: number;
  recordedRight: number;
  onToggleSide: (side: BreastSide) => void;
  onReset: () => void;
}

/**
 * 授乳を左右別に測るストップウォッチ。
 *
 * 測る側のボタンをタップして使い、もう一度押すと止まり、反対側を押すと切り替わる。
 * 測っている間は5分たつごとにお知らせが鳴り（5分=1回、10分=2回…）、
 * 授乳中は画面を見られなくても何分たったかが分かる。
 * この画面は「いまどこまで進んだか」を後から確かめるためのもの。
 * 1つの側が60分に達したら計測は自動で止まる（止め忘れても数え続けない）。
 */
function NursingStopwatch({
  elapsed,
  runningSide,
  hasSession,
  recordedLeft,
  recordedRight,
  onToggleSide,
  onReset,
}: NursingStopwatchProps) {
  const intervalMs = NURSING_ALARM_MINUTES * 60_000;

  return (
    <View style={styles.stopwatch}>
      <View style={styles.stopwatchHeader}>
        <Text style={styles.stopwatchTitle}>授乳を計測</Text>
        {hasSession && (
          <Pressable accessibilityRole="button" onPress={onReset} hitSlop={8}>
            <Text style={styles.reset}>リセット</Text>
          </Pressable>
        )}
      </View>

      {/* ボタンの並びは「左・右」で固定する。 */}
      <View style={styles.phases}>
        {NURSING_SIDES.map((side) => {
          const isRunning = runningSide === side;
          // 次のお知らせまでの進み具合。5分ごとに0へ戻る。
          const ratio = (elapsed[side] % intervalMs) / intervalMs;
          return (
            <Pressable
              key={side}
              accessibilityRole="button"
              accessibilityState={{ selected: isRunning }}
              onPress={() => onToggleSide(side)}
              style={[styles.phase, isRunning && styles.phaseRunning]}
            >
              <Text style={[styles.phaseLabel, isRunning && styles.phaseTextRunning]}>
                {getSideLabel(side)}
              </Text>
              <Text style={[styles.phaseTime, isRunning && styles.phaseTextRunning]}>
                {formatStopwatch(elapsed[side])}
              </Text>
              <View style={[styles.track, isRunning && styles.trackRunning]}>
                <View
                  style={[
                    styles.trackFill,
                    isRunning && styles.trackFillRunning,
                    { width: `${ratio * 100}%` },
                  ]}
                />
              </View>
              <Text style={[styles.phaseHint, isRunning && styles.phaseTextRunning]}>
                {isRunning ? '停止' : '開始'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {hasSession && (
        <Text style={styles.stopwatchSummary}>
          左{recordedLeft}分・右{recordedRight}分で記録します
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  switchers: { gap: 12 },
  note: { fontSize: 11, color: colors.textFaint, marginTop: 6, lineHeight: 16 },
  // 左右の分数の入力欄は1行に横並びにする。
  minuteRow: { flexDirection: 'row', gap: 12 },
  minuteField: { flex: 1 },

  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stock: { fontSize: 11, color: colors.textMuted, marginBottom: 6, fontWeight: '500', fontVariant: ['tabular-nums'] },
  batchList: { gap: 6 },
  batchListSpaced: { marginTop: 8 },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  batch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  batchDiscard: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  batchDiscardSelected: { borderLeftColor: colors.pumpingBorder },
  batchDiscardText: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  batchSelected: { backgroundColor: colors.pumpingSurface, borderColor: colors.pumping },
  pickerEmpty: { gap: 8 },
  discardedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: colors.neutralSurface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  discardedText: { flex: 1, fontSize: 11, color: colors.textSubtle, fontWeight: '500', fontVariant: ['tabular-nums'] },
  undoText: { fontSize: 11, fontWeight: '700', color: colors.pumpingText },
  batchTime: { fontSize: 14, color: colors.textSubtle, fontWeight: '500', fontVariant: ['tabular-nums'] },
  batchAmount: { fontSize: 14, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  batchTextSelected: { color: colors.pumpingText },
  batchSummary: { marginTop: 8, fontSize: 12, fontWeight: '700', color: colors.pumpingText },
  drankReset: { fontSize: 11, fontWeight: '500', color: colors.pumpingText, marginBottom: 6 },
  noteAlert: { color: colors.alertText, fontWeight: '700' },

  stopwatch: {
    backgroundColor: colors.milkSurface,
    borderWidth: 1,
    borderColor: colors.milkBorder,
    borderRadius: 16,
    padding: 12,
  },
  stopwatchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  stopwatchTitle: { fontSize: 12, fontWeight: '700', color: colors.milkText },
  reset: { fontSize: 11, color: colors.milkText },

  // 左右のボタン。並びは「左・右」で固定する。
  phases: { flexDirection: 'row', gap: 8, marginTop: 4 },
  phase: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.milkBorder,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  phaseRunning: { backgroundColor: colors.milk, borderColor: colors.milk },
  phaseLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  phaseTime: { fontSize: 20, fontWeight: '700', color: colors.text, marginVertical: 2, fontVariant: ['tabular-nums'] },
  phaseHint: { fontSize: 10, fontWeight: '500', color: colors.milkText },
  phaseTextRunning: { color: colors.primaryText },

  // 次のお知らせ（5分ごと）までの進み具合。
  track: {
    width: '100%',
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.milkBorder,
    marginTop: 4,
  },
  trackRunning: { backgroundColor: colors.milkBorder },
  trackFill: { height: '100%', borderRadius: 999, backgroundColor: colors.milk },
  trackFillRunning: { backgroundColor: colors.primaryText },

  stopwatchSummary: { fontSize: 12, fontWeight: '700', color: colors.milkText, marginTop: 6, fontVariant: ['tabular-nums'] },
});
