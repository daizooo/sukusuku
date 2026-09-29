'use client';

import { useState } from 'react';
import { Check, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react';
import type { BreastSide, FeedingMethod, MilkLog, NursingPhase, PumpedBatch } from '@/types/app';
import {
  BREAST_MINUTE_OPTIONS,
  formatBatchTime,
  formatStopwatch,
  getNursingPhaseLabel,
  getSideLabel,
  pumpedStockMl,
  selectablePumpedBatches,
  sumBatchesMl,
} from '@/lib/careLogUtils';
import {
  NURSING_PHASES,
  NURSING_PHASE_MINUTES,
  NURSING_PHASE_MS,
  nursingMinutes,
  type NursingPhaseValues,
  type NursingTimer,
} from '@/lib/nursingTimer';
import { isSameDay, parseDateTimeInput, toDateString, toTimeInputValue } from '@/lib/dateUtils';
import {
  DateTimeField,
  DeleteButton,
  FEEDING_ENTRY_MODE_OPTIONS,
  FEEDING_METHOD_OPTIONS,
  FieldLabel,
  HintBanner,
  LogModalShell,
  NoteField,
  OptionGrid,
  Segmented,
  SubmitButton,
} from './logModalParts';

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
  /** 授乳1セット（左→右→ゲップ）のストップウォッチ。新規に記録するときだけ使う。 */
  timer: NursingTimer;
  /** 搾乳ストックの全量（使用済みも含む）。「搾乳」を選んだときの選択肢に使う。 */
  pumpedBatches: PumpedBatch[];
  /**
   * 搾乳ストックの1パックを丸ごと捨てる / 捨てたのを取り消す。
   * この記録の保存とは別に、押したその場で反映される。
   */
  onDiscardBatch: (id: string, discarded: boolean) => void;
  /** 「搾った」に切り替える。搾乳の入力画面へ移る（新規追加のときだけ出す）。 */
  onSwitchToPumping: () => void;
  /** 新規追加のときに最初から選んでおく種類。搾乳の入力画面から戻ってきたときに使う。 */
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
  return startedAt;
};

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function MilkLogModal({ show, ...props }: MilkLogModalProps & { show: boolean }) {
  if (!show) return null;
  return <MilkLogModalBody {...props} />;
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
  const [drankEdited, setDrankEdited] = useState(() => !!(log?.method === 'pumped' && log.discardedMl));
  // 計測した時間があれば、開き直したときもその値から始める。
  const measured = !log && timer.hasSession;
  // 未選択と「0分」を区別するため、初期値は undefined にしておく。
  const initialLeft = log?.leftMinutes ?? (measured ? nursingMinutes(timer.total.left) : undefined);
  const initialRight = log?.rightMinutes ?? (measured ? nursingMinutes(timer.total.right) : undefined);
  const [leftMinutes, setLeftMinutes] = useState<number | undefined>(initialLeft);
  const [rightMinutes, setRightMinutes] = useState<number | undefined>(initialRight);
  // ボタンに無い分数は直接入力欄の側で持つ。
  const [customLeft, setCustomLeft] = useState(() => toCustomMinutes(initialLeft));
  const [customRight, setCustomRight] = useState(() => toCustomMinutes(initialRight));
  const [lastSide, setLastSide] = useState<BreastSide | undefined>(
    log?.lastSide ?? (measured ? (timer.lastSide ?? undefined) : undefined),
  );
  // 分数を手で選び直した側は、計測した値より手入力を優先する。
  const [editedLeft, setEditedLeft] = useState(false);
  const [editedRight, setEditedRight] = useState(false);
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  // ただし母乳を測っているなら、その計測を始めた時刻（＝飲ませ始めた時刻）を出す。
  const [date, setDate] = useState(() => toDateString(log?.time ?? baseDate));
  const [time, setTime] = useState(() => {
    if (log) return toTimeInputValue(log.time);
    const now = new Date();
    // 測っているのは母乳なので、母乳で開いたときだけ。ミルクや搾乳で開いたなら
    // いまの時刻のまま（測っている授乳とは別の記録を足しに来ている）。
    const measuredStart =
      method === 'breast' ? measuredStartTime(timer.sessionStartedAt, baseDate, now) : null;
    return toTimeInputValue(measuredStart ?? now);
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
    amountInput !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0 ? Math.round(parsedAmount) : null;
  const formulaInvalid = amountMl === null;

  const toggleBatch = (id: string) =>
    setSelectedBatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 捨てたパックは飲ませられないので、選んでいたら外しておく。
  const handleDiscardBatch = (id: string) => {
    setSelectedBatchIds((prev) => prev.filter((x) => x !== id));
    onDiscardBatch(id, true);
  };

  // 計測した時間をそのまま記録する。計測中のまま保存されても、その分を含める。
  // 分数を手で選び直した側は、その値を優先する。
  const measuring = showTimer && timer.hasSession;
  const recordedLeft = measuring && !editedLeft ? nursingMinutes(timer.total.left) : (leftMinutes ?? 0);
  const recordedRight = measuring && !editedRight ? nursingMinutes(timer.total.right) : (rightMinutes ?? 0);

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
  // 押した側が「最後に飲ませた側」になる（ゲップは飲ませていないので変えない）。
  const handleTogglePhase = (phase: NursingPhase) => {
    applyTotal(timer.togglePhase(phase));
    if (phase === 'burp') return;
    setLastSide(phase);
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
  };

  const handleSubmit = () => {
    const base = { method, time: parseDateTimeInput(date, time, log?.time ?? baseDate), note };
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
      lastSide: left === 0 && right === 0 ? undefined : lastSide,
    });
  };

  return (
    <LogModalShell
      title={log ? '授乳の記録を編集' : '授乳を記録'}
      onClose={onClose}
      // 母乳/搾乳/ミルクの切り替えは、選び直したときに動かないよう一番上に固定しておく。
      subheader={
        <div className="space-y-3">
          <div>
            <FieldLabel>種類</FieldLabel>
            <Segmented options={FEEDING_METHOD_OPTIONS} value={method} onChange={setMethod} />
          </div>
          {/* 搾った分は飲ませた分とは別の記録（搾乳ストックの1パック）になるので、押すと
              搾乳の入力画面へ移る。搾乳以外では関わらないため、搾乳を選んだときだけ出す。
              入力欄と一緒にスクロールして流れていかないよう、種類のすぐ下に固定して置く。
              編集中は記録の種類を変えられないので出さない。 */}
          {!log && method === 'pumped' && (
            <div>
              <FieldLabel>搾乳を</FieldLabel>
              <Segmented
                options={FEEDING_ENTRY_MODE_OPTIONS}
                value="feed"
                onChange={(next) => {
                  if (next === 'pump') onSwitchToPumping();
                }}
              />
            </div>
          )}
        </div>
      }
      footer={
        <>
          <SubmitButton
            accent="milk"
            onClick={handleSubmit}
            disabled={(method === 'pumped' && pumpedInvalid) || (method === 'formula' && formulaInvalid)}
          >
            保存する
          </SubmitButton>
          {log ? (
            <DeleteButton onDelete={onDelete} />
          ) : (
            // 記録にする前でも、測り始めた授乳ごと取りやめられるようにする。
            // 間違えて始めた計測が、記録するまで消せないままになるのを避ける。
            timer.hasSession && (
              <DeleteButton label="計測中の授乳を削除する" onDelete={handleDeleteSession} />
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
              <span className="font-bold">{getSideLabel(nextSide)}</span>からがおすすめ
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
          <div>
            <FieldLabel>最後に飲ませた側</FieldLabel>
            <OptionGrid options={SIDE_OPTIONS} value={lastSide} onChange={setLastSide} columns={2} accent="milk" />
            <p className="text-[10px] text-gray-400 mt-1.5">次にどちらから授乳するかの目安になります。</p>
          </div>
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
        <label className="block">
          <FieldLabel>量（ml）</FieldLabel>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
            placeholder="ml を直接入力"
          />
        </label>
      )}

      <DateTimeField
        label="日時"
        date={date}
        time={time}
        onChangeDate={setDate}
        onChangeTime={setTime}
      />
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
  /** 飲ませずに丸ごと捨てる。押したその場でストックから外れる。 */
  onDiscard: (id: string) => void;
  /** 捨てたのを取り消してストックに戻す。 */
  onUndoDiscard: (id: string) => void;
}

/**
 * 飲ませる搾乳を搾乳ストックから選ぶ。選んだパックの合計が、飲ませるために用意した量になる。
 *
 * どれだけ用意したかは、どの搾乳を使ったかで決まる（母乳パック1つ＝1回の搾乳）ため、
 * ここはパックを選ぶ形にしている。実際に飲んだ量は下の「飲んだ量」で直す。選んだ搾乳は
 * ストックから外れ、この記録を消すとストックに戻る。古いものから使えるよう、並びは搾った順。
 *
 * いまのストックが1パックずつ並ぶ場所でもあるので、置きすぎた分をここから
 * 「破棄」できるようにしている。破棄はこの記録の保存を待たずその場で反映されるため、
 * 押し間違えてもすぐ戻せるよう、直前に破棄したパックは取り消せる形で残す。
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

  const discardedNotice = discardedBatch && (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-100 px-3 py-2">
      <span className="text-[11px] text-gray-600 tabular-nums min-w-0 truncate">
        {formatBatchTime(discardedBatch)}（{discardedBatch.amountMl}ml）を破棄しました
      </span>
      <button
        type="button"
        onClick={handleUndo}
        className="shrink-0 text-[11px] font-bold text-rose-700 hover:text-rose-900"
      >
        取り消す
      </button>
    </div>
  );

  if (batches.length === 0) {
    return (
      <div className="space-y-2">
        {discardedNotice}
        <HintBanner accent="pumping">
          搾乳ストックがありません。上の「搾った」に切り替えて、搾った分を先に記録してください。
        </HintBanner>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-1.5">
        <FieldLabel>飲ませる搾乳を選ぶ</FieldLabel>
        <span className="text-[11px] text-gray-500 tabular-nums mb-1.5">残り {stockMl}ml</span>
      </div>

      {discardedNotice}

      {/* モーダルの中身ごとスクロールするので、この一覧の中では二重にスクロールさせない。 */}
      <div className={`space-y-1.5 ${discardedBatch ? 'mt-2' : ''}`}>
        {batches.map((batch) => {
          const selected = selectedIds.includes(batch.id);
          return (
            <div
              key={batch.id}
              className={`flex items-stretch rounded-lg border overflow-hidden ${
                selected ? 'bg-rose-50 border-rose-400' : 'bg-white border-gray-300'
              }`}
            >
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onToggle(batch.id)}
                className={`flex-1 min-w-0 flex items-center justify-between px-3 py-2.5 text-sm transition ${
                  selected ? 'text-rose-800' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center min-w-0">
                  <span
                    aria-hidden
                    className={`w-4 h-4 mr-2 shrink-0 rounded border flex items-center justify-center ${
                      selected ? 'bg-rose-600 border-rose-600' : 'border-gray-300'
                    }`}
                  >
                    {selected && <Check size={12} className="text-white" />}
                  </span>
                  <span className="tabular-nums truncate">{formatBatchTime(batch)}</span>
                </span>
                <span className="font-bold tabular-nums shrink-0 ml-2">{batch.amountMl}ml</span>
              </button>
              {/* 置きすぎた分をここで捨てる。すでに飲ませたパックは捨てようがないので出さない。 */}
              {batch.usedBy === null && (
                <button
                  type="button"
                  onClick={() => handleDiscard(batch)}
                  aria-label={`${formatBatchTime(batch)}の搾乳を破棄する`}
                  className={`shrink-0 px-3 flex items-center border-l text-[11px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-rose-700 ${
                    selected ? 'border-rose-200' : 'border-gray-200'
                  }`}
                >
                  破棄
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-xs font-bold text-rose-700 tabular-nums">
        {selectedIds.length === 0
          ? '搾乳を選んでください'
          : `合計 ${selectedMl}ml を用意`}
      </p>
      <p className="mt-1 text-[10px] text-gray-400">
        飲ませずに捨てるときは「破棄」。この記録を保存しなくてもストックから外れます。
      </p>
    </div>
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
    <div>
      <div className="flex items-end justify-between">
        <FieldLabel>飲んだ量（ml）</FieldLabel>
        {edited && (
          <button
            type="button"
            onClick={onResetToPrepared}
            className="text-[11px] text-rose-700 font-medium mb-1.5 hover:text-rose-900"
          >
            全部飲んだ
          </button>
        )}
      </div>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={preparedMl}
        aria-label="飲んだ量（ml）"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 tabular-nums"
        placeholder="ml を直接入力"
      />
      <p className={`mt-1.5 text-[11px] tabular-nums ${tooMuch ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
        {tooMuch
          ? `用意した ${preparedMl}ml より多くは飲めません。搾乳を選び足してください。`
          : discardedMl > 0
            ? `飲み残し ${discardedMl}ml は捨てた扱いで記録します。`
            : '飲みきれなかったときは、実際に飲んだ量に直してください。'}
      </p>
    </div>
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
    <div>
      <FieldLabel>{label}</FieldLabel>
      <OptionGrid
        options={MINUTE_OPTIONS}
        value={custom === '' ? value : undefined}
        onChange={onSelect}
        columns={7}
        accent="milk"
      />
      <input
        type="number"
        inputMode="numeric"
        min={0}
        aria-label={`${label}を直接入力`}
        value={custom}
        onChange={(e) => onCustomChange(e.target.value)}
        className="mt-1.5 w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
        placeholder="上記以外の分数を直接入力"
      />
    </div>
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
 * いま行っている区切りをタップして使い、5分たつとお知らせ（音・バイブ）が1回鳴る。
 * 授乳中は画面を見られないので、次へ移る合図は鳴り方で受け取り、この画面は
 * 「いまどこまで進んだか」を後から確かめるためのものとして作っている。
 * ゲップの5分まで終わると1セット完了として計測が止まる（止め忘れても数え続けない）。
 *
 * 順番はあくまで目安で、どの区切りからでも測れる（片側しか飲まない回もあるため）。
 * ゲップは飲ませた時間ではないので、記録には残さず計測とお知らせにだけ使う。
 *
 * 表示している時間は「いまのセット」のもので、記録に入るのは全セットの合計。
 * 1セット終えたあとに区切りをもう一度タップすれば、次のセットとして0から測り直す
 * （お知らせもまた鳴る）。急いで飲ませ始めて途中から記録したときのために、
 * 測れなかったセットを数で足せるようにしている。
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
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-bold text-amber-700">
          授乳を計測
          <span className="ml-1.5 font-bold text-amber-800">{setNumber}セット目</span>
        </span>
        {hasSession && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-amber-700 font-medium flex items-center hover:text-amber-900"
          >
            <RotateCcw size={12} className="mr-1" /> リセット
          </button>
        )}
      </div>
      <p className="text-[10px] text-gray-500 mb-2">
        {order.map((phase) => `${getNursingPhaseLabel(phase)}${NURSING_PHASE_MINUTES}分`).join(' → ')}
        で1セット。{NURSING_PHASE_MINUTES}分でお知らせが1回鳴り、ゲップまで終わると計測が止まります。
        時間はこのセットのぶんで、記録に入るのは全セットの合計です。
      </p>
      {/* ボタンの並びは「左・右・ゲップ」で固定する。おすすめの開始側で並べ替えると
          押すたびに左右の位置が入れ替わり、どちらを押しているのか分かりにくいため。
          どこから始めるかは、上の案内文とハイライトで示す。 */}
      <div className="grid grid-cols-3 gap-2">
        {NURSING_PHASES.map((phase) => {
          const isRunning = runningPhase === phase;
          const done = isDone(phase);
          const isNext = !isRunning && phase === nextPhase;
          return (
            <button
              key={phase}
              type="button"
              aria-pressed={isRunning}
              onClick={() => onTogglePhase(phase)}
              className={`rounded-xl border p-2 flex flex-col items-center transition active:scale-[0.98] ${
                isRunning
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : isNext
                    ? 'bg-white border-amber-400 text-gray-700 hover:bg-amber-100'
                    : 'bg-white border-amber-200 text-gray-700 hover:bg-amber-100'
              }`}
            >
              <span
                className={`text-xs font-bold flex items-center ${isRunning ? 'text-amber-50' : done ? 'text-amber-700' : 'text-gray-500'}`}
              >
                {done && <Check size={11} className="mr-0.5" />}
                {getNursingPhaseLabel(phase)}
              </span>
              <span className="text-xl font-bold tabular-nums tracking-tight">
                {formatStopwatch(elapsed[phase])}
              </span>
              {/* 5分までの進み具合。数字を読まなくても、あとどれくらいかが分かる。 */}
              <span
                aria-hidden
                className={`mt-1 h-1 w-full rounded-full overflow-hidden ${isRunning ? 'bg-amber-400' : 'bg-amber-100'}`}
              >
                <span
                  className={`block h-full rounded-full ${isRunning ? 'bg-white' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, (elapsed[phase] / NURSING_PHASE_MS) * 100)}%` }}
                />
              </span>
              <span
                className={`mt-1 text-[10px] font-medium flex items-center ${isRunning ? 'text-amber-50' : 'text-amber-700'}`}
              >
                {isRunning ? (
                  <>
                    <Pause size={10} className="mr-0.5" /> 停止
                  </>
                ) : (
                  <>
                    <Play size={10} className="mr-0.5" /> 開始
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {guide && <p className="text-[11px] font-bold text-amber-700 mt-2">{guide}</p>}
      {hasSession ? (
        <>
          <p className="text-[11px] font-bold text-amber-700 mt-1">
            左{recordedLeft}分・右{recordedRight}分で記録します
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            止めるのを忘れたときは、下の「左（分）」「右（分）」で実際の時間に直せます。
            ゲップの時間は記録には残りません。
          </p>
        </>
      ) : (
        <p className="text-[10px] text-gray-500 mt-1">
          別の区切りをタップすると自動で切り替わります。この画面を閉じても計測は続きます。
          記録に残るのは左右の分数だけです。
        </p>
      )}

      {/* 急いで飲ませ始めて、2セット目から記録することがある。測れなかった分を
          ここで数えて記録に足す（実際の時間と違えば、下の分数で直せる）。 */}
      <div className="mt-2 pt-2 border-t border-amber-200 flex items-center justify-between gap-2">
        <span className="text-[10px] text-gray-500 leading-tight min-w-0">
          測る前に済ませたセット
          <span className="block text-gray-400">
            1セットにつき左右{NURSING_PHASE_MINUTES}分の目安で記録に足します
          </span>
        </span>
        <div className="shrink-0 flex items-center">
          <button
            type="button"
            aria-label="測る前に済ませたセットを1つ減らす"
            disabled={untrackedSets === 0}
            onClick={() => onChangeUntrackedSets(untrackedSets - 1)}
            className="w-7 h-7 rounded-lg border border-amber-300 bg-white flex items-center justify-center text-amber-700 transition hover:bg-amber-100 active:scale-95 disabled:opacity-30 disabled:hover:bg-white"
          >
            <Minus size={13} />
          </button>
          <span className="w-7 text-center text-sm font-bold tabular-nums text-amber-800">
            {untrackedSets}
          </span>
          <button
            type="button"
            aria-label="測る前に済ませたセットを1つ増やす"
            onClick={() => onChangeUntrackedSets(untrackedSets + 1)}
            className="w-7 h-7 rounded-lg border border-amber-300 bg-white flex items-center justify-center text-amber-700 transition hover:bg-amber-100 active:scale-95"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
