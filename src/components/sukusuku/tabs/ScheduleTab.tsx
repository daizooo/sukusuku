'use client';

import { useState } from 'react';
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Filter,
  List,
  BellRing,
} from 'lucide-react';
import type { Assignee, DynamicTask } from '@/types/app';
import { getAssigneeColor } from '@/lib/uiUtils';
import { getDaysInMonth, getFirstDayOfMonth } from '@/lib/dateUtils';

interface ScheduleTabProps {
  dynamicTodos: DynamicTask[];
  today: Date;
  currentCalendarDate: Date;
  onChangeCalendarDate: (date: Date) => void;
  onToggleTodo: (id: number) => void;
  onOpenTask: (task: DynamicTask) => void;
}

const ASSIGNEE_FILTERS: (Assignee | 'すべて')[] = ['すべて', 'パパ', 'ママ', '二人で', '未定'];

export default function ScheduleTab({
  dynamicTodos,
  today,
  currentCalendarDate,
  onChangeCalendarDate,
  onToggleTodo,
  onOpenTask,
}: ScheduleTabProps) {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [assigneeFilter, setAssigneeFilter] = useState<Assignee | 'すべて'>('すべて');

  const filteredTodos = dynamicTodos.filter((t) => assigneeFilter === 'すべて' || t.assignee === assigneeFilter);

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  const days: (Date | null)[] = [];
  const firstDay = getFirstDayOfMonth(year, month);
  for (let i = 0; i < firstDay; i += 1) days.push(null);
  for (let i = 1; i <= getDaysInMonth(year, month); i += 1) days.push(new Date(year, month, i));

  const tasksInMonth = dynamicTodos.filter(
    (t) => t.targetDateObj && t.targetDateObj.getFullYear() === year && t.targetDateObj.getMonth() === month,
  );

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">スケジュール</h2>
        <div className="flex bg-gray-200 p-1 rounded-lg">
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center transition ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            <List size={14} className="mr-1" /> リスト
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center transition ${viewMode === 'calendar' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            <CalendarDays size={14} className="mr-1" /> カレンダー
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <>
          <div className="flex space-x-2 mb-4 overflow-x-auto pb-2">
            <span className="flex items-center text-gray-500 text-xs font-medium mr-1">
              <Filter size={14} />
            </span>
            {ASSIGNEE_FILTERS.map((a) => (
              <button
                key={a}
                onClick={() => setAssigneeFilter(a)}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap font-medium transition border ${
                  assigneeFilter === a
                    ? a === 'すべて'
                      ? 'bg-gray-700 text-white border-gray-700'
                      : getAssigneeColor(a)
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pb-6">
            {filteredTodos.map((task) => (
              <div
                key={task.id}
                className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-start space-x-3 cursor-pointer hover:bg-gray-50 transition"
                onClick={() => onOpenTask(task)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleTodo(task.id);
                  }}
                  className={`mt-1 flex-shrink-0 p-1 -ml-1 transition-colors ${task.done ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}
                >
                  {task.done ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                </button>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <p className={`font-medium text-base leading-tight ${task.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                      {task.title}
                      {task.notification && !task.done && <BellRing size={14} className="inline ml-1.5 text-yellow-500 mb-0.5" />}
                    </p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ml-2 ${getAssigneeColor(task.assignee)}`}>
                      {task.assignee}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 mt-2 space-y-1.5">
                    <p className="flex items-center text-blue-600 font-medium">
                      <Calendar size={14} className="mr-2" /> 目安: {task.targetDate}
                    </p>
                    <p className="flex items-center">
                      <Clock size={14} className="mr-2" /> {task.timing}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3 bg-white p-2 rounded-xl shadow-sm border border-gray-100">
            <button onClick={() => onChangeCalendarDate(new Date(year, month - 1, 1))} className="p-2 text-gray-600">
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-base font-bold text-gray-800">
              {year}年 {month + 1}月
            </h3>
            <button onClick={() => onChangeCalendarDate(new Date(year, month + 1, 1))} className="p-2 text-gray-600">
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3 flex-none">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                <div key={d} className={`text-center text-[10px] font-medium ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1 gap-x-1">
              {days.map((date, idx) => {
                if (!date) return <div key={`empty-${idx}`} className="h-10" />;
                const dayTasks = tasksInMonth.filter((t) => t.targetDateObj!.getDate() === date.getDate());
                const isToday =
                  date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
                return (
                  <div key={date.toISOString()} className={`flex flex-col items-center p-1 rounded-md h-12 ${isToday ? 'bg-blue-50' : ''}`}>
                    <span className={`text-xs ${isToday ? 'text-blue-700 font-bold' : 'text-gray-700'}`}>{date.getDate()}</span>
                    {dayTasks.length > 0 && (
                      <div className="flex space-x-0.5 mt-0.5">
                        {dayTasks.slice(0, 3).map((t, i) => (
                          <div key={i} className={`w-1.5 h-1.5 rounded-full ${t.done ? 'bg-gray-300' : 'bg-blue-500'}`} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pb-4">
            <h4 className="text-xs font-bold text-gray-500 mb-2 px-1">{month + 1}月の予定 ({tasksInMonth.length}件)</h4>
            <div className="space-y-2">
              {[...tasksInMonth]
                .sort((a, b) => a.targetDateObj!.getTime() - b.targetDateObj!.getTime())
                .map((task) => (
                  <div
                    key={task.id}
                    className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-3 cursor-pointer"
                    onClick={() => onOpenTask(task)}
                  >
                    <div className="flex-shrink-0 text-center w-10">
                      <span className="text-[10px] text-gray-500 block">{month + 1}月</span>
                      <span className="text-base font-bold text-gray-800">{task.targetDateObj!.getDate()}</span>
                    </div>
                    <div className="flex-1 border-l pl-3 border-gray-100 min-w-0">
                      <p className={`font-medium text-sm truncate ${task.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{task.title}</p>
                      <span className={`text-[9px] font-bold px-1 py-0.5 rounded border inline-block mt-1 ${getAssigneeColor(task.assignee)}`}>
                        {task.assignee}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
