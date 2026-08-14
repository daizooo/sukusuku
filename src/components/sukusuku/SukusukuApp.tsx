'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Home,
  CalendarDays,
  FileText,
  Gift as GiftIcon,
  Folder,
  Plus,
} from 'lucide-react';

import type {
  CareLog,
  DocumentItem,
  DynamicTask,
  Gift,
  GrowthRecord,
  Nursery,
  Task,
  TabId,
  UserProfile,
} from '@/types/app';
import {
  INITIAL_DOCUMENTS,
  INITIAL_GIFTS,
  INITIAL_GROWTH_DATA,
  INITIAL_NURSERIES,
  INITIAL_PROFILE,
  createInitialLogs,
} from '@/lib/seedData';
import {
  calculateTargetDate,
  formatDateString,
  parseDateString,
  startOfDay,
  toDateString,
} from '@/lib/dateUtils';
import { createClient } from '@/lib/supabase/client';
import {
  deleteTask as deleteTaskApi,
  insertTask,
  listTasks,
  refreshBirthRelativeDates,
  updateTask as updateTaskApi,
  updateTaskDone,
} from '@/lib/api/tasks';
import { fetchChild, saveChild } from '@/lib/api/children';

import HomeTab from './tabs/HomeTab';
import ScheduleTab from './tabs/ScheduleTab';
import LogTab from './tabs/LogTab';
import GiftTab from './tabs/GiftTab';
import InfoTab from './tabs/InfoTab';
import AddTaskModal from './modals/AddTaskModal';
import type { TaskDraft } from './modals/TaskForm';
import TaskDetailModal from './modals/TaskDetailModal';

const NAV_ITEMS: { id: TabId; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'ホーム' },
  { id: 'schedule', icon: CalendarDays, label: '予定' },
  { id: 'log', icon: FileText, label: '記録' },
  { id: 'gift', icon: GiftIcon, label: 'お祝い' },
  { id: 'info', icon: Folder, label: 'ストック' },
];

const emptyTaskDraft = (date: Date): TaskDraft => ({
  title: '',
  category: '手続き',
  place: '',
  note: '',
  anchorType: 'absolute',
  startDate: toDateString(date),
  startTime: null,
  endTime: null,
  daysAfterBirth: 0,
  label: '家族',
  remindMinutesBefore: null,
  timing: '',
  belongings: '',
});

interface SukusukuAppProps {
  familyId: string;
  userId: string;
}

