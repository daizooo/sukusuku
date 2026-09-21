import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  BreastSide,
  FeedingEntryMode,
  FeedingMethod,
  MilkLog,
  NursingPhase,
  PumpedBatch,
} from '@/types/app';
import {
  BREAST_MINUTE_OPTIONS,
  FEEDING_ENTRY_MODE_OPTIONS,
  FEEDING_METHOD_OPTIONS,
  formatBatchTime,
  formatStopwatch,
  getNursingPhaseLabel,
  getSideLabel,
  pumpedStockMl,
  selectablePumpedBatches,
  sumBatchesMl,
} from '@/lib/careLogUtils';
import {
  NURSING_PHASE_MINUTES,
  NURSING_PHASE_MS,
  NURSING_PHASES,
  nursingMinutes,
  type NursingPhaseValues,
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

/**
 * 1セットで測る順番。前回の続き（おすすめの側）から始めて、反対側、最後にゲップ。
 * 順番はあくまで目安なので、どの区切りからでもタップして測れる。
 */
const setOrder = (startSide: BreastSide): NursingPhase[] =>
  startSide === 'right' ? ['right', 'left', 'burp'] : ['left', 'right', 'burp'];

const MINUTE_OPTIONS = BREAST_MINUTE_OPTIONS.map((min) => ({ value: min, label: String(min) }));

/** ボタンに無い分数（計測した端数や、止め忘れを直した値）だけ直接入力欄に出す。 */
const toCustomMinutes = (minutes: number | undefined): string =>
  minutes !== undefined && !BREAST_MINUTE_OPTIONS.includes(minutes) ? String(minutes) : '';

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
  const initialLeft = log?.leftMinutes ?? (measured ? nursingMinutes(timer.total.left) : undefined);
  const initialRight =
    log?.rightMinutes ?? (measured ? nursingMinutes(timer.total.right) : undefined);
  const [leftMinutes, setLeftMinutes] = useState<number | undefined>(initialLeft);
  const [rightMinutes, setRightMinutes] = useState<number | undefined>(initialRight);
  // ボタンに無い分数は直接入力欄の側で持つ。
  const [customLeft, setCustomLeft] = useState(() => toCustomMinutes(initialLeft));
  const [customRight, setCustomRight] = useState(() => toCustomMinutes(initialRight));
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
    measuring && !editedLeft ? nursingMinutes(timer.total.left) : (leftMinutes ?? 0);
  const recordedRight =
    measuring && !editedRight ? nursingMinutes(timer.total.right) : (rightMinutes ?? 0);
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

  // 計測の合計（測っていないセットぶんを含む）を分数の入力欄へ入れる。
  const applyTotal = (total: NursingPhaseValues) => {
    const left = nursingMinutes(total.left);
    const right = nursingMinutes(total.right);
    setLeftMinutes(left);
    setRightMinutes(right);
    setCustomLeft(toCustomMinutes(left));
    setCustomRight(toCustomMinutes(right));
  };

  // 計測を始める・止める・切り替えるたびに、その時点の合計を分数の入力欄へ入れる。
  // 押した区切りが「最後に飲ませた側」になる（ゲップは飲ませていないので変えない）。
  const handleTogglePhase = (phase: NursingPhase) => {
    applyTotal(timer.togglePhase(phase));
    if (phase === 'burp') return;
    setLastSide(phase);
    setEditedSide(false);
    // 測り直した側は計測の値に戻す。
    if (phase === 'left') setEditedLeft(false);
    else setEditedRight(false);
  };

  // 「測る前に済ませたセット」を増減する。左右どちらも計測の値に戻して、
  // 足した分がそのまま記録の分数に出るようにする。
  const handleChangeUntrackedSets = (count: number) => {
    applyTotal(timer.setUntrackedSets(count));
    setEditedLeft(false);
    setEditedRight(false);
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
              <NursingSetTimer
                elapsed={timer.elapsed}
                setNumber={timer.setNumber}
                untrackedSets={timer.untrackedSets}
                onChangeUntrackedSets={handleChangeUntrackedSets}
                runningPhase={timer.runningPhase}
                hasSession={timer.hasSession}
                order={setOrder(nextSide ?? 'left')}
                recordedLeft={recordedLeft}
                recordedRight={recordedRight}
                onTogglePhase={handleTogglePhase}
                onReset={handleResetTimer}
              />
            )}
            <MinuteField
              label="左（分）"
              value={leftMinutes}
              custom={customLeft}
              onSelect={(value) => applyMinutes('left', value, '')}
              onCustomChange={(value) => handleCustomMinutes('left', value)}
            />
            <MinuteField
              label="右（分）"
              value={rightMinutes}
              custom={customRight}
              onSelect={(value) => applyMinutes('right', value, '')}
              onCustomChange={(value) => handleCustomMinutes('right', value)}
            />
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
              <Text style={styles.note}>次にどちらから授乳するかの目安になります。</Text>
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
  value: number | undefined;
  /** ボタンに無い分数を入れている間だけ中身が入る。 */
  custom: string;
  onSelect: (value: number) => void;
  onCustomChange: (value: string) => void;
}

