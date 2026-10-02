'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Droplet,
  FileText,
  Milk,
  Plus,
  Thermometer,
  Undo2,
  User,
} from 'lucide-react';
import type {
  BreastSide,
  CareLog,
  DiaperLog,
  FeedingMethod,
  GrowthRecord,
  LogType,
  MilkLog,
  PumpedBatch,
  PumpingLog,
  TemperatureLog,
} from '@/types/app';
import {
  BADGE_TONE_CLASS,
  formatCelsius,
  formatStopwatch,
  getLatestTemperature,
  getTemperatureBaseline,
  getLogBadges,
  getLogTimeText,
  getLogTitle,
  getSideLabel,
  isAlertLog,
  pumpedStockMl,
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
import BabyBottleIcon from '../ui/BabyBottleIcon';
import BodyPanel from './BodyPanel';
import NextFeedingCard from '../NextFeedingCard';
import type { NextFeedingInfo } from '@/lib/feedingSchedule';
import MilkLogModal, { type MilkLogInput } from '../modals/MilkLogModal';
import DiaperLogModal, { type DiaperLogInput } from '../modals/DiaperLogModal';
import PumpingLogModal, { type PumpingLogInput } from '../modals/PumpingLogModal';
import TemperatureLogModal, { type TemperatureLogInput } from '../modals/TemperatureLogModal';
import GrowthRecordFormModal from '../modals/GrowthRecordFormModal';
import type { GrowthRecordDraft } from '@/lib/growthRecordInput';

// 育児タブ（docs/family-app.md §4.2）。もとの記録タブに、ホームの「生後日数」「次の授乳」を
// まとめたもの。上に子の月齢と次の授乳を固定し、その下にその日の記録を出す。
// 体温と身長・体重は「からだ」のボタンから開く画面（BodyPanel）で記録して振り返る
// （以前の「成長」の切り替えをここへ寄せた）。保活は設定タブへ移した。
// mobile版は `mobile/app/(tabs)/care.tsx`。
interface CareTabProps {
  /** 見出しに出す子の月齢（「生後123日目（4ヶ月2日）」）。誕生日が未設定なら空文字。 */
  babyAge: string;
  /** 見出しの「次の授乳」。 */
  nextFeeding: NextFeedingInfo;
  logs: CareLog[];
  logDate: Date;
  today: Date;
  onChangeLogDate: (date: Date) => void;
  /**
   * 開いた直後に出す入力画面の種類。通知（検温のお知らせ・授乳のお知らせ）から
   * 開いたときに、その用件の入力画面へそのまま入れるようにするためのもの。
   */
  initialLogType?: LogType | null;
  /** 上の入力画面を開いたことを親へ返す。開き直しを防ぐため、親側で指定を空にする。 */
  onOpenInitialLogType?: () => void;
  /** プロフィールに登録された子の誕生日（'YYYY-MM-DD'）。成長記録の生後ヶ月の自動計算に使う。 */
  birthDate?: string;
  growthData: GrowthRecord[];
  isLoadingLogs?: boolean;
  isLoadingGrowth?: boolean;
  memberLabel: (id: string | null) => string;
  /** 次に飲ませる乳首。判断材料がなければ null。 */
  nextBreastSide: BreastSide | null;
  /** いま授乳中の家族（自分の端末で測っている分は含まない）。いなければ null。 */
  nursingBy: string | null;
  /** 搾乳ストックの全量（使用済みも含む）。残りの表示と、飲ませる搾乳の選択に使う。 */
  pumpedBatches: PumpedBatch[];
  /** 搾乳ストックの1パックを丸ごと捨てる / 捨てたのを取り消す。 */
  onDiscardPumpedBatch: (id: string, discarded: boolean) => void;
  onSaveMilkLog: (input: MilkLogInput, existing: MilkLog | null) => void;
  onSaveDiaperLog: (input: DiaperLogInput, existing: DiaperLog | null) => void;
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

const getLogIcon = (type: LogType) => {
  switch (type) {
    case 'milk':
      return <BabyBottleIcon size={16} className="text-amber-600" />;
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

export default function CareTab({
  babyAge,
  nextFeeding,
  logs,
  logDate,
  today,
  onChangeLogDate,
  initialLogType,
  onOpenInitialLogType,
  birthDate,
  growthData,
  isLoadingLogs,
  isLoadingGrowth,
  memberLabel,
  nextBreastSide,
  nursingBy,
  pumpedBatches,
  onDiscardPumpedBatch,
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
}: CareTabProps) {
  // 「からだ」（体温・身長・体重の記録と履歴）を開いているか。開いたときは閉じている。
  const [bodyOpen, setBodyOpen] = useState(false);
  // 記録の入力画面。log が null なら新規追加、入っていればその記録の編集。
  // 通知から開いたときは、その用件の入力画面を出した状態で始める。
  const [logModal, setLogModal] = useState<{ type: LogType; log: CareLog | null } | null>(
    initialLogType ? { type: initialLogType, log: null } : null,
  );
  // 開いたことを親へ返して指定を空にしてもらう（タブを行き来しても開き直さないため）。
  useEffect(() => {
    if (initialLogType) onOpenInitialLogType?.();
  }, [initialLogType, onOpenInitialLogType]);
  const [growthModal, setGrowthModal] = useState<{ mode: 'add' | 'edit'; record: GrowthRecord | null } | null>(null);
  // 搾乳の入力画面から「飲ませた」で戻ったときに、搾乳を選んだ状態で開くための指定。
  const [milkModalMethod, setMilkModalMethod] = useState<FeedingMethod | undefined>(undefined);
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

  // 平熱。その子自身の記録の平均なので、表示中の日ではなく直近の記録から出す。
  const temperatureBaseline = useMemo(
    () => getTemperatureBaseline(recentTemperatureLogs),
    [recentTemperatureLogs],
  );
  // 体温のボタンにはその子の平熱だけを出す。日ごとの平均や最高は出さず、
  // 測ったときに比べる相手になる基準の1つの数に絞る。
  const temperatureSummaryText = temperatureBaseline
    ? `平熱 ${formatCelsius(temperatureBaseline.celsius)}`
    : 'まだ記録なし';
  // 「からだ」のボタンには、体温の平熱と、いちばん新しい体重を並べて出す。
  // 成長記録は日付の古い順に持っているので、後ろから探す。
  const latestWeightKg = useMemo(
    () => [...growthData].reverse().find((record) => record.weight !== null)?.weight ?? null,
    [growthData],
  );
  // 入力画面に出す「前回の体温」。ボタンの平均とは別に、直前の1件が要る。
  // 「からだ」から開いたときは日が決まっていないので、日をまたいだ直近の1件にする。
  const latestTemperature = getLatestTemperature(bodyOpen ? recentTemperatureLogs : visibleLogs);
  // 搾乳ストックの残り。飲ませた分と丸ごと捨てた分を除いたパックの合計。
  // 表示中の日だけでは求まらないため、日付の送りとは関わらず常に今の残りを出す。
  const stockMl = pumpedStockMl(pumpedBatches);

  const closeLogModal = () => setLogModal(null);

  const handleDelete = (log: CareLog) => {
    onDeleteLog(log.id);
    closeLogModal();
  };

  return (
    // PC幅では左の列に 見出し・日付送りと記録ボタン、右の列に中身を置く。
    // スマホ幅では同じ順に縦へ並ぶ。「からだ」を開いている間は、この2列の代わりにそれを出す。
    <div className="p-4 h-full flex flex-col gap-3 lg:grid lg:grid-cols-[20rem_1fr] lg:gap-6">
      {bodyOpen && (
        // 「からだ」は自分の余白を持つので、こちらの余白と重ならないよう打ち消す。
        <div className="flex-1 min-h-0 -m-4 lg:col-span-2 lg:m-0">
          <BodyPanel
            temperatureLogs={recentTemperatureLogs}
            growthData={growthData}
            growthChartData={growthChartData}
            isLoadingGrowth={isLoadingGrowth}
            memberLabel={memberLabel}
            onBack={() => setBodyOpen(false)}
            onAddTemperature={() => setLogModal({ type: 'temperature', log: null })}
            onEditTemperature={(log) => setLogModal({ type: 'temperature', log })}
            onAddGrowth={() => setGrowthModal({ mode: 'add', record: null })}
            onEditGrowth={(record) => setGrowthModal({ mode: 'edit', record })}
          />
        </div>
      )}
      {!bodyOpen && (
      <>
      <div className="shrink-0 space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        {/* 見出し（子の月齢・次の授乳）は固定し、スクロールは中身だけにする。 */}
        <div className="space-y-2">
          {babyAge && (
            <p className="px-1 text-sm font-semibold text-gray-700">{babyAge}</p>
          )}
          <NextFeedingCard
            info={nextFeeding}
            onOpen={() => setLogModal({ type: 'milk', log: null })}
          />
        </div>

        <>
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
                    // 「今日」だけだと、表示中の日付のラベルに見えて紛らわしいので、戻る操作だと分かる文言にする。
                    className="flex-none flex items-center gap-0.5 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md hover:bg-blue-100 transition"
                  >
                    <Undo2 size={12} />
                    今日へ戻る
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
                    <BabyBottleIcon size={12} className="mr-1" />
                    {nursingTimer.runningPhase === 'burp'
                      ? 'ゲップの時間を計測中'
                      : nursingTimer.runningPhase
                        ? `授乳中（${getSideLabel(nursingTimer.runningPhase)}）`
                        : '授乳の計測中'}
                  </p>
                  {/* 出すのは記録に入る合計。何セット目かは、続きから測るときの目印になる。 */}
                  <p className="text-[11px] text-amber-600 tabular-nums">
                    {nursingTimer.setNumber}セット目・左 {formatStopwatch(nursingTimer.total.left)} / 右{' '}
                    {formatStopwatch(nursingTimer.total.right)}
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

            {/* 記録ボタン。その日のようすを同じボタンに載せ、「見る」と「記録する」を1つにまとめている。
                授乳・おむつ・からだの3つ。搾乳は授乳の中（入力画面の「搾った」）へ寄せたので、
                ここには出さず、代わりに授乳のボタンにいまの搾乳ストックを出す。 */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => {
                  setMilkModalMethod(undefined);
                  setLogModal({ type: 'milk', log: null });
                }}
                className="relative bg-white px-1.5 py-2.5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-amber-50 transition active:scale-95"
              >
                <Plus size={12} className="absolute top-1.5 right-1.5 text-gray-300" />
                <span className="flex items-center gap-1.5">
                  <BabyBottleIcon size={17} className="text-amber-600" />
                  <span className="text-sm font-bold text-gray-800">授乳</span>
                </span>
                {/* その日の回数・量・分数は出さない（判断に使うのは体重とおしっこの回数）。
                    代わりに、次の授乳で使える搾乳ストックの残りを出す。表示中の日だけでは
                    求まらないため、日付の送りとは関わらず常に今の残りになる。
                    何パックあるかは飲ませるときに選ぶので、ここは合計だけでよい。 */}
                <span className="mt-0.5 text-[11px] font-bold text-rose-600 tabular-nums leading-tight text-center">
                  ストック・{stockMl}ml
                </span>
                {nursingBy && (
                  <span className="text-[10px] font-bold text-amber-600 leading-tight">
                    {memberLabel(nursingBy)}が授乳中
                  </span>
                )}
                {!nursingBy && nextBreastSide && !nursingTimer.hasSession && (
                  <span className="text-[10px] font-bold text-amber-600 leading-tight">
                    次は{getSideLabel(nextBreastSide)}から
                  </span>
                )}
              </button>
              <button
                onClick={() => setLogModal({ type: 'diaper', log: null })}
                className="relative bg-white px-1.5 py-2.5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-blue-50 transition active:scale-95"
              >
                <Plus size={12} className="absolute top-1.5 right-1.5 text-gray-300" />
                <span className="flex items-center gap-1.5">
                  <Droplet size={17} className="text-blue-500" />
                  <span className="text-sm font-bold text-gray-800">おむつ</span>
                </span>
                {/* おしっことうんちは見たいことが別（水分が足りているか／お通じ）なので、
                    合わせた回数ではなくそれぞれの回数を出す。「両方」の記録は両方に数える。 */}
                <span className="mt-0.5 text-[11px] font-medium text-gray-500 tabular-nums leading-tight text-center">
                  おしっこ {summary.diaper.peeCount}回
                </span>
                <span className="text-[11px] font-medium text-gray-500 tabular-nums leading-tight text-center">
                  うんち {summary.diaper.poopCount}回
                </span>
              </button>
              {/* からだ（体温・身長・体重）。押すと、記録と履歴をまとめた画面を開く。
                  体温はその子の平熱だけ、体重はいちばん新しい値だけを出す。 */}
              <button
                onClick={() => setBodyOpen(true)}
                className="relative bg-white px-1.5 py-2.5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-orange-50 transition active:scale-95"
              >
                <ChevronRight size={12} className="absolute top-1.5 right-1.5 text-gray-300" />
                <span className="flex items-center gap-1.5">
                  <Thermometer size={17} className="text-orange-600" />
                  <span className="text-sm font-bold text-gray-800">からだ</span>
                </span>
                <span className="mt-0.5 text-[11px] font-medium tabular-nums leading-tight text-center text-gray-500">
                  {temperatureSummaryText}
                </span>
                <span className="text-[11px] font-medium tabular-nums leading-tight text-center text-gray-500">
                  {latestWeightKg !== null ? `体重 ${latestWeightKg}kg` : '体重 -'}
                </span>
              </button>
            </div>

            {!isToday && (
              <p className="text-[11px] text-gray-500 leading-relaxed">
                過去の日を表示中です。記録を追加すると{dateLabel}に登録されます。
              </p>
            )}
        </>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {(
          <div className="flex-1 min-h-0 overflow-y-auto lg:max-w-3xl">
              <h3 className="text-sm font-bold text-gray-600 mb-2 px-1">{dateLabel}の記録 {visibleLogs.length}件</h3>
              {isLoadingLogs && <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>}
              {!isLoadingLogs && visibleLogs.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">この日の記録はありません</p>
              )}
              <div className={`relative border-l-2 border-gray-200 ml-4 space-y-3.5 pb-6 ${visibleLogs.length === 0 ? 'hidden' : ''}`}>
                {visibleLogs.map((log) => {
                  const badges = getLogBadges(log);
                  return (
                    <div key={log.id} className="relative pl-6">
                      <div className={`absolute -left-[17px] top-0 w-8 h-8 rounded-full border-4 border-gray-50 flex items-center justify-center ${getLogColor(log.type)}`}>
                        {getLogIcon(log.type)}
                      </div>
                      <button
                        onClick={() => setLogModal({ type: log.type, log })}
                        className={`w-full text-left bg-white px-2.5 py-2 rounded-[10px] shadow-sm border hover:bg-gray-50 transition ${
                          isAlertLog(log) ? 'border-red-300 border-l-4 border-l-red-500' : 'border-gray-100'
                        }`}
                      >
                        {/* 見出し・バッジ・時刻を1段にまとめて、バッジ専用の行を無くす。
                            これでバッジの有無によってカードの高さが変わらなくなる。 */}
                        <div className="flex justify-between items-center gap-2">
                          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="font-bold text-gray-800 text-sm">{getLogTitle(log)}</span>
                            {badges.map((badge) => (
                              <span
                                key={badge.text}
                                className={`text-[10px] px-1.5 py-px rounded flex items-center tabular-nums ${BADGE_TONE_CLASS[badge.tone]}`}
                              >
                                {badge.swatch && (
                                  <span
                                    className="w-2 h-2 rounded-full border border-black/10 mr-0.5"
                                    style={{ backgroundColor: badge.swatch }}
                                  />
                                )}
                                {badge.text}
                              </span>
                            ))}
                          </div>
                          <span className="text-[11px] text-gray-500 font-medium tabular-nums shrink-0">
                            {getLogTimeText(log)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mt-0.5 gap-2">
                          {/* メモは書いたときだけ出す。「メモなし」を並べても読むものが増えるだけなので出さない。
                              他の項目（見出し・時刻・記録者）と書体をそろえると自由記述のメモだけが埋もれるので、
                              ひと回り小さく薄い色にして、メモだと分かるようにする。 */}
                          <p className="flex-1 min-w-0 truncate text-[11px] font-normal text-gray-500">{log.note}</p>
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
        )}
      </div>
      </>
      )}

      <MilkLogModal
        show={logModal?.type === 'milk'}
        log={logModal?.log?.type === 'milk' ? logModal.log : null}
        baseDate={logDate}
        nextSide={nextBreastSide}
        timer={nursingTimer}
        pumpedBatches={pumpedBatches}
        onDiscardBatch={onDiscardPumpedBatch}
        initialMethod={milkModalMethod}
        onSwitchToPumping={() => setLogModal({ type: 'pumping', log: null })}
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
        onSwitchToFeeding={(method) => {
          // 搾乳の入力画面で選び直した種類のまま、授乳の入力画面へ戻す。
          setMilkModalMethod(method);
          setLogModal({ type: 'milk', log: null });
        }}
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
        // 「からだ」から足すときは、いま見ている日ではなく今日に登録する。
        baseDate={bodyOpen ? today : logDate}
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