export default function SukusukuApp({ familyId }: SukusukuAppProps) {
  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [todos, setTodos] = useState<Task[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [taskError, setTaskError] = useState('');
  const [logs, setLogs] = useState<CareLog[]>(() => createInitialLogs());
  const [gifts] = useState<Gift[]>(INITIAL_GIFTS);
  const [growthData] = useState<GrowthRecord[]>(INITIAL_GROWTH_DATA);
  const [documents] = useState<DocumentItem[]>(INITIAL_DOCUMENTS);
  const [nurseries] = useState<Nursery[]>(INITIAL_NURSERIES);

  // --- UI状態 ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<DynamicTask | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [tempEditingTask, setTempEditingTask] = useState<DynamicTask | null>(null);

  // 「今日」は日付が変わらない限り同じ参照を使う（useMemo の依存に安全に渡せるようにするため）
  const today = useMemo(() => startOfDay(new Date()), []);

  const [newTask, setNewTask] = useState<TaskDraft>(() => emptyTaskDraft(today));

  const [currentCalendarDate, setCurrentCalendarDate] = useState(today);

  // 子供の名前・誕生日はSupabaseの children テーブルに保存する。
  // パパママ情報・住所は保存先のカラムが未定のため、現状は画面内の状態のみ。
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [childId, setChildId] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [tempProfile, setTempProfile] = useState<UserProfile>(userProfile);

  // 家族のタスクと子供情報をSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    Promise.all([listTasks(supabase, familyId), fetchChild(supabase, familyId)])
      .then(([tasks, child]) => {
        if (cancelled) return;
        setTodos(tasks);
        if (child) {
          setChildId(child.id);
          setUserProfile((prev) => ({ ...prev, babyName: child.name, birthDate: child.birthDate }));
        }
        setTaskError('');
      })
      .catch((err) => {
        console.error('Failed to load family data:', err);
        if (!cancelled) setTaskError('予定の読み込みに失敗しました。時間を置いて再度お試しください。');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTasks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  const dynamicTodos = useMemo<DynamicTask[]>(() => {
    return todos.map((todo) => {
      // 日付指定の予定は start_date をそのまま使い、
      // 出生日基準の予定は「子の誕生日 + 生後日数」で解決する。
      const targetDateObj =
        todo.anchorType === 'absolute'
          ? parseDateString(todo.startDate ?? '')
          : calculateTargetDate(userProfile.birthDate, todo.daysAfterBirth);
      return {
        ...todo,
        targetDateObj,
        targetDate: formatDateString(targetDateObj),
      };
    });
  }, [todos, userProfile.birthDate]);

  const ageInDays = useMemo(() => {
    const birth = parseDateString(userProfile.birthDate);
    if (!birth) return 0;
    const diffTime = today.getTime() - birth.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }, [userProfile.birthDate, today]);

  const ageInMonths = useMemo(() => {
    const birth = parseDateString(userProfile.birthDate);
    if (!birth) return { months: 0, days: 0 };
    let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
    let tempDate = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());

    if (today < tempDate) {
      months -= 1;
      tempDate = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());
    }
    const days = Math.floor((today.getTime() - tempDate.getTime()) / (1000 * 60 * 60 * 24));
    return { months, days };
  }, [userProfile.birthDate, today]);

  const toggleTodo = async (id: string) => {
    const target = todos.find((t) => t.id === id);
    if (!target) return;
    const nextDone = !target.done;

    // 楽観的更新
    setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, done: nextDone } : todo)));
    setSelectedTask((prev) => (prev && prev.id === id ? { ...prev, done: nextDone } : prev));

    try {
      await updateTaskDone(supabase, id, nextDone);
    } catch (err) {
      console.error('Failed to update task:', err);
      // 失敗時はロールバック
      setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, done: !nextDone } : todo)));
      setSelectedTask((prev) => (prev && prev.id === id ? { ...prev, done: !nextDone } : prev));
    }
  };

  const openTaskDetail = (task: DynamicTask) => {
    setSelectedTask(task);
    setIsEditingTask(false);
    setTempEditingTask(task);
  };

  const closeTaskDetail = () => setSelectedTask(null);

  const saveTaskEdit = async () => {
    if (!tempEditingTask) return;
    const updated = tempEditingTask;

    setTodos((prev) => prev.map((todo) => (todo.id === updated.id ? { ...todo, ...updated } : todo)));
    setSelectedTask(updated);
    setIsEditingTask(false);

    try {
      await updateTaskApi(supabase, updated);
    } catch (err) {
      console.error('Failed to save task:', err);
      alert('保存に失敗しました。もう一度お試しください。');
    }
  };

  const handleDeleteTask = async (id: string) => {
    const previousTodos = todos;
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
    setSelectedTask(null);

    try {
      await deleteTaskApi(supabase, id);
    } catch (err) {
      console.error('Failed to delete task:', err);
      setTodos(previousTodos);
      alert('削除に失敗しました。もう一度お試しください。');
    }
  };

  const handleProfileSave = async () => {
    const previousProfile = userProfile;
    const birthDateChanged = tempProfile.birthDate !== userProfile.birthDate;

    setUserProfile(tempProfile);
    setIsEditingProfile(false);

    try {
      const saved = await saveChild(supabase, familyId, {
        id: childId,
        name: tempProfile.babyName,
        birthDate: tempProfile.birthDate,
      });
      setChildId(saved.id);

      // 誕生日が変わったら、出生日基準の予定の日付を計算し直す
      if (birthDateChanged) {
        await refreshBirthRelativeDates(supabase, familyId);
        setTodos(await listTasks(supabase, familyId));
      }
    } catch (err) {
      console.error('Failed to save profile:', err);
      setUserProfile(previousProfile);
      alert('プロフィールの保存に失敗しました。もう一度お試しください。');
    }
  };

  const startEditingProfile = () => {
    setTempProfile(userProfile);
    setIsEditingProfile(true);
  };

  const handleAddTask = async () => {
    if (!newTask.title) return;
    const input = { ...newTask };

    setShowAddModal(false);
    setNewTask(emptyTaskDraft(today));

    try {
      const created = await insertTask(supabase, familyId, input);
      setTodos((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to add task:', err);
      alert('予定の追加に失敗しました。もう一度お試しください。');
    }
  };

  const addLog = (type: CareLog['type'], label: string) => {
    const newLog: CareLog = {
      id: Date.now(),
      type,
      label,
      amount: type === 'milk' ? '100ml' : '',
      time: new Date(),
      note: '',
      user: 'あなた',
    };
    setLogs((prev) => [newLog, ...prev].sort((a, b) => b.time.getTime() - a.time.getTime()));
  };

  return (
    <div className="w-full max-w-md mx-auto h-screen sm:h-[850px] relative bg-gray-50 flex flex-col font-sans overflow-hidden shadow-2xl sm:rounded-3xl sm:my-8 border sm:border-gray-200">
      <header className="flex-none bg-white px-4 py-3 flex flex-col items-center justify-center shadow-sm z-10 relative">
        <h1 className="font-bold text-gray-800 tracking-wide text-lg">すくすく手帳</h1>
      </header>

      {taskError && (
        <p className="flex-none bg-red-50 text-red-600 text-xs text-center py-2 px-4 border-b border-red-100">{taskError}</p>
      )}

      <main className="flex-1 overflow-hidden">
        {activeTab === 'home' && (
          <HomeTab
            userProfile={userProfile}
            ageInDays={ageInDays}
            ageInMonths={ageInMonths}
            dynamicTodos={dynamicTodos}
            isLoadingTodos={isLoadingTasks}
            onToggleTodo={toggleTodo}
            onOpenTask={openTaskDetail}
            onViewAllSchedule={() => setActiveTab('schedule')}
          />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab
            dynamicTodos={dynamicTodos}
            isLoadingTodos={isLoadingTasks}
            today={today}
            currentCalendarDate={currentCalendarDate}
            onChangeCalendarDate={setCurrentCalendarDate}
            onToggleTodo={toggleTodo}
            onOpenTask={openTaskDetail}
          />
        )}
        {activeTab === 'log' && (
          <LogTab logs={logs} growthData={growthData} onAddLog={addLog} />
        )}
        {activeTab === 'gift' && <GiftTab gifts={gifts} />}
        {activeTab === 'info' && (
          <InfoTab
            userProfile={userProfile}
            tempProfile={tempProfile}
            isEditingProfile={isEditingProfile}
            onStartEditProfile={startEditingProfile}
            onChangeTempProfile={setTempProfile}
            onSaveProfile={handleProfileSave}
            documents={documents}
            nurseries={nurseries}
          />
        )}
      </main>

      {activeTab === 'schedule' && (
        <button
          onClick={() => setShowAddModal(true)}
          className="absolute bottom-20 right-4 w-14 h-14 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-blue-600 hover:scale-105 transition-all active:scale-95 z-20"
        >
          <Plus size={28} />
        </button>
      )}

      <nav className="flex-none bg-white border-t border-gray-200 flex justify-around items-center h-16 absolute bottom-0 left-0 right-0 w-full z-30 px-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition ${
              activeTab === item.id ? 'text-blue-500' : 'text-gray-400 hover:text-gray-500'
            }`}
          >
            <item.icon size={22} className={activeTab === item.id ? 'stroke-[2.5px]' : 'stroke-2'} />
            <span className="text-[9px] font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <AddTaskModal
        show={showAddModal}
        newTask={newTask}
        allowBirthRelative={!userProfile.birthDate}
        onChange={setNewTask}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddTask}
      />
      <TaskDetailModal
        selectedTask={selectedTask}
        isEditingTask={isEditingTask}
        tempEditingTask={tempEditingTask}
        allowBirthRelative={!userProfile.birthDate}
        onStartEdit={() => setIsEditingTask(true)}
        onChangeTempEditingTask={setTempEditingTask}
        onSaveEdit={saveTaskEdit}
        onClose={closeTaskDetail}
        onToggleDone={() => selectedTask && toggleTodo(selectedTask.id)}
        onDelete={() => selectedTask && handleDeleteTask(selectedTask.id)}
      />
    </div>
  );
}
