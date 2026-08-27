'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Droplet,
  FileText,
  List,
  Milk,
  Plus,
  Thermometer,
  TrendingUp,
  Undo2,
  User,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  BreastSide,
  CareLog,
  DiaperKind,
  DiaperLog,
  GrowthRecord,
  LogType,
  MilkLog,
  PumpedBatch,
  PumpingLog,
  TemperatureLog,
} from '@/types/app';
import {
  BADGE_TONE_CLASS,
  DIAPER_KIND_OPTIONS,
  formatCelsius,
  formatStopwatch,
  getLatestTemperature,
  getTemperatureBaseline,
  getLogBadges,
  getLogTimeText,
  getLogTitle,
  getSideLabel,
  isAlertLog,
  isFever,
  sumBatchesMl,
  summarizeLogs,
} from '@/lib/careLogUtils';
import { useNursingTimer } from '@/lib/nursingTimer';
import {
  addDays,
  formatDateWithWeekday,
  isSameDay,
  parseDateString,
  toDateString,
} from '@/lib/dateUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import MilkLogModal, { type MilkLogInput } from '../modals/MilkLogModal';
import DiaperLogModal, { type DiaperLogInput } from '../modals/DiaperLogModal';
import PumpingLogModal, { type PumpingLogInput } from '../modals/PumpingLogModal';
import TemperatureLogModal, { type TemperatureLogInput } from '../modals/TemperatureLogModal';
import GrowthRecordFormModal from '../modals/GrowthRecordFormModal';
import type { GrowthRecordDraft } from '@/lib/growthRecordInput';

interface LogTabProps {
  logs: CareLog[];
  logDate: Date;
  today: Date;
  onChangeLogDate: (date: Date) => void;
  /** プロフィールに登録された子の誕生日（'YYYY-MM-DD'）。成長記録の生後ヶ月の自動計算に使う。 */
  birthDate?: string;
  growthData: GrowthRecord[];
  isLoadingLogs?: boolean;
  isLoadingGrowth?: boolean;
  memberLabel: (id: string | null) => string;
  /** 次に飲ませる乳首。判断材料がなければ null。 */
  nextBreastSide: BreastSide | null;
  /** 搾乳ストックの全量（使用済みも含む）。残りの表示と、飲ませる搾乳の選択に使う。 */
  pumpedBatches: PumpedBatch[];
  onSaveMilkLog: (input: MilkLogInput, existing: MilkLog | null) => void;
  /**
   * おむつは1タップで保存するため、取り消せるように保存できた記録を返してもらう。
   * 編集のときと、保存に失敗したときは null。
   */
  onSaveDiaperLog: (input: DiaperLogInput, existing: DiaperLog | null) => Promise<DiaperLog | null>;
  onSavePumpingLog: (input: PumpingLogInput, existing: PumpingLog | null) => void;
  onSaveTemperatureLog: (input: TemperatureLogInput, existing: TemperatureLog | null) => void;
  /**
   * 平熱に使う直近の体温。表示中の日だけでは求まらないため、日付の送りとは別に受け取る。
   */
  recentTemperatureLogs: TemperatureLog[];
  /** プロフィールに登録された子の名前。平熱を「岳の平熱」の形で出すのに使う。 */
  babyName?: string;
  onDeleteLog: (id: string) => void;
  onAddGrowthRecord: (draft: GrowthRecordDraft) => void;
  onUpdateGrowthRecord: (record: GrowthRecord, draft: GrowthRecordDraft) => void;
  onDeleteGrowthRecord: (id: string) => void;
}

/** おむつのカウンタで押した記録を取り消せる時間(ms)。押し間違いに気づくのはすぐなので短くてよい。 */
const DIAPER_UNDO_MS = 8000;

const getLogIcon = (type: LogType) => {
  switch (type) {
    case 'milk':
      return <Coffee size={16} className="text-amber-600" />;
    case 'diaper':
      return <Droplet size={16} className="text-blue-500" />;
    case 'pumping':
      return <Milk size={16} className="text-rose-500" />;
    case 'temperature':
      return <Thermometer size={16} className="text-orange-600" />;
    default:
      return <FileText size={16} className="text-gray-500" />;
  }
};

const getLogColor = (type: LogType) => {
  switch (type) {
    case 'milk':
      return 'bg-amber-100';
    case 'diaper':
      return 'bg-blue-100';
    case 'pumping':
      return 'bg-rose-100';
    case 'temperature':
      return 'bg-orange-100';
    default:
      return 'bg-gray-100';
  }
};

