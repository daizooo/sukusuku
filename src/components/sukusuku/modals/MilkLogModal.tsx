'use client';

import { useState } from 'react';
import { Check, Pause, Play, RotateCcw } from 'lucide-react';
import type { BreastSide, FeedingMethod, MilkLog, PumpedBatch } from '@/types/app';
import {
  BREAST_MINUTE_OPTIONS,
  MILK_AMOUNT_OPTIONS,
  formatBatchTime,
  formatStopwatch,
  getSideLabel,
  pumpedStockMl,
  selectablePumpedBatches,
  sumBatchesMl,
} from '@/lib/careLogUtils';
import { nursingMinutes, type NursingTimer } from '@/lib/nursingTimer';
import { parseDateTimeInput, toDateString, toTimeInputValue } from '@/lib/dateUtils';
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
  /** 母乳の左右別ストップウォッチ。新規に記録するときだけ使う。 */
  timer: NursingTimer;
  /** 搾乳ストックの全量（使用済みも含む）。「搾乳」を選んだときの選択肢に使う。 */
  pumpedBatches: PumpedBatch[];
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

const AMOUNT_OPTIONS = MILK_AMOUNT_OPTIONS.map((ml) => ({ value: ml, label: String(ml) }));
const MINUTE_OPTIONS = BREAST_MINUTE_OPTIONS.map((min) => ({ value: min, label: String(min) }));