/**
 * 母乳の授乳時間。よく使う分数はボタンで選び、それ以外は直接入力する。
 * 計測を止め忘れて長い時間が入ってしまったときも、ここで実際の時間に直せる。
 */
function MinuteField({ label, value, custom, onSelect, onCustomChange }: MinuteFieldProps) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <OptionGrid
        options={MINUTE_OPTIONS}
        value={custom === '' ? value : undefined}
        onChange={onSelect}
        columns={7}
        accent="milk"
      />
      <View style={styles.customMinutes}>
        <NumberInput
          value={custom}
          onChangeText={onCustomChange}
          placeholder="上記以外の分数を直接入力"
          accessibilityLabel={`${label}を直接入力`}
        />
      </View>
    </View>
  );
}

interface NursingSetTimerProps {
  /** いま測っているセットの、区切りごとの時間(ミリ秒)。計測中の分を含む。 */
  elapsed: NursingPhaseValues;
  /** いま何セット目か。 */
  setNumber: number;
  /** 測る前に済ませたセットの数。 */
  untrackedSets: number;
  onChangeUntrackedSets: (count: number) => void;
  runningPhase: NursingPhase | null;
  hasSession: boolean;
  /** 測る順番。前回の続き（おすすめの側）から数える。ボタンの並びは変えない。 */
  order: NursingPhase[];
  /** この内容で保存したときに記録される分数。 */
  recordedLeft: number;
  recordedRight: number;
  onTogglePhase: (phase: NursingPhase) => void;
  onReset: () => void;
}

/** 残り時間を「M:SS」で。区切りの目安(5分)までどれくらいかを見るためのもの。 */
const formatRemaining = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

/**
 * 授乳1セット（左5分 → 右5分 → ゲップ5分）を測るストップウォッチ。
 *
 * いま行っている区切りをタップして使い、5分たつとお知らせが1回鳴る。
 * 授乳中は画面を見られないので、次へ移る合図は鳴り方で受け取り、この画面は
 * 「いまどこまで進んだか」を後から確かめるためのものとして作っている。
 * ゲップの5分まで終わると1セット完了として計測が止まる（止め忘れても数え続けない）。
 *
 * 順番はあくまで目安で、どの区切りからでも測れる（片側しか飲まない回もあるため）。
 * ゲップは飲ませた時間ではないので、記録には残さず計測とお知らせにだけ使う。
 *
 * 表示している時間は「いまのセット」のもので、記録に入るのは全セットの合計。
 */
