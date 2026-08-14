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
import { calculateTargetDate, formatDateString } from '@/lib/dateUtils';
import { createClient } from '@/lib/supabase/client';
import {
  deleteTask as deleteTaskApi,
  insertTask,
  listTasks,
  updateTask as updateTaskApi,
  updateTaskDone,
  type NewTaskInput,
} from '@/lib/api/tasks';
import { getProfile, saveProfile } from '@/lib/api/profile';

import HomeTab from './tabs/HomeTab';
import ScheduleTab from './tabs/ScheduleTab';
import LogTab from './tabs/LogTab';
import GiftTab from './tabs/GiftTab';
import InfoTab from './tabs/InfoTab';
import AddTaskModal, { type NewTaskDraft } from './modals/AddTaskModal';
import TaskDetailModal from './modals/TaskDetailModal';

const NAV_ITEMS: { id: TabId; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'ホーム' },
  { id: 'schedule', icon: CalendarDays, label: '予定' },
  { id: 'log', icon: FileText, label: '記録' },
  { id: 'gift', icon: GiftIcon, label: 'お祝い' },
  { id: 'info', icon: Folder, label: '設定' },
];

const EMPTY_NEW_TASK: NewTaskDraft = {
  title: '',
  category: '手続き',
  timing: '',
  daysAfterBirth: 0,
  place: '',
  note: '',
  belongings: '',
  assignee: '未定',
  notification: false,
};

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

  const [newTask, setNewTask] = useState<NewTaskDraft>(EMPTY_NEW_TASK);

  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());

  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [tempProfile, setTempProfile] = useState<UserProfile>(userProfile);

  const today = new Date();

  // 家族のタスクをSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    listTasks(supabase, familyId)
      .then((data) => {
        if (cancelled) return;
        setTodos(data);
        setTaskError('');
      })
      .catch((err) => {
        console.error('Failed to load tasks:', err);
        if (!cancelled) setTaskError('予定の読み込みに失敗しました。時間を置いて再度お試しください。');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTasks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 設定タブ(お子様情報・パパママ情報)をSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    getProfile(supabase, familyId)
      .then((profile) => {
        if (cancelled || !profile) return;
        setUserProfile(profile);
      })
      .catch((err) => {
        console.error('Failed to load profile:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  const dynamicTodos = useMemo<DynamicTask[]>(() => {
    return todos.map((todo) => {
      const targetDateObj = calculateTargetDate(userProfile.birthDate, todo.daysAfterBirth);
      return {
        ...todo,
        targetDateObj,
        targetDate: formatDateString(targetDateObj),
      };
    });
  }, [todos, userProfile.birthDate]);

  const ageInDays = useMemo(() => {
    if (!userProfile.birthDate) return 0;
    const birth = new Date(userProfile.birthDate);
    if (isNaN(birth.getTime())) return 0;
    const birthDateOnly = new Date(birth.getFullYear(), birth.getMonth(), birth.getDate());
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffTime = todayDateOnly.getTime() - birthDateOnly.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile.birthDate]);

  const ageInMonths = useMemo(() => {
    if (!userProfile.birthDate) return { months: 0, days: 0 };
    const birth = new Date(userProfile.birthDate);
    if (isNaN(birth.getTime())) return { months: 0, days: 0 };
    let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
    let tempDate = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());

    if (today < tempDate) {
      months -= 1;
      tempDate = new Date(birth.getFullYear(), birth.getMonth() + months, birth.getDate());
    }
    const days = Math.floor((today.getTime() - tempDate.getTime()) / (1000 * 60 * 60 * 24));
    return { months, days };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile.birthDate]);

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
    const updated = tempProfile;

    setUserProfile(updated);
    setIsEditingProfile(false);

    try {
      await saveProfile(supabase, familyId, updated);
    } catch (err) {
      console.error('Failed to save profile:', err);
      // 失敗時はロールバック
      setUserProfile(previousProfile);
      alert('保存に失敗しました。もう一度お試しください。');
    }
  };

  const startEditingProfile = () => {
    setTempProfile(userProfile);
    setIsEditingProfile(true);
  };

  const handleAddTask = async () => {
    if (!newTask.title) return;
    const daysAfterBirth = Number(newTask.daysAfterBirth) || 0;
    const input: NewTaskInput = {
      title: newTask.title,
      category: newTask.category,
      daysAfterBirth,
      timing: newTask.timing || `生後${daysAfterBirth}日頃`,
      place: newTask.place || '未定',
      note: newTask.note,
      belongings: newTask.belongings,
      assignee: newTask.assignee,
      notification: newTask.notification,
    };

    setShowAddModal(false);
    setNewTask(EMPTY_NEW_TASK);

    try {
      const created = await insertTask(supabase, familyId, input);
      setTodos((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to add task:', err);
      alert('タスクの追加に失敗しました。もう一度お試しください。');
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
        onChange={setNewTask}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddTask}
      />
      <TaskDetailModal
        selectedTask={selectedTask}
        isEditingTask={isEditingTask}
        tempEditingTask={tempEditingTask}
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
