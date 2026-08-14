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
  Moon,
  Plus,
  Sun,
  TrendingUp,
  User,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  BreastSide,
  CareLog,
  DiaperLog,
  GrowthRecord,
  LogType,
  MilkLog,
  SleepLog,
} from '@/types/app';
import {
  formatDuration,
  formatStopwatch,
  getLogBadges,
  getLogTimeText,
  getLogTitle,
  getSideLabel,
  isAlertLog,
  summarizeLogs,
  type BadgeTone,
} from '@/lib/careLogUtils';
import {
  addDays,
  formatDateWithWeekday,
  formatTimeString,
  isSameDay,
  parseDateString,
  toDateString,
} from '@/lib/dateUtils';
import MilkLogModal, { type MilkLogInput } from '../modals/MilkLogModal';
import DiaperLogModal, { type DiaperLogInput } from '../modals/DiaperLogModal';
import SleepLogModal, { type ManualSleepInput } from '../modals/SleepLogModal';
import GrowthRecordFormModal, { type GrowthRecordDraft } from '../modals/GrowthRecordFormModal';

interface LogTabProps {
  logs: CareLog[];
  logDate: Date;
  today: Date;
  onChangeLogDate: (date: Date) => void;
  growthData: GrowthRecord[];
  isLoadingLogs?: boolean;
  isLoadingGrowth?: boolean;
  memberLabel: (id: string | null) => string;
  /** 計測中の睡眠。なければ null。 */
  activeSleep: SleepLog | null;
  /** 次に飲ませる乳首。判断材料がなければ null。 */
  nextBreastSide: BreastSide | null;
  onSaveMilkLog: (input: MilkLogInput, existing: MilkLog | null) => void;
  onSaveDiaperLog: (input: DiaperLogInput, existing: DiaperLog | null) => void;
  onSaveSleepLog: (input: ManualSleepInput, existing: SleepLog | null) => void;
  onDeleteLog: (id: string) => void;
  onStartSleep: () => void;
  onEndSleep: () => void;
  onAddGrowthRecord: (draft: GrowthRecordDraft) => void;
  onUpdateGrowthRecord: (record: GrowthRecord, draft: GrowthRecordDraft) => void;
  onDeleteGrowthRecord: (id: string) => void;
}

const getLogIcon = (type: LogType) => {
  switch (type) {
    case 'milk':
      return <Coffee size={16} className="text-amber-600" />;
    case 'diaper':
      return <Droplet size={16} className="text-blue-500" />;
    case 'sleep':
      return <Moon size={16} className="text-indigo-500" />;
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
    case 'sleep':
      return 'bg-indigo-100';
    default:
      return 'bg-gray-100';
  }
};

const BADGE_CLASS: Record<BadgeTone, string> = {
  milk: 'bg-amber-100 text-amber-800 font-bold',
  diaper: 'bg-blue-100 text-blue-700',
  sleep: 'bg-indigo-100 text-indigo-700 font-bold',
  alert: 'bg-red-100 text-red-700 font-bold',
  neutral: 'bg-gray-100 text-gray-600',
};