function NursingSetTimer({
  elapsed,
  setNumber,
  untrackedSets,
  onChangeUntrackedSets,
  runningPhase,
  hasSession,
  order,
  recordedLeft,
  recordedRight,
  onTogglePhase,
  onReset,
}: NursingSetTimerProps) {
  const isDone = (phase: NursingPhase) => elapsed[phase] >= NURSING_PHASE_MS;
  // 次に測る区切り。まだ5分に届いていないものを順番に拾う。
  const nextPhase = order.find((phase) => phase !== runningPhase && !isDone(phase)) ?? null;
  const setDone = order.every(isDone);

  const guide = runningPhase
    ? elapsed[runningPhase] < NURSING_PHASE_MS
      ? `${getNursingPhaseLabel(runningPhase)}を計測中 — あと ${formatRemaining(NURSING_PHASE_MS - elapsed[runningPhase])}`
      : nextPhase
        ? `${getNursingPhaseLabel(runningPhase)}は${NURSING_PHASE_MINUTES}分経過 — 次は「${getNursingPhaseLabel(nextPhase)}」へ`
        : `${getNursingPhaseLabel(runningPhase)}は${NURSING_PHASE_MINUTES}分経過 — ${setNumber}セット目が完了`
    : setDone
      ? `${setNumber}セット目が完了。続けるなら「${getNursingPhaseLabel(order[0])}」をタップ`
      : nextPhase
        ? `${hasSession ? '次は' : 'まずは'}「${getNursingPhaseLabel(nextPhase)}」をタップ`
        : '';

  return (
    <View style={styles.stopwatch}>
      <View style={styles.stopwatchHeader}>
        <Text style={styles.stopwatchTitle}>
          授乳を計測 <Text style={styles.setNumber}>{setNumber}セット目</Text>
        </Text>
        {hasSession && (
          <Pressable accessibilityRole="button" onPress={onReset} hitSlop={8}>
            <Text style={styles.reset}>リセット</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.note}>
        {order.map((phase) => `${getNursingPhaseLabel(phase)}${NURSING_PHASE_MINUTES}分`).join(' → ')}
        で1セット。{NURSING_PHASE_MINUTES}分でお知らせが1回鳴り、ゲップまで終わると計測が止まります。
        時間はこのセットのぶんで、記録に入るのは全セットの合計です。
      </Text>

      {/* ボタンの並びは「左・右・ゲップ」で固定する。おすすめの開始側で並べ替えると
          押すたびに左右の位置が入れ替わり、どちらを押しているのか分かりにくいため。
          どこから始めるかは、下の案内文と枠のハイライトで示す。 */}
      <View style={styles.phases}>
        {NURSING_PHASES.map((phase) => {
          const isRunning = runningPhase === phase;
          const done = isDone(phase);
          const isNext = !isRunning && phase === nextPhase;
          const ratio = Math.min(1, elapsed[phase] / NURSING_PHASE_MS);
          return (
            <Pressable
              key={phase}
              accessibilityRole="button"
              accessibilityState={{ selected: isRunning }}
              onPress={() => onTogglePhase(phase)}
              style={[styles.phase, isRunning && styles.phaseRunning, isNext && styles.phaseNext]}
            >
              <Text
                style={[
                  styles.phaseLabel,
                  done && styles.phaseLabelDone,
                  isRunning && styles.phaseTextRunning,
                ]}
              >
                {done ? '✓ ' : ''}
                {getNursingPhaseLabel(phase)}
              </Text>
              <Text style={[styles.phaseTime, isRunning && styles.phaseTextRunning]}>
                {formatStopwatch(elapsed[phase])}
              </Text>
              {/* 5分までの進み具合。数字を読まなくても、あとどれくらいかが分かる。 */}
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

      {guide !== '' && <Text style={styles.guide}>{guide}</Text>}

      {hasSession ? (
        <>
          <Text style={styles.stopwatchSummary}>
            左{recordedLeft}分・右{recordedRight}分で記録します
          </Text>
          <Text style={styles.note}>
            止めるのを忘れたときは、下の「左（分）」「右（分）」で実際の時間に直せます。
            ゲップの時間は記録には残りません。
          </Text>
        </>
      ) : (
        <Text style={styles.note}>
          別の区切りをタップすると自動で切り替わります。この画面を閉じても計測は続きます。
          記録に残るのは左右の分数だけです。
        </Text>
      )}

      {/* 急いで飲ませ始めて、2セット目から記録することがある。測れなかった分を
          ここで数えて記録に足す（実際の時間と違えば、下の分数で直せる）。 */}
      <View style={styles.untracked}>
        <View style={styles.flex}>
          <Text style={styles.untrackedLabel}>測る前に済ませたセット</Text>
          <Text style={styles.untrackedNote}>
            1セットにつき左右{NURSING_PHASE_MINUTES}分の目安で記録に足します
          </Text>
        </View>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="測る前に済ませたセットを1つ減らす"
            disabled={untrackedSets === 0}
            onPress={() => onChangeUntrackedSets(untrackedSets - 1)}
            style={[styles.stepperButton, untrackedSets === 0 && styles.stepperButtonDisabled]}
          >
            <Text style={styles.stepperText}>−</Text>
          </Pressable>
          <Text style={styles.stepperValue}>{untrackedSets}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="測る前に済ませたセットを1つ増やす"
            onPress={() => onChangeUntrackedSets(untrackedSets + 1)}
            style={styles.stepperButton}
          >
            <Text style={styles.stepperText}>＋</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  switchers: { gap: 12 },
  note: { fontSize: 11, color: colors.textFaint, marginTop: 6, lineHeight: 16 },
  customMinutes: { marginTop: 6 },

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
  setNumber: { fontSize: 12, fontWeight: '700', color: colors.milk },
  reset: { fontSize: 11, color: colors.milkText },

  // 1セットの3つの区切り。並びは「左・右・ゲップ」で固定する。
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
  // 次に測る区切りは枠だけ濃くして示す（押している区切りと見間違えないように）。
  phaseNext: { borderColor: colors.milk },
  phaseLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  phaseLabelDone: { color: colors.milkText },
  phaseTime: { fontSize: 20, fontWeight: '700', color: colors.text, marginVertical: 2, fontVariant: ['tabular-nums'] },
  phaseHint: { fontSize: 10, fontWeight: '500', color: colors.milkText },
  phaseTextRunning: { color: colors.primaryText },

  // 5分までの進み具合。
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

  guide: { fontSize: 11, fontWeight: '700', color: colors.milkText, marginTop: 8 },
  stopwatchSummary: { fontSize: 12, fontWeight: '700', color: colors.milkText, marginTop: 6, fontVariant: ['tabular-nums'] },

  // 測る前に済ませたセット。
  untracked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.milkBorder,
  },
  flex: { flex: 1 },
  untrackedLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  untrackedNote: { fontSize: 10, color: colors.textFaint, marginTop: 1, fontWeight: '500' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stepperButton: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: colors.milkBorder,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stepperButtonDisabled: { opacity: 0.3 },
  stepperText: { fontSize: 15, fontWeight: '700', color: colors.milkText },
  stepperValue: {
    width: 28,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: colors.milkText,
    fontVariant: ['tabular-nums'],
  },
});
