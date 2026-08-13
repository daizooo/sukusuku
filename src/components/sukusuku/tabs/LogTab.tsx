'use client';

import { useState } from 'react';
import { Coffee, Droplet, FileText, List, Moon, Plus, TrendingUp, User } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CareLog, GrowthRecord, LogType } from '@/types/app';
import { formatTimeString } from '@/lib/dateUtils';
import CareLogFormModal, { type CareLogDraft } from '../modals/CareLogFormModal';
import GrowthRecordFormModal, { type GrowthRecordDraft } from '../modals/GrowthRecordFormModal';

interface LogTabProps {
  logs: CareLog[];
  growthData: GrowthRecord[];
  isLoadingLogs?: boolean;
  isLoadingGrowth?: boolean;
  memberLabel: (id: string | null) => string;
  onAddLog: (type: LogType) => void;
  onUpdateLog: (log: CareLog, draft: CareLogDraft) => void;
  onDeleteLog: (id: string) => void;
  onAddGrowthRecord: (draft: GrowthRecordDraft) => void;
  onUpdateGrowthRecord: (record: GrowthRecord, draft: GrowthRecordDraft) => void;
  onDeleteGrowthRecord: (id: string) => void;
}

const getLogIcon = (type: CareLog['type']) => {
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

const getLogColor = (type: CareLog['type']) => {
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

export default function LogTab({
  logs,
  growthData,
  isLoadingLogs,
  isLoadingGrowth,
  memberLabel,
  onAddLog,
  onUpdateLog,
  onDeleteLog,
  onAddGrowthRecord,
  onUpdateGrowthRecord,
  onDeleteGrowthRecord,
}: LogTabProps) {
  const [logView, setLogView] = useState<'timeline' | 'growth'>('timeline');
  const [selectedLog, setSelectedLog] = useState<CareLog | null>(null);
  const [growthModal, setGrowthModal] = useState<{ mode: 'add' | 'edit'; record: GrowthRecord | null } | null>(null);

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
          <div className="grid grid-cols-3 gap-3 mb-6 shrink-0">
            <button
              onClick={() => onAddLog('milk')}
              className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-amber-50 transition active:scale-95"
            >
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center mb-2">
                <Coffee size={20} className="text-amber-600" />
              </div>
              <span className="text-xs font-bold text-gray-700">ミルク</span>
            </button>
            <button
              onClick={() => onAddLog('diaper')}
              className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-blue-50 transition active:scale-95"
            >
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                <Droplet size={20} className="text-blue-500" />
              </div>
              <span className="text-xs font-bold text-gray-700">おむつ</span>
            </button>
            <button
              onClick={() => onAddLog('sleep')}
              className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center hover:bg-indigo-50 transition active:scale-95"
            >
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center mb-2">
                <Moon size={20} className="text-indigo-500" />
              </div>
              <span className="text-xs font-bold text-gray-700">睡眠</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <h3 className="text-sm font-bold text-gray-500 mb-3 px-1">今日の記録 ({logs.length}件)</h3>
            {isLoadingLogs && <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>}
            {!isLoadingLogs && logs.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">記録はまだありません</p>
            )}
            <div className="relative border-l-2 border-gray-200 ml-4 space-y-6 pb-6">
              {logs.map((log) => (
                <div key={log.id} className="relative pl-6">
                  <div className={`absolute -left-[17px] top-0 w-8 h-8 rounded-full border-4 border-gray-50 flex items-center justify-center ${getLogColor(log.type)}`}>
                    {getLogIcon(log.type)}
                  </div>
                  <button
                    onClick={() => setSelectedLog(log)}
                    className="w-full text-left bg-white p-3 rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-gray-800 text-sm">{log.label}</span>
                        {log.amount && <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">{log.amount}</span>}
                      </div>
                      <span className="text-xs text-gray-400 font-medium">{formatTimeString(log.time)}</span>
                    </div>
                    <div className="flex justify-between items-end mt-2">
                      <p className="text-xs text-gray-500">{log.note || 'メモなし'}</p>
                      <span className="text-[10px] text-gray-400 flex items-center">
                        <User size={10} className="mr-1" />
                        {memberLabel(log.createdBy)}が記録
                      </span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
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
            <>
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

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
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
            </>
          )}

          {!isLoadingGrowth && growthData.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">記録はまだありません</p>
          )}
        </div>
      )}

      <CareLogFormModal
        key={selectedLog?.id ?? 'none'}
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
        onSubmit={(draft) => {
          if (selectedLog) onUpdateLog(selectedLog, draft);
          setSelectedLog(null);
        }}
        onDelete={(id) => {
          onDeleteLog(id);
          setSelectedLog(null);
        }}
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
