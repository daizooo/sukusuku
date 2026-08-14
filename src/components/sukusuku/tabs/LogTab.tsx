'use client';

import { useEffect, useState } from 'react';
import { Coffee, Droplet, FileText, List, Moon, Plus, Sun, TrendingUp, User } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BreastSide, CareLog, GrowthRecord, LogType, SleepLog } from '@/types/app';
import {
  formatStopwatch,
  getLogBadges,
  getLogTimeText,
  getLogTitle,
  getSideLabel,
  isAlertLog,
  type BadgeTone,
} from '@/lib/careLogUtils';
import { formatTimeString } from '@/lib/dateUtils';

interface LogTabProps {
  logs: CareLog[];
  growthData: GrowthRecord[];
  /** 計測中の睡眠。なければ null。 */
  activeSleep: SleepLog | null;
  /** 次に飲ませる乳首。判断材料がなければ null。 */
  nextBreastSide: BreastSide | null;
  onOpenLog: (type: LogType) => void;
  onEndSleep: () => void;
}

const getLogIcon = (log: CareLog) => {
  switch (log.type) {
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

const getLogColor = (log: CareLog) => {
  switch (log.type) {
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
  growthData,
  activeSleep,
  nextBreastSide,
  onOpenLog,
  onEndSleep,
}: LogTabProps) {
  const [logView, setLogView] = useState<'timeline' | 'growth'>('timeline');
  const [elapsed, setElapsed] = useState(0);

  // 計測中は上部のバーの経過時間を毎秒更新する。
  useEffect(() => {
    if (!activeSleep) return;
    const update = () => setElapsed(Date.now() - activeSleep.startedAt.getTime());
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeSleep]);

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
        <>
          {activeSleep && (
            <div className="mb-3 shrink-0 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 flex items-center justify-between">
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

          <div className="grid grid-cols-3 gap-3 mb-6 shrink-0">
            <button
              onClick={() => onOpenLog('milk')}
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
              onClick={() => onOpenLog('diaper')}
              className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-blue-50 transition active:scale-95"
            >
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                <Droplet size={20} className="text-blue-500" />
              </div>
              <span className="text-xs font-bold text-gray-700">おむつ</span>
            </button>
            <button
              onClick={() => onOpenLog('sleep')}
              className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-indigo-50 transition active:scale-95"
            >
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center mb-2">
                <Moon size={20} className="text-indigo-500" />
              </div>
              <span className="text-xs font-bold text-gray-700">睡眠</span>
              {activeSleep && <span className="text-[9px] font-bold text-indigo-600 mt-0.5">計測中</span>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <h3 className="text-sm font-bold text-gray-500 mb-3 px-1">今日の記録 ({logs.length}件)</h3>
            <div className="relative border-l-2 border-gray-200 ml-4 space-y-6 pb-6">
              {logs.map((log) => {
                const badges = getLogBadges(log);
                return (
                  <div key={log.id} className="relative pl-6">
                    <div
                      className={`absolute -left-[17px] top-0 w-8 h-8 rounded-full border-4 border-gray-50 flex items-center justify-center ${getLogColor(log)}`}
                    >
                      {getLogIcon(log)}
                    </div>
                    <div
                      className={`bg-white p-3 rounded-xl shadow-sm border ${
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
                          {log.user}が記録
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-6 pb-6">
          <button className="w-full bg-blue-50 text-blue-600 font-medium py-3 rounded-xl shadow-sm border border-blue-200 transition flex items-center justify-center hover:bg-blue-100">
            <Plus size={18} className="mr-1" /> 身長・体重を記録する
          </button>

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
        </div>
      )}
    </div>
  );
}