/** ボタンに無い分数（計測した端数や、止め忘れを直した値）だけ直接入力欄に出す。 */
const toCustomMinutes = (minutes: number | undefined): string =>
  minutes !== undefined && !BREAST_MINUTE_OPTIONS.includes(minutes) ? String(minutes) : '';

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
  onSwitchToPumping,
  initialMethod,
  onClose,
  onSubmit,
  onDelete,
}: MilkLogModalProps) {
  const [method, setMethod] = useState<FeedingMethod>(log?.method ?? initialMethod ?? 'breast');
  const [amountMl, setAmountMl] = useState<number>(log?.amountMl ?? 100);
  // 「搾乳」で飲ませる搾乳ストック。編集中なら、その記録が使っているパックを選んだ状態で開く。
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>(() => log?.pumpedFrom ?? []);
  const [customAmount, setCustomAmount] = useState(() =>
    log?.amountMl && !MILK_AMOUNT_OPTIONS.includes(log.amountMl) ? String(log.amountMl) : '',
  );
  // 「搾乳」で実際に飲んだ量。飲みきれず量を打ち直したときだけ、この入力欄の側で持つ。
  const [drankInput, setDrankInput] = useState(() =>
    log?.method === 'pumped' && log.discardedMl ? String(log.amountMl ?? 0) : '',
  );
  // 打ち直していない間は、選んだ搾乳の合計（＝全部飲んだ）をそのまま使う。
  const [drankEdited, setDrankEdited] = useState(() => !!(log?.method === 'pumped' && log.discardedMl));
  // 計測した時間があれば、開き直したときもその値から始める。
  const measured = !log && timer.hasSession;
  // 未選択と「0分」を区別するため、初期値は undefined にしておく。
  const initialLeft = log?.leftMinutes ?? (measured ? nursingMinutes(timer.leftMs) : undefined);
  const initialRight = log?.rightMinutes ?? (measured ? nursingMinutes(timer.rightMs) : undefined);
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
  const [date, setDate] = useState(() => toDateString(log?.time ?? baseDate));
  const [time, setTime] = useState(() => toTimeInputValue(log?.time ?? new Date()));
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

  const toggleBatch = (id: string) =>
    setSelectedBatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 計測した時間をそのまま記録する。計測中のまま保存されても、その分を含める。
  // 分数を手で選び直した側は、その値を優先する。
  const measuring = showTimer && timer.hasSession;
  const recordedLeft = measuring && !editedLeft ? nursingMinutes(timer.leftMs) : (leftMinutes ?? 0);
  const recordedRight = measuring && !editedRight ? nursingMinutes(timer.rightMs) : (rightMinutes ?? 0);

  const handleCustomAmount = (value: string) => {
    setCustomAmount(value);
    const parsed = Number(value);
    if (value !== '' && Number.isFinite(parsed) && parsed > 0) setAmountMl(parsed);
  };

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

  // 計測を始める・止める・切り替えるたびに、その時点の合計を分数の入力欄へ入れる。
  // 押した側が「最後に飲ませた側」になる。
  const handleToggleSide = (side: BreastSide) => {
    const settled = timer.toggleSide(side);
    const left = nursingMinutes(settled.leftMs);
    const right = nursingMinutes(settled.rightMs);
    setLeftMinutes(left);
    setRightMinutes(right);
    setCustomLeft(toCustomMinutes(left));
    setCustomRight(toCustomMinutes(right));
    setLastSide(side);
    // 測り直した側は計測の値に戻す。
    if (side === 'left') setEditedLeft(false);
    else setEditedRight(false);
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
            disabled={method === 'pumped' && pumpedInvalid}
          >
            保存する
          </SubmitButton>
          {log && <DeleteButton onDelete={onDelete} />}
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
            <BreastStopwatch
              leftMs={timer.leftMs}
              rightMs={timer.rightMs}
              runningSide={timer.runningSide}
              hasSession={timer.hasSession}
              recordedLeft={recordedLeft}
              recordedRight={recordedRight}
              onToggleSide={handleToggleSide}
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
        <>
          <div>
            <FieldLabel>量（ml）</FieldLabel>
            <OptionGrid
              options={AMOUNT_OPTIONS}
              value={customAmount === '' ? amountMl : undefined}
              onChange={(value) => {
                setAmountMl(value);
                setCustomAmount('');
              }}
              columns={5}
              accent="milk"
            />
          </div>
          <label className="block">
            <FieldLabel>上記以外の量</FieldLabel>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={customAmount}
              onChange={(e) => handleCustomAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder="ml を直接入力"
            />
          </label>
        </>
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
}

/**
 * 飲ませる搾乳を搾乳ストックから選ぶ。選んだパックの合計が、飲ませるために用意した量になる。
 *
 * どれだけ用意したかは、どの搾乳を使ったかで決まる（母乳パック1つ＝1回の搾乳）ため、
 * ここはパックを選ぶ形にしている。実際に飲んだ量は下の「飲んだ量」で直す。選んだ搾乳は
 * ストックから外れ、この記録を消すとストックに戻る。古いものから使えるよう、並びは搾った順。
 */
function PumpedBatchPicker({ batches, selectedIds, selectedMl, stockMl, onToggle }: PumpedBatchPickerProps) {
  if (batches.length === 0) {
    return (
      <HintBanner accent="pumping">
        搾乳ストックがありません。上の「搾った」に切り替えて、搾った分を先に記録してください。
      </HintBanner>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-1.5">
        <FieldLabel>飲ませる搾乳を選ぶ</FieldLabel>
        <span className="text-[11px] text-gray-500 tabular-nums mb-1.5">残り {stockMl}ml</span>
      </div>

      {/* モーダルの中身ごとスクロールするので、この一覧の中では二重にスクロールさせない。 */}
      <div className="space-y-1.5">
        {batches.map((batch) => {
          const selected = selectedIds.includes(batch.id);
          return (
            <button
              key={batch.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(batch.id)}
              className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition active:scale-[0.99] ${
                selected
                  ? 'bg-rose-50 border-rose-400 text-rose-800'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
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
          );
        })}
      </div>

      <p className="mt-2 text-xs font-bold text-rose-700 tabular-nums">
        {selectedIds.length === 0
          ? '搾乳を選んでください'
          : `${selectedIds.length}パック・合計 ${selectedMl}ml を用意`}
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

interface BreastStopwatchProps {
  leftMs: number;
  rightMs: number;
  runningSide: BreastSide | null;
  hasSession: boolean;
  /** この内容で保存したときに記録される分数。 */
  recordedLeft: number;
  recordedRight: number;
  onToggleSide: (side: BreastSide) => void;
  onReset: () => void;
}

/** 左右それぞれの授乳時間を測るストップウォッチ。飲ませている側をタップして使う。 */
function BreastStopwatch({
  leftMs,
  rightMs,
  runningSide,
  hasSession,
  recordedLeft,
  recordedRight,
  onToggleSide,
  onReset,
}: BreastStopwatchProps) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-bold text-amber-700">授乳時間を計測</span>
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
      <div className="grid grid-cols-2 gap-2">
        {SIDE_OPTIONS.map((side) => {
          const isRunning = runningSide === side.value;
          return (
            <button
              key={side.value}
              type="button"
              aria-pressed={isRunning}
              onClick={() => onToggleSide(side.value)}
              className={`rounded-xl border p-3 flex flex-col items-center transition active:scale-[0.98] ${
                isRunning
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : 'bg-white border-amber-200 text-gray-700 hover:bg-amber-100'
              }`}
            >
              <span className={`text-xs font-bold ${isRunning ? 'text-amber-50' : 'text-gray-500'}`}>
                {side.label}
              </span>
              <span className="text-2xl font-bold tabular-nums tracking-tight">
                {formatStopwatch(side.value === 'left' ? leftMs : rightMs)}
              </span>
              <span className={`mt-1 text-[10px] font-medium flex items-center ${isRunning ? 'text-amber-50' : 'text-amber-700'}`}>
                {isRunning ? (
                  <>
                    <Pause size={10} className="mr-1" /> 計測中 / タップで停止
                  </>
                ) : (
                  <>
                    <Play size={10} className="mr-1" /> タップで開始
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {hasSession ? (
        <>
          <p className="text-[11px] font-bold text-amber-700 mt-2">
            左{recordedLeft}分・右{recordedRight}分で記録します
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            止めるのを忘れたときは、下の「左（分）」「右（分）」で実際の時間に直せます。
          </p>
        </>
      ) : (
        <p className="text-[10px] text-gray-500 mt-2">
          反対側をタップすると自動で切り替わります。この画面を閉じても計測は続きます。
        </p>
      )}
    </div>
  );
}