export default function LogTab({
  logs,
  logDate,
  today,
  onChangeLogDate,
  birthDate,
  growthData,
  isLoadingLogs,
  isLoadingGrowth,
  memberLabel,
  nextBreastSide,
  pumpedBatches,
  onSaveMilkLog,
  onSaveDiaperLog,
  onSavePumpingLog,
  onSaveTemperatureLog,
  recentTemperatureLogs,
  babyName,
  onDeleteLog,
  onAddGrowthRecord,
  onUpdateGrowthRecord,
  onDeleteGrowthRecord,
}: LogTabProps) {
  const [logView, setLogView] = useState<'timeline' | 'growth'>('timeline');
  // 記録の入力画面。log が null なら新規追加、入っていればその記録の編集。
  const [logModal, setLogModal] = useState<{ type: LogType; log: CareLog | null } | null>(null);
  const [growthModal, setGrowthModal] = useState<{ mode: 'add' | 'edit'; record: GrowthRecord | null } | null>(null);
  // おむつのカウンタで直前に記録したもの。少しの間だけ「取り消す」を出すために持つ。
  const [undoableDiaperLog, setUndoableDiaperLog] = useState<DiaperLog | null>(null);
  // カウンタの二度押しで同じおむつが2件入らないよう、保存が終わるまで押せなくする。
  const [isSavingDiaper, setIsSavingDiaper] = useState(false);
  // カウンタから入力画面を開いたときに、押した種類を最初から選んでおく。
  const [diaperModalKind, setDiaperModalKind] = useState<DiaperKind>('pee');
  // グラフの横軸。生後ヶ月が未入力の記録は横軸が空になってしまうため、記録日で代替する。
  const growthChartData = useMemo(
    () =>
      growthData.map((record) => ({
        ...record,
        axisLabel:
          record.month !== null ? `${record.month}ヶ月` : record.recordedDate.slice(5).replace('-', '/'),
      })),
    [growthData],
  );
  // 母乳の左右別ストップウォッチ。入力画面を閉じても測り続けられるよう、ここで持つ。
  const nursingTimer = useNursingTimer();

  // 日を切り替えた直後は前の日の記録が残っているため、読み込み中は空として扱う
  const visibleLogs = useMemo(() => (isLoadingLogs ? [] : logs), [isLoadingLogs, logs]);
  const summary = useMemo(() => summarizeLogs(visibleLogs), [visibleLogs]);
  const isToday = isSameDay(logDate, today);
  const dateLabel =
    logDate.getFullYear() === today.getFullYear()
      ? formatDateWithWeekday(logDate)
      : `${logDate.getFullYear()}年${formatDateWithWeekday(logDate)}`;

  // 種類ごとの記録ボタンに出すその日の合計。回数を主、量・時間を従にして1行に収める。
  const milkSummaryText = [
    `${summary.milk.count}回`,
    ...(summary.milk.ml > 0 ? [`${summary.milk.ml}ml`] : []),
    ...(summary.milk.breastMinutes > 0 ? [`${summary.milk.breastMinutes}分`] : []),
  ].join('・');
  const diaperSummaryText =
    summary.diaper.poopCount > 0
      ? `${summary.diaper.count}回・うんち${summary.diaper.poopCount}`
      : `${summary.diaper.count}回`;
  const pumpingSummaryText =
    summary.pumping.ml > 0
      ? `${summary.pumping.count}回・${summary.pumping.ml}ml`
      : `${summary.pumping.count}回`;
  // 平熱。その子自身の記録の平均なので、表示中の日ではなく直近の記録から出す。
  const temperatureBaseline = useMemo(
    () => getTemperatureBaseline(recentTemperatureLogs),
    [recentTemperatureLogs],
  );
  // 体温は最新の値を主、回数と最高体温を従にする。
  // その日にまだ測っていなければ、空けておかずに平熱を出す（測ったときの比べる相手になる）。
  const latestTemperature = getLatestTemperature(visibleLogs);
  const temperatureSummaryText = latestTemperature
    ? [
        formatCelsius(latestTemperature.celsius),
        `${summary.temperature.count}回`,
        // 熱が下がったあとでも、その日いちばん高かったところが分かるようにする。
        ...(summary.temperature.maxCelsius !== null &&
        summary.temperature.maxCelsius > latestTemperature.celsius
          ? [`最高 ${formatCelsius(summary.temperature.maxCelsius)}`]
          : []),
      ].join('・')
    : temperatureBaseline
      ? `平熱 ${formatCelsius(temperatureBaseline.celsius)}`
      : 'この日はまだ';
  // 搾乳ストックの残り。まだ飲ませていないパックの数と合計。
  const stockBatches = pumpedBatches.filter((batch) => batch.usedBy === null);
  const stockMl = sumBatchesMl(stockBatches);

  const closeLogModal = () => setLogModal(null);

  // 「取り消す」は押し間違いのためのものなので、少し経ったら自分で消える。
  useEffect(() => {
    if (!undoableDiaperLog) return;
    const timer = setTimeout(() => setUndoableDiaperLog(null), DIAPER_UNDO_MS);
    return () => clearTimeout(timer);
  }, [undoableDiaperLog]);

  /**
   * おむつのカウンタ。押したその場で、いまの時刻で1件記録する
   * （docs/what-to-record.md §7-1。時刻の8割は手で丸めていたので、自動でよい）。
   *
   * 表示中の日が今日でなければ「いま」では記録できないので、
   * 押した種類を選んだ状態で入力画面を開き、時刻はそちらで入れてもらう。
   */
  const handleDiaperCount = async (kind: DiaperKind) => {
    if (!isToday) {
      setDiaperModalKind(kind);
      setLogModal({ type: 'diaper', log: null });
      return;
    }
    if (isSavingDiaper) return;
    setIsSavingDiaper(true);
    try {
      const saved = await onSaveDiaperLog({ kind, time: new Date(), note: '' }, null);
      // 保存できたときだけ「取り消す」を出す（失敗したときは呼び出し側が知らせる）。
      if (saved) setUndoableDiaperLog(saved);
    } finally {
      setIsSavingDiaper(false);
    }
  };

  const handleUndoDiaper = () => {
    if (!undoableDiaperLog) return;
    onDeleteLog(undoableDiaperLog.id);
    setUndoableDiaperLog(null);
  };

  const handleDelete = (log: CareLog) => {
    onDeleteLog(log.id);
    closeLogModal();
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <SegmentedTabs
        ariaLabel="育児記録の表示"
        value={logView}
        onChange={setLogView}
        className="mb-3 shrink-0"
        options={[
          { id: 'timeline', label: 'タイムライン', icon: <List size={15} /> },
          { id: 'growth', label: '成長曲線', icon: <TrendingUp size={15} /> },
        ]}
      />

      {logView === 'timeline' ? (
        <div className="flex-1 min-h-0 flex flex-col gap-4 lg:grid lg:grid-cols-[20rem_1fr] lg:gap-6">
          <div className="shrink-0 space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {/* 日付の送り: 1日区切りで過去の記録を遡る。タブを開いた時点では常に今日なので、
                「今日」の表示は今日以外を見ているときに戻るボタンとしてだけ出す。 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1 flex items-center justify-between gap-1">
              <button
                onClick={() => onChangeLogDate(addDays(logDate, -1))}
                aria-label="前の日"
                className="flex-none w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition active:scale-95"
              >
                <ChevronLeft size={20} />
              </button>

              <div className="flex items-center gap-1 min-w-0">
                <span className="font-bold text-gray-800 text-[15px] truncate">{dateLabel}</span>
                {/* ネイティブの日付ピッカーで任意の日へジャンプできるようにする */}
                <span className="relative flex-none w-8 h-8 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-blue-500 hover:bg-gray-100 transition">
                  <CalendarDays size={16} />
                  <input
                    type="date"
                    aria-label="日付を選ぶ"
                    value={toDateString(logDate)}
                    max={toDateString(today)}
                    onChange={(e) => {
                      const picked = parseDateString(e.target.value);
                      if (picked) onChangeLogDate(picked);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </span>
                {!isToday && (
                  <button
                    onClick={() => onChangeLogDate(today)}
                    className="flex-none text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md hover:bg-blue-100 transition"
                  >
                    今日
                  </button>
                )}
              </div>

              <button
                onClick={() => onChangeLogDate(addDays(logDate, 1))}
                disabled={isToday}
                aria-label="次の日"
                className="flex-none w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* 計測中の授乳。アプリを開いた人が最初に気づけるよう一番上に出す */}
            {nursingTimer.hasSession && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-amber-700 flex items-center">
                    <Coffee size={12} className="mr-1" />
                    {nursingTimer.runningSide
                      ? `授乳中（${getSideLabel(nursingTimer.runningSide)}）`
                      : '授乳の計測中'}
                  </p>
                  <p className="text-[11px] text-amber-600 tabular-nums">
                    左 {formatStopwatch(nursingTimer.leftMs)} / 右 {formatStopwatch(nursingTimer.rightMs)}
                  </p>
                </div>
                <button
                  onClick={() => setLogModal({ type: 'milk', log: null })}
                  className="bg-amber-600 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-amber-700 transition active:scale-95"
                >
                  開く
                </button>
              </div>
            )}

            {/* 記録ボタン。その日の合計を同じボタンに載せ、「見る」と「記録する」を1つにまとめている。
                おむつはカウンタに分けたので、入力画面を開くのはこの2つだけ。 */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setLogModal({ type: 'milk', log: null })}
                className="relative bg-white px-1.5 py-2.5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-amber-50 transition active:scale-95"
              >
                <Plus size={12} className="absolute top-1.5 right-1.5 text-gray-300" />
                <span className="flex items-center gap-1.5">
                  <Coffee size={17} className="text-amber-600" />
                  <span className="text-sm font-bold text-gray-800">ミルク</span>
                </span>
                <span className="mt-0.5 text-[11px] font-medium text-gray-500 tabular-nums leading-tight text-center">
                  {nursingTimer.hasSession ? '計測中' : milkSummaryText}
                </span>
                {nextBreastSide && !nursingTimer.hasSession && (
                  <span className="text-[10px] font-bold text-amber-600 leading-tight">
                    次は{getSideLabel(nextBreastSide)}から
                  </span>
                )}
              </button>
              <button
                onClick={() => setLogModal({ type: 'pumping', log: null })}
                className="relative bg-white px-1.5 py-2.5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-rose-50 transition active:scale-95"
              >
                <Plus size={12} className="absolute top-1.5 right-1.5 text-gray-300" />
                <span className="flex items-center gap-1.5">
                  <Milk size={17} className="text-rose-500" />
                  <span className="text-sm font-bold text-gray-800">搾乳</span>
                </span>
                <span className="mt-0.5 text-[11px] font-medium text-gray-500 tabular-nums leading-tight text-center">
                  {pumpingSummaryText}
                </span>
              </button>
            </div>

            {/* おむつは1タップのカウンタ。押したその場で、いまの時刻で1件入る。
                色・かたさ・時刻は入れない（docs/what-to-record.md §7-1・§11-1・§11-2・§11-5）。
                気になることがあれば、下のタイムラインからその記録を開いて足せる。 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2.5">
              <div className="flex items-center justify-between mb-2 px-0.5">
                <span className="text-sm font-bold text-gray-800 flex items-center">
                  <Droplet size={16} className="text-blue-500 mr-1.5" />
                  おむつ
                </span>
                <span className="text-[11px] font-medium text-gray-500 tabular-nums">
                  {diaperSummaryText}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {DIAPER_KIND_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleDiaperCount(option.value)}
                    disabled={isSavingDiaper}
                    className="h-14 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm font-bold hover:bg-blue-100 transition active:scale-95 disabled:opacity-50"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {isToday ? (
                undoableDiaperLog && (
                  <div className="mt-2 flex items-center justify-between gap-2 bg-blue-50 rounded-lg px-2.5 py-1.5">
                    <span className="text-[11px] font-bold text-blue-700 tabular-nums truncate">
                      {getLogTimeText(undoableDiaperLog)} {getLogTitle(undoableDiaperLog)} を記録
                    </span>
                    <button
                      onClick={handleUndoDiaper}
                      className="shrink-0 flex items-center text-[11px] font-bold text-blue-700 bg-white border border-blue-200 rounded-md px-2 py-1 hover:bg-blue-100 transition active:scale-95"
                    >
                      <Undo2 size={11} className="mr-1" />
                      取り消す
                    </button>
                  </div>
                )
              ) : (
                <p className="mt-2 text-[11px] text-gray-500 px-0.5">
                  過去の日は「いま」で記録できないため、押すと時刻を選ぶ画面が開きます。
                </p>
              )}
            </div>

            {/* 体温は1日に何度も付くとは限らないので、上の記録ボタンと同じ大きさは要らない。
                右側にその日のようすを出して、「見る」と「記録する」を1行にまとめている。 */}
            <button
              onClick={() => setLogModal({ type: 'temperature', log: null })}
              className="w-full bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2 hover:bg-orange-100 transition active:scale-[0.99]"
            >
              <span className="text-xs font-bold text-orange-700 flex items-center">
                <Thermometer size={13} className="mr-1" /> 体温を記録
              </span>
              <span
                className={`text-sm font-bold tabular-nums ${
                  latestTemperature && isFever(latestTemperature.celsius)
                    ? 'text-red-600'
                    : 'text-orange-700'
                }`}
              >
                {temperatureSummaryText}
              </span>
            </button>

            {/* 搾乳ストック。ためた分と、授乳で「搾乳」を選んで飲ませた分の差し引き。
                表示中の日だけでは求まらないため、日付の送りとは関わらず常に今の残りを出す。 */}
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-bold text-rose-700 flex items-center">
                <Milk size={13} className="mr-1" /> 搾乳ストック
              </span>
              <span className="text-sm font-bold text-rose-700 tabular-nums">
                {stockBatches.length}パック・{stockMl}ml
              </span>
            </div>
            {!isToday && (
              <p className="text-[11px] text-gray-500 leading-relaxed">
                過去の日を表示中です。記録を追加すると{dateLabel}に登録されます。
              </p>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto lg:max-w-3xl">
            <h3 className="text-sm font-bold text-gray-600 mb-2 px-1">{dateLabel}の記録 {visibleLogs.length}件</h3>
            {isLoadingLogs && <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>}
            {!isLoadingLogs && visibleLogs.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">この日の記録はありません</p>
            )}
            <div className={`relative border-l-2 border-gray-200 ml-4 space-y-6 pb-6 ${visibleLogs.length === 0 ? 'hidden' : ''}`}>
              {visibleLogs.map((log) => {
                const badges = getLogBadges(log);
                return (
                  <div key={log.id} className="relative pl-6">
                    <div className={`absolute -left-[17px] top-0 w-8 h-8 rounded-full border-4 border-gray-50 flex items-center justify-center ${getLogColor(log.type)}`}>
                      {getLogIcon(log.type)}
                    </div>
                    <button
                      onClick={() => setLogModal({ type: log.type, log })}
                      className={`w-full text-left bg-white p-3 rounded-xl shadow-sm border hover:bg-gray-50 transition ${
                        isAlertLog(log) ? 'border-red-300 border-l-4 border-l-red-500' : 'border-gray-100'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1 gap-2">
                        <span className="font-bold text-gray-800 text-[15px]">{getLogTitle(log)}</span>
                        <span className="text-xs text-gray-500 font-medium tabular-nums shrink-0">
                          {getLogTimeText(log)}
                        </span>
                      </div>
                      {badges.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {badges.map((badge) => (
                            <span
                              key={badge.text}
                              className={`text-[11px] px-2 py-0.5 rounded flex items-center tabular-nums ${BADGE_TONE_CLASS[badge.tone]}`}
                            >
                              {badge.swatch && (
                                <span
                                  className="w-2.5 h-2.5 rounded-full border border-black/10 mr-1"
                                  style={{ backgroundColor: badge.swatch }}
                                />
                              )}
                              {badge.text}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between items-end mt-2 gap-2">
                        <p className="text-xs text-gray-600">{log.note || 'メモなし'}</p>
                        <span className="text-[11px] text-gray-400 flex items-center shrink-0">
                          <User size={11} className="mr-1" />
                          {memberLabel(log.createdBy)}が記録
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-6 pb-6">
          <button
            onClick={() => setGrowthModal({ mode: 'add', record: null })}
            className="w-full bg-blue-50 text-blue-600 font-medium py-3 rounded-xl shadow-sm border border-blue-200 transition flex items-center justify-center hover:bg-blue-100"
          >
            <Plus size={18} className="mr-1" /> 身長・体重を記録する
          </button>

          {isLoadingGrowth && <p className="text-sm text-gray-400 text-center py-4">読み込み中...</p>}

          {!isLoadingGrowth && growthData.length > 0 && (
            <div className="space-y-6 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-800 text-sm mb-4">身長の推移 (cm)</h3>
                <div className="h-48 w-full -ml-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={growthChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="axisLabel" style={{ fontSize: '10px' }} />
                      <YAxis style={{ fontSize: '10px' }} domain={['dataMin - 2', 'dataMax + 2']} />
                      <Tooltip />
                      <Line type="monotone" dataKey="height" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="身長(cm)" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-800 text-sm mb-4">体重の推移 (kg)</h3>
                <div className="h-48 w-full -ml-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={growthChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="axisLabel" style={{ fontSize: '10px' }} />
                      <YAxis style={{ fontSize: '10px' }} domain={['dataMin - 1', 'dataMax + 1']} />
                      <Tooltip />
                      <Line type="monotone" dataKey="weight" stroke="#f43f5e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="体重(kg)" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50 lg:col-span-2">
                {growthData.map((record) => (
                  <button
                    key={record.id}
                    onClick={() => setGrowthModal({ mode: 'edit', record })}
                    className="w-full text-left p-3 flex items-center justify-between hover:bg-gray-50 transition"
                  >
                    <span className="text-xs text-gray-500">{record.recordedDate}{record.month !== null ? ` (生後${record.month}ヶ月)` : ''}</span>
                    <span className="text-sm text-gray-700 font-medium">
                      {record.height !== null ? `${record.height}cm` : '-'} / {record.weight !== null ? `${record.weight}kg` : '-'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isLoadingGrowth && growthData.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">記録はまだありません</p>
          )}
        </div>
      )}

      <MilkLogModal
        show={logModal?.type === 'milk'}
        log={logModal?.log?.type === 'milk' ? logModal.log : null}
        baseDate={logDate}
        nextSide={nextBreastSide}
        timer={nursingTimer}
        pumpedBatches={pumpedBatches}
        onClose={closeLogModal}
        onSubmit={(input) => {
          const existing = logModal?.log?.type === 'milk' ? logModal.log : null;
          onSaveMilkLog(input, existing);
          // 記録できた分の計測はもう不要なので片付ける。
          if (!existing) nursingTimer.reset();
          closeLogModal();
        }}
        onDelete={() => logModal?.log && handleDelete(logModal.log)}
      />
      <DiaperLogModal
        show={logModal?.type === 'diaper'}
        log={logModal?.log?.type === 'diaper' ? logModal.log : null}
        baseDate={logDate}
        initialKind={diaperModalKind}
        onClose={closeLogModal}
        onSubmit={(input) => {
          onSaveDiaperLog(input, logModal?.log?.type === 'diaper' ? logModal.log : null);
          closeLogModal();
        }}
        onDelete={() => logModal?.log && handleDelete(logModal.log)}
      />
      <PumpingLogModal
        show={logModal?.type === 'pumping'}
        log={logModal?.log?.type === 'pumping' ? logModal.log : null}
        baseDate={logDate}
        pumpedBatches={pumpedBatches}
        onClose={closeLogModal}
        onSubmit={(input) => {
          onSavePumpingLog(input, logModal?.log?.type === 'pumping' ? logModal.log : null);
          closeLogModal();
        }}
        onDelete={() => logModal?.log && handleDelete(logModal.log)}
      />
      <TemperatureLogModal
        show={logModal?.type === 'temperature'}
        log={logModal?.log?.type === 'temperature' ? logModal.log : null}
        baseDate={logDate}
        previous={latestTemperature}
        baseline={temperatureBaseline}
        babyName={babyName}
        onClose={closeLogModal}
        onSubmit={(input) => {
          onSaveTemperatureLog(input, logModal?.log?.type === 'temperature' ? logModal.log : null);
          closeLogModal();
        }}
        onDelete={() => logModal?.log && handleDelete(logModal.log)}
      />
      <GrowthRecordFormModal
        key={growthModal ? `${growthModal.mode}-${growthModal.record?.id ?? 'new'}` : 'none'}
        mode={growthModal?.mode ?? null}
        record={growthModal?.record ?? null}
        birthDate={birthDate}
        onClose={() => setGrowthModal(null)}
        onSubmit={(draft) => {
          if (growthModal?.mode === 'edit' && growthModal.record) {
            onUpdateGrowthRecord(growthModal.record, draft);
          } else {
            onAddGrowthRecord(draft);
          }
          setGrowthModal(null);
        }}
        onDelete={(id) => {
          onDeleteGrowthRecord(id);
          setGrowthModal(null);
        }}
      />
    </div>
  );
}
