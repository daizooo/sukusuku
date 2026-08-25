import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  onClose: () => void;
  onSubmit: (input: MilkLogInput) => void;
  onDelete: () => void;
}

const METHOD_OPTIONS: { value: FeedingMethod; label: string }[] = [
  { value: 'breast', label: '母乳' },
  { value: 'pumped', label: '搾乳' },
  { value: 'formula', label: 'ミルク' },
];

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
  return (
    <Modal visible={show} animationType="slide" onRequestClose={props.onClose}>
      {show ? <MilkLogModalBody {...props} /> : null}
    </Modal>
  );
}

function MilkLogModalBody({
  log,
  baseDate,
  nextSide,
  timer,
  pumpedBatches,
  onClose,
  onSubmit,
  onDelete,
}: MilkLogModalProps) {
  const [method, setMethod] = useState<FeedingMethod>(log?.method ?? 'breast');
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
  const [drankEdited, setDrankEdited] = useState(
    () => !!(log?.method === 'pumped' && log.discardedMl),
  );
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
  const [time, setTime] = useState(() => {
    if (log) return log.time;
    const now = new Date();
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

  const toggleBatch = (id: string) =>
    setSelectedBatchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  // 計測した時間をそのまま記録する。計測中のまま保存されても、その分を含める。
  // 分数を手で選び直した側は、その値を優先する。
  const measuring = showTimer && timer.hasSession;
  const recordedLeft = measuring && !editedLeft ? nursingMinutes(timer.leftMs) : (leftMinutes ?? 0);
  const recordedRight =
    measuring && !editedRight ? nursingMinutes(timer.rightMs) : (rightMinutes ?? 0);

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
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{log ? '授乳・ミルクの記録を編集' : '授乳・ミルクを記録'}</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>閉じる</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Segmented options={METHOD_OPTIONS} value={method} onChange={setMethod} />

        {method === 'breast' ? (
          <>
            {!log && nextSide && (
              <HintBanner accent="milk">
                前回は{getSideLabel(nextSide === 'left' ? 'right' : 'left')}で終了 → 次は
                {getSideLabel(nextSide)}からがおすすめ
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
            <View>
              <FieldLabel>最後に飲ませた側</FieldLabel>
              <OptionGrid
                options={SIDE_OPTIONS}
                value={lastSide}
                onChange={setLastSide}
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
            <View>
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
            </View>
            <View>
              <FieldLabel>上記以外の量</FieldLabel>
              <NumberInput
                value={customAmount}
                onChangeText={handleCustomAmount}
                placeholder="ml を直接入力"
                accessibilityLabel="上記以外の量を直接入力"
              />
            </View>
          </>
        )}

        <DateTimeField label="日時" value={time} onChange={setTime} maximumDate={new Date()} />
        <NoteField value={note} onChange={setNote} placeholder="よく飲んだ / 途中で寝た など" />
        <SubmitButton
          accent="milk"
          onPress={handleSubmit}
          disabled={method === 'pumped' && pumpedInvalid}
        >
          保存する
        </SubmitButton>
        {log && <DeleteButton onPress={onDelete} />}
      </ScrollView>
    </SafeAreaView>
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
 * ここはパックを選ぶ形にしている。実際に飲んだ量は下の「飲んだ量」で直す。
 * 並びは搾った順（古いものから使う）。
 */
function PumpedBatchPicker({
  batches,
  selectedIds,
  selectedMl,
  stockMl,
  onToggle,
}: PumpedBatchPickerProps) {
  if (batches.length === 0) {
    return (
      <HintBanner accent="pumping">
        搾乳ストックがありません。搾乳の記録はフェーズ2で作るまでPWA版で付けてください。
      </HintBanner>
    );
  }

  return (
    <View>
      <View style={styles.pickerHeader}>
        <FieldLabel>飲ませる搾乳を選ぶ</FieldLabel>
        <Text style={styles.stock}>残り {stockMl}ml</Text>
      </View>

      <View style={styles.batchList}>
        {batches.map((batch) => {
          const selected = selectedIds.includes(batch.id);
          return (
            <Pressable
              key={batch.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onToggle(batch.id)}
              style={[styles.batch, selected && styles.batchSelected]}
            >
              <Text style={[styles.batchTime, selected && styles.batchTextSelected]}>
                {selected ? '✓ ' : ''}
                {formatBatchTime(batch)}
              </Text>
              <Text style={[styles.batchAmount, selected && styles.batchTextSelected]}>
                {batch.amountMl}ml
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.batchSummary}>
        {selectedIds.length === 0
          ? '搾乳を選んでください'
          : `${selectedIds.length}パック・合計 ${selectedMl}ml を用意`}
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
    <View style={styles.stopwatch}>
      <View style={styles.stopwatchHeader}>
        <Text style={styles.stopwatchTitle}>授乳時間を計測</Text>
        {hasSession && (
          <Pressable accessibilityRole="button" onPress={onReset} hitSlop={8}>
            <Text style={styles.reset}>リセット</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.sides}>
        {SIDE_OPTIONS.map((side) => {
          const isRunning = runningSide === side.value;
          return (
            <Pressable
              key={side.value}
              accessibilityRole="button"
              accessibilityState={{ selected: isRunning }}
              onPress={() => onToggleSide(side.value)}
              style={[styles.side, isRunning && styles.sideRunning]}
            >
              <Text style={[styles.sideLabel, isRunning && styles.sideTextRunning]}>
                {side.label}
              </Text>
              <Text style={[styles.sideTime, isRunning && styles.sideTextRunning]}>
                {formatStopwatch(side.value === 'left' ? leftMs : rightMs)}
              </Text>
              <Text style={[styles.sideHint, isRunning && styles.sideTextRunning]}>
                {isRunning ? '計測中 / タップで停止' : 'タップで開始'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hasSession ? (
        <>
          <Text style={styles.stopwatchSummary}>
            左{recordedLeft}分・右{recordedRight}分で記録します
          </Text>
          <Text style={styles.note}>
            止めるのを忘れたときは、下の「左（分）」「右（分）」で実際の時間に直せます。
          </Text>
        </>
      ) : (
        <Text style={styles.note}>
          反対側をタップすると自動で切り替わります。この画面を閉じても計測は続きます。
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  close: { fontSize: 14, color: colors.textMuted },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  note: { fontSize: 11, color: colors.textFaint, marginTop: 6, lineHeight: 16 },
  customMinutes: { marginTop: 6 },

  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stock: { fontSize: 11, color: colors.textMuted, marginBottom: 6 },
  batchList: { gap: 6 },
  batch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: colors.surface,
  },
  batchSelected: { backgroundColor: colors.pumpingSurface, borderColor: colors.pumping },
  batchTime: { fontSize: 14, color: colors.textSubtle },
  batchAmount: { fontSize: 14, fontWeight: '700', color: colors.textSubtle },
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
  sides: { flexDirection: 'row', gap: 8 },
  side: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.milkBorder,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  sideRunning: { backgroundColor: colors.milk, borderColor: colors.milk },
  sideLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  sideTime: { fontSize: 24, fontWeight: '700', color: colors.text, marginVertical: 2 },
  sideHint: { fontSize: 10, fontWeight: '500', color: colors.milkText },
  sideTextRunning: { color: colors.primaryText },
  stopwatchSummary: { fontSize: 12, fontWeight: '700', color: colors.milkText, marginTop: 8 },
});