export default function LogTab({
  logs,
  logDate,
  today,
  onChangeLogDate,
  growthData,
  isLoadingLogs,
  isLoadingGrowth,
  memberLabel,
  activeSleep,
  nextBreastSide,
  onSaveMilkLog,
  onSaveDiaperLog,
  onSaveSleepLog,
  onDeleteLog,
  onStartSleep,
  onEndSleep,
  onAddGrowthRecord,
  onUpdateGrowthRecord,
  onDeleteGrowthRecord,
}: LogTabProps) {
  const [logView, setLogView] = useState<'timeline' | 'growth'>('timeline');
  // 記録の入力画面。log が null なら新規追加、入っていればその記録の編集。
  const [logModal, setLogModal] = useState<{ type: LogType; log: CareLog | null } | null>(null);
  const [growthModal, setGrowthModal] = useState<{ mode: 'add' | 'edit'; record: GrowthRecord | null } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // 日を切り替えた直後は前の日の記録が残っているため、読み込み中は空として扱う
  const visibleLogs = useMemo(() => (isLoadingLogs ? [] : logs), [isLoadingLogs, logs]);
  const summary = useMemo(() => summarizeLogs(visibleLogs), [visibleLogs]);
  const isToday = isSameDay(logDate, today);
  const dateLabel =
    logDate.getFullYear() === today.getFullYear()
      ? formatDateWithWeekday(logDate)
      : `${logDate.getFullYear()}年${formatDateWithWeekday(logDate)}`;

  // 計測中は上部のバーの経過時間を毎秒更新する。
  useEffect(() => {
    if (!activeSleep) return;
    const update = () => setElapsed(Date.now() - activeSleep.startedAt.getTime());
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeSleep]);

  const closeLogModal = () => setLogModal(null);

  const handleDelete = (log: CareLog) => {
    onDeleteLog(log.id);
    closeLogModal();
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">育児記録</h2>
      </div>

      <div className="flex bg-gray-200 p-1 rounded-lg mb-4 shrink-0">
        <button
          onClick={() => setLogView('timeline')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md flex justify-center items-center transition ${logView === 'timeline' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
        >
          <List size={14} className="mr-1" /> タイムライン
        </button>
        <button
          onClick={() => setLogView('growth')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md flex justify-center items-center transition ${logView === 'growth' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
        >
          <TrendingUp size={14} className="mr-1" /> 成長曲線
        </button>
      </div>

      {logView === 'timeline' ? (
        <div className="flex-1 min-h-0 flex flex-col gap-4 lg:grid lg:grid-cols-[20rem_1fr] lg:gap-6">
          <div className="shrink-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {/* 日付ナビゲーション: 1日区切りで過去の記録を遡る */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2 flex items-center justify-between">
              <button
                onClick={() => onChangeLogDate(addDays(logDate, -1))}
                aria-label="前の日"
                className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition active:scale-95"
              >
                <ChevronLeft size={20} />
              </button>

              <div className="flex flex-col items-center">
                <div className="flex items-center">
                  <span className="font-bold text-gray-800 text-sm">{dateLabel}</span>
                  {/* ネイティブの日付ピッカーで任意の日へジャンプできるようにする */}
                  <span className="relative ml-1 w-7 h-7 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-blue-500 hover:bg-gray-100 transition">
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
                </div>
                {isToday ? (
                  <span className="text-[10px] text-blue-500 font-medium">今日</span>
                ) : (
                  <button onClick={() => onChangeLogDate(today)} className="text-[10px] text-blue-500 font-medium hover:underline">
                    今日へ戻る
                  </button>
                )}
              </div>

              <button
                onClick={() => onChangeLogDate(addDays(logDate, 1))}
                disabled={isToday}
                aria-label="次の日"
                className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* 計測中の睡眠。アプリを開いた人が最初に気づけるよう一番上に出す */}
            {activeSleep && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-indigo-700 flex items-center">
                    <Moon size={12} className="mr-1" /> ねんね中
                  </p>
                  <p className="text-[11px] text-indigo-500 tabular-nums">
                    {formatTimeString(activeSleep.startedAt)} から {formatStopwatch(elapsed)}
                  </p>
                </div>
                <button
                  onClick={onEndSleep}
                  className="bg-indigo-600 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-indigo-700 transition active:scale-95 flex items-center"
                >
                  <Sun size={13} className="mr-1" /> 起きた
                </button>
              </div>
            )}

            {/* この日の合計 */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2 text-center">
                <Coffee size={14} className="text-amber-600 mx-auto mb-1" />
                <p className="text-sm font-bold text-gray-800 leading-tight">
                  {summary.milk.ml > 0 ? `${summary.milk.ml}ml` : `${summary.milk.count}回`}
                </p>
                <p className="text-[10px] text-gray-400">
                  ミルク {summary.milk.count}回
                  {summary.milk.breastMinutes > 0 && ` / 母乳${summary.milk.breastMinutes}分`}
                </p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2 text-center">
                <Droplet size={14} className="text-blue-500 mx-auto mb-1" />
                <p className="text-sm font-bold text-gray-800 leading-tight">{summary.diaper.count}回</p>
                <p className="text-[10px] text-gray-400">
                  おむつ{summary.diaper.poopCount > 0 && ` / うんち${summary.diaper.poopCount}回`}
                </p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2 text-center">
                <Moon size={14} className="text-indigo-500 mx-auto mb-1" />
                <p className="text-sm font-bold text-gray-800 leading-tight">
                  {summary.sleep.minutes > 0 ? formatDuration(summary.sleep.minutes * 60000) : `${summary.sleep.count}回`}
                </p>
                <p className="text-[10px] text-gray-400">睡眠 {summary.sleep.count}回</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setLogModal({ type: 'milk', log: null })}
                className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-amber-50 transition active:scale-95"
              >
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center mb-2">
                  <Coffee size={20} className="text-amber-600" />
                </div>
                <span className="text-xs font-bold text-gray-700">ミルク</span>
                {nextBreastSide && (
                  <span className="text-[9px] font-bold text-amber-600 mt-0.5">
                    次は{getSideLabel(nextBreastSide)}から
                  </span>
                )}
              </button>
              <button
                onClick={() => setLogModal({ type: 'diaper', log: null })}
                className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-blue-50 transition active:scale-95"
              >
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                  <Droplet size={20} className="text-blue-500" />
                </div>
                <span className="text-xs font-bold text-gray-700">おむつ</span>
              </button>
              <button
                onClick={() => setLogModal({ type: 'sleep', log: null })}
                className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-indigo-50 transition active:scale-95"
              >
                <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center mb-2">
                  <Moon size={20} className="text-indigo-500" />
                </div>
                <span className="text-xs font-bold text-gray-700">睡眠</span>
                {activeSleep && <span className="text-[9px] font-bold text-indigo-600 mt-0.5">計測中</span>}
              </button>
            </div>
            {!isToday && (
              <p className="text-[10px] text-gray-400 leading-relaxed">
                過去の日を表示中です。記録を追加すると{dateLabel}に登録されます。
              </p>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto lg:max-w-3xl">
            <h3 className="text-sm font-bold text-gray-500 mb-3 px-1">
              {isToday ? '今日' : dateLabel}の記録 ({visibleLogs.length}件)
            </h3>
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
                        <span className="font-bold text-gray-800 text-sm">{getLogTitle(log)}</span>
                        <span className="text-xs text-gray-400 font-medium tabular-nums shrink-0">
                          {getLogTimeText(log)}
                        </span>
                      </div>
                      {badges.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {badges.map((badge) => (
                            <span
                              key={badge.text}
                              className={`text-[11px] px-2 py-0.5 rounded flex items-center tabular-nums ${BADGE_CLASS[badge.tone]}`}
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
                        <p className="text-xs text-gray-500">{log.note || 'メモなし'}</p>
                        <span className="text-[10px] text-gray-400 flex items-center shrink-0">
                          <User size={10} className="mr-1" />
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
                    <LineChart data={growthData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tickFormatter={(v) => `${v}ヶ月`} style={{ fontSize: '10px' }} />
                      <YAxis style={{ fontSize: '10px' }} domain={['dataMin - 2', 'dataMax + 2']} />
                      <Tooltip />
                      <Line type="monotone" dataKey="height" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="身長(cm)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-800 text-sm mb-4">体重の推移 (kg)</h3>
                <div className="h-48 w-full -ml-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={growthData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tickFormatter={(v) => `${v}ヶ月`} style={{ fontSize: '10px' }} />
                      <YAxis style={{ fontSize: '10px' }} domain={['dataMin - 1', 'dataMax + 1']} />
                      <Tooltip />
                      <Line type="monotone" dataKey="weight" stroke="#f43f5e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} name="体重(kg)" />
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
        onClose={closeLogModal}
        onSubmit={(input) => {
          onSaveMilkLog(input, logModal?.log?.type === 'milk' ? logModal.log : null);
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
      <SleepLogModal
        show={logModal?.type === 'sleep'}
        log={logModal?.log?.type === 'sleep' ? logModal.log : null}
        activeSleep={activeSleep}
        baseDate={logDate}
        onClose={closeLogModal}
        onStart={onStartSleep}
        onEnd={() => {
          onEndSleep();
          closeLogModal();
        }}
        onSubmitManual={(input) => {
          onSaveSleepLog(input, logModal?.log?.type === 'sleep' ? logModal.log : null);
          closeLogModal();
        }}
        onDelete={() => logModal?.log && handleDelete(logModal.log)}
      />
      <GrowthRecordFormModal
        key={growthModal ? `${growthModal.mode}-${growthModal.record?.id ?? 'new'}` : 'none'}
        mode={growthModal?.mode ?? null}
        record={growthModal?.record ?? null}
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
