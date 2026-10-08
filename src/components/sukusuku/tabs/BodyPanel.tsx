'use client';

import { useState } from 'react';
import { ChevronLeft, Plus, Thermometer, TrendingUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GrowthRecord, TemperatureLog } from '@/types/app';
import { formatCelsius, isFever } from '@/lib/careLogUtils';
import { useBackLayer } from '@/lib/browserHistory';
import { WEEKDAY_LABELS, formatTimeString } from '@/lib/dateUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import { useSwipeTabs } from '../ui/useSwipeTabs';

// 育児タブの「からだ」。体温と身長・体重（成長）を、1つの画面で記録して振り返る。
// mobile版は `mobile/src/components/care/BodyPanel.tsx`。
//
// 体温は日ごとの記録の中にも出るが、ここでは日をまたいで直近の測定をまとめて見られる。
// 身長・体重は以前の「成長」の切り替えにあったもの。どちらも体のことなので1か所にまとめた。
// 画面のデータと保存は育児タブ（CareTab）が持つ。ここは表示と操作の受け口だけ。
//
// 戻る操作（ブラウザの戻る・左上の矢印）で記録へ戻る（useBackLayer）。

type BodyView = 'temperature' | 'growth';

/** 一覧に出す体温の件数の上限（読み込みの上限と同じ。careLogs.ts の listRecentTemperatureLogs）。 */
const TEMPERATURE_LIST_LIMIT = 60;

interface BodyPanelProps {
  /** 体温の記録。新しい順。 */
  temperatureLogs: TemperatureLog[];
  growthData: GrowthRecord[];
  /** 成長曲線の点。横軸のラベル付き。 */
  growthChartData: (GrowthRecord & { axisLabel: string })[];
  isLoadingGrowth?: boolean;
  memberLabel: (id: string | null) => string;
  onBack: () => void;
  onAddTemperature: () => void;
  onEditTemperature: (log: TemperatureLog) => void;
  onAddGrowth: () => void;
  onEditGrowth: (record: GrowthRecord) => void;
}

const formatLogDate = (date: Date): string =>
  `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]})`;

const ADD_BUTTON_CLASS =
  'w-full bg-blue-50 text-blue-600 font-medium py-3 rounded-xl shadow-sm border border-blue-200 transition flex items-center justify-center hover:bg-blue-100';

export default function BodyPanel({
  temperatureLogs,
  growthData,
  growthChartData,
  isLoadingGrowth,
  memberLabel,
  onBack,
  onAddTemperature,
  onEditTemperature,
  onAddGrowth,
  onEditGrowth,
}: BodyPanelProps) {
  useBackLayer(onBack);
  const [view, setView] = useState<BodyView>('temperature');
  // 体温/身長・体重は、画面のどこでの左右スワイプでも切り替える。
  const swipeHandlers = useSwipeTabs<BodyView>(['temperature', 'growth'], view, setView);

  return (
    <div className="h-full flex flex-col gap-3 p-4 lg:max-w-3xl" {...swipeHandlers}>
      <div className="shrink-0 flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="戻る"
          className="p-1 text-blue-500 hover:bg-gray-100 rounded-lg transition"
        >
          <ChevronLeft size={24} />
        </button>
        <h2 className="font-bold text-gray-900">からだ</h2>
      </div>

      <SegmentedTabs
        ariaLabel="からだの表示"
        value={view}
        onChange={setView}
        options={[
          { id: 'temperature', label: '体温', icon: <Thermometer size={15} /> },
          { id: 'growth', label: '身長・体重', icon: <TrendingUp size={15} /> },
        ]}
      />

      {/* スクロールするのは中身だけ。 */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-6">
        {view === 'temperature' ? (
          <>
            <button onClick={onAddTemperature} className={ADD_BUTTON_CLASS}>
              <Plus size={18} className="mr-1" /> 体温を記録する
            </button>

            {temperatureLogs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">記録はまだありません</p>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
                {temperatureLogs.map((log) => (
                  <button
                    key={log.id}
                    onClick={() => onEditTemperature(log)}
                    className="w-full text-left p-3 flex items-center justify-between gap-2 hover:bg-gray-50 transition"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-gray-500 tabular-nums">
                        {formatLogDate(log.time)} {formatTimeString(log.time)}
                      </span>
                      <span className="block text-[10px] text-gray-400">{memberLabel(log.createdBy)}が記録</span>
                    </span>
                    <span
                      className={`text-base font-bold tabular-nums ${
                        isFever(log.celsius) ? 'text-red-500' : 'text-orange-600'
                      }`}
                    >
                      {formatCelsius(log.celsius)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {temperatureLogs.length >= TEMPERATURE_LIST_LIMIT && (
              <p className="text-[11px] text-gray-400 text-center">直近{TEMPERATURE_LIST_LIMIT}件を表示しています</p>
            )}
          </>
        ) : (
          <div className="space-y-6">
            <button onClick={onAddGrowth} className={ADD_BUTTON_CLASS}>
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
                      onClick={() => onEditGrowth(record)}
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
      </div>
    </div>
  );
}
