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
  FamilyMember,
  Gift,
  GrowthRecord,
  LogType,
  Nursery,
  Task,
  TabId,
  UserProfile,
} from '@/types/app';
import { INITIAL_PROFILE } from '@/lib/seedData';
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
import {
  deleteCareLog,
  insertCareLog,
  listCareLogs,
  updateCareLog as updateCareLogApi,
} from '@/lib/api/careLogs';
import { deleteGift, insertGift, listGifts, updateGift as updateGiftApi } from '@/lib/api/gifts';
import { ensureChildId } from '@/lib/api/children';
import {
  deleteGrowthRecord,
  insertGrowthRecord,
  listGrowthRecords,
  updateGrowthRecord as updateGrowthRecordApi,
} from '@/lib/api/growthRecords';
import {
  deleteDocument,
  getDocumentSignedUrl,
  listDocuments,
  uploadDocument,
} from '@/lib/api/documents';
import {
  deleteNursery,
  insertNursery,
  listNurseries,
  updateNursery as updateNurseryApi,
} from '@/lib/api/nurseries';
import { listFamilyMembers } from '@/lib/api/familyMembers';

import HomeTab from './tabs/HomeTab';
import ScheduleTab from './tabs/ScheduleTab';
import LogTab from './tabs/LogTab';
import GiftTab from './tabs/GiftTab';
import InfoTab from './tabs/InfoTab';
import AddTaskModal, { type NewTaskDraft } from './modals/AddTaskModal';
import TaskDetailModal from './modals/TaskDetailModal';
import type { CareLogDraft } from './modals/CareLogFormModal';
import type { GiftDraft } from './modals/GiftFormModal';
import type { GrowthRecordDraft } from './modals/GrowthRecordFormModal';
import type { NurseryDraft } from './modals/NurseryFormModal';

const NAV_ITEMS: { id: TabId; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'ホーム' },
  { id: 'schedule', icon: CalendarDays, label: '予定' },
  { id: 'log', icon: FileText, label: '記録' },
  { id: 'gift', icon: GiftIcon, label: 'お祝い' },
  { id: 'info', icon: Folder, label: 'ストック' },
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

const applyTimeToDate = (base: Date, hhmm: string): Date => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const next = new Date(base);
  if (!Number.isNaN(hours) && !Number.isNaN(minutes)) next.setHours(hours, minutes, 0, 0);
  return next;
};

const parseNullableNumber = (value: string): number | null => (value === '' ? null : Number(value));

interface SukusukuAppProps {
  familyId: string;
  userId: string;
}

export default function SukusukuApp({ familyId, userId }: SukusukuAppProps) {
  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [todos, setTodos] = useState<Task[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [taskError, setTaskError] = useState('');

  const [logs, setLogs] = useState<CareLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);

  const [gifts, setGifts] = useState<Gift[]>([]);
  const [isLoadingGifts, setIsLoadingGifts] = useState(true);

  const [growthData, setGrowthData] = useState<GrowthRecord[]>([]);
  const [isLoadingGrowth, setIsLoadingGrowth] = useState(true);
  const [childId, setChildId] = useState<string | null>(null);

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);

  const [nurseries, setNurseries] = useState<Nursery[]>([]);
  const [isLoadingNurseries, setIsLoadingNurseries] = useState(true);

  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);

  // --- UI状態 ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<DynamicTask | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [tempEditingTask, setTempEditingTask] = useState<DynamicTask | null>(null);

  const [newTask, setNewTask] = useState<NewTaskDraft>(EMPTY_NEW_TASK);

  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());

  // TODO: プロフィール(子供の名前・誕生日、パパママ情報)はまだSupabase未連携（次のステップ）
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

  // 育児記録をSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    listCareLogs(supabase, familyId)
      .then((data) => {
        if (!cancelled) setLogs(data);
      })
      .catch((err) => console.error('Failed to load care logs:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingLogs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // お祝いをSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    listGifts(supabase, familyId)
      .then((data) => {
        if (!cancelled) setGifts(data);
      })
      .catch((err) => console.error('Failed to load gifts:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingGifts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 成長記録をSupabaseから取得(childレコードを確保してから取得する)
  useEffect(() => {
    let cancelled = false;
    ensureChildId(supabase, familyId)
      .then((id) => {
        if (cancelled) return;
        setChildId(id);
        return listGrowthRecords(supabase, id);
      })
      .then((data) => {
        if (!cancelled && data) setGrowthData(data);
      })
      .catch((err) => console.error('Failed to load growth records:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingGrowth(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 書類箱をSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    listDocuments(supabase, familyId)
      .then((data) => {
        if (!cancelled) setDocuments(data);
      })
      .catch((err) => console.error('Failed to load documents:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingDocuments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 保活メモをSupabaseから取得
  useEffect(() => {
    let cancelled = false;
    listNurseries(supabase, familyId)
      .then((data) => {
        if (!cancelled) setNurseries(data);
      })
      .catch((err) => console.error('Failed to load nurseries:', err))
      .finally(() => {
        if (!cancelled) setIsLoadingNurseries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  // 家族メンバー(パパ/ママ)の表示名解決用
  useEffect(() => {
    let cancelled = false;
    listFamilyMembers(supabase, familyId)
      .then((data) => {
        if (!cancelled) setFamilyMembers(data);
      })
      .catch((err) => console.error('Failed to load family members:', err));
    return () => {
      cancelled = true;
    };
  }, [supabase, familyId]);

  const memberLabel = (id: string | null): string => {
    if (!id) return '不明';
    const member = familyMembers.find((m) => m.id === id);
    if (member?.name) return member.name;
    if (id === userId) return 'あなた';
    return 'パートナー';
  };

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

  const handleProfileSave = () => {
    setUserProfile(tempProfile);
    setIsEditingProfile(false);
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

  // --- 育児記録 ---
  const addLog = async (type: LogType) => {
    try {
      const created = await insertCareLog(supabase, familyId, userId, { type, amount: '', note: '' });
      setLogs((prev) => [created, ...prev].sort((a, b) => b.time.getTime() - a.time.getTime()));
    } catch (err) {
      console.error('Failed to add care log:', err);
      alert('記録の追加に失敗しました。もう一度お試しください。');
    }
  };

  const updateLog = async (log: CareLog, draft: CareLogDraft) => {
    const updated: CareLog = { ...log, amount: draft.amount, note: draft.note, time: applyTimeToDate(log.time, draft.time) };
    setLogs((prev) => prev.map((l) => (l.id === log.id ? updated : l)).sort((a, b) => b.time.getTime() - a.time.getTime()));
    try {
      await updateCareLogApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update care log:', err);
      alert('記録の更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteLog = async (id: string) => {
    const previous = logs;
    setLogs((prev) => prev.filter((l) => l.id !== id));
    try {
      await deleteCareLog(supabase, id);
    } catch (err) {
      console.error('Failed to delete care log:', err);
      setLogs(previous);
      alert('記録の削除に失敗しました。もう一度お試しください。');
    }
  };

  // --- お祝い ---
  const addGift = async (draft: GiftDraft) => {
    try {
      const created = await insertGift(supabase, familyId, draft);
      setGifts((prev) => [created, ...prev]);
    } catch (err) {
      console.error('Failed to add gift:', err);
      alert('お祝いの追加に失敗しました。もう一度お試しください。');
    }
  };

  const updateGiftHandler = async (gift: Gift, draft: GiftDraft) => {
    const updated: Gift = { ...gift, ...draft };
    setGifts((prev) => prev.map((g) => (g.id === gift.id ? updated : g)));
    try {
      await updateGiftApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update gift:', err);
      alert('お祝いの更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteGiftHandler = async (id: string) => {
    const previous = gifts;
    setGifts((prev) => prev.filter((g) => g.id !== id));
    try {
      await deleteGift(supabase, id);
    } catch (err) {
      console.error('Failed to delete gift:', err);
      setGifts(previous);
      alert('お祝いの削除に失敗しました。もう一度お試しください。');
    }
  };

  // --- 成長記録 ---
  const addGrowthRecordHandler = async (draft: GrowthRecordDraft) => {
    try {
      const id = childId ?? (await ensureChildId(supabase, familyId));
      if (!childId) setChildId(id);
      const created = await insertGrowthRecord(supabase, id, {
        monthAge: parseNullableNumber(draft.monthAge),
        height: parseNullableNumber(draft.height),
        weight: parseNullableNumber(draft.weight),
        recordedDate: draft.recordedDate,
      });
      setGrowthData((prev) => [...prev, created].sort((a, b) => a.recordedDate.localeCompare(b.recordedDate)));
    } catch (err) {
      console.error('Failed to add growth record:', err);
      alert('成長記録の追加に失敗しました。もう一度お試しください。');
    }
  };

  const updateGrowthRecordHandler = async (record: GrowthRecord, draft: GrowthRecordDraft) => {
    const updated: GrowthRecord = {
      ...record,
      month: parseNullableNumber(draft.monthAge),
      height: parseNullableNumber(draft.height),
      weight: parseNullableNumber(draft.weight),
      recordedDate: draft.recordedDate,
    };
    setGrowthData((prev) =>
      prev.map((r) => (r.id === record.id ? updated : r)).sort((a, b) => a.recordedDate.localeCompare(b.recordedDate)),
    );
    try {
      await updateGrowthRecordApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update growth record:', err);
      alert('成長記録の更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteGrowthRecordHandler = async (id: string) => {
    const previous = growthData;
    setGrowthData((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteGrowthRecord(supabase, id);
    } catch (err) {
      console.error('Failed to delete growth record:', err);
      setGrowthData(previous);
      alert('成長記録の削除に失敗しました。もう一度お試しください。');
    }
  };

  // --- 書類箱 ---
  const addDocument = async (file: File, title: string) => {
    try {
      const created = await uploadDocument(supabase, familyId, file, title);
      setDocuments((prev) => [created, ...prev]);
    } catch (err) {
      console.error('Failed to upload document:', err);
      alert('書類の追加に失敗しました。もう一度お試しください。');
    }
  };

  const deleteDocumentHandler = async (doc: DocumentItem) => {
    const previous = documents;
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    try {
      await deleteDocument(supabase, doc);
    } catch (err) {
      console.error('Failed to delete document:', err);
      setDocuments(previous);
      alert('書類の削除に失敗しました。もう一度お試しください。');
    }
  };

  const getDocumentUrl = (filePath: string) => getDocumentSignedUrl(supabase, filePath);

  // --- 保活メモ ---
  const addNurseryHandler = async (draft: NurseryDraft) => {
    try {
      const created = await insertNursery(supabase, familyId, draft);
      setNurseries((prev) => [...prev, created]);
    } catch (err) {
      console.error('Failed to add nursery:', err);
      alert('保育園の追加に失敗しました。もう一度お試しください。');
    }
  };

  const updateNurseryHandler = async (nursery: Nursery, draft: NurseryDraft) => {
    const updated: Nursery = { ...nursery, ...draft };
    setNurseries((prev) => prev.map((n) => (n.id === nursery.id ? updated : n)));
    try {
      await updateNurseryApi(supabase, updated);
    } catch (err) {
      console.error('Failed to update nursery:', err);
      alert('保育園情報の更新に失敗しました。もう一度お試しください。');
    }
  };

  const deleteNurseryHandler = async (id: string) => {
    const previous = nurseries;
    setNurseries((prev) => prev.filter((n) => n.id !== id));
    try {
      await deleteNursery(supabase, id);
    } catch (err) {
      console.error('Failed to delete nursery:', err);
      setNurseries(previous);
      alert('保育園情報の削除に失敗しました。もう一度お試しください。');
    }
  };

  return (
    <div className="w-full max-w-md mx-auto h-dvh sm:h-[min(850px,calc(100dvh-4rem))] relative bg-gray-50 flex flex-col font-sans overflow-hidden shadow-2xl sm:rounded-3xl sm:my-8 border sm:border-gray-200">
      <header className="flex-none bg-white px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 flex flex-col items-center justify-center shadow-sm z-10 relative">
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
          <LogTab
            logs={logs}
            growthData={growthData}
            isLoadingLogs={isLoadingLogs}
            isLoadingGrowth={isLoadingGrowth}
            memberLabel={memberLabel}
            onAddLog={addLog}
            onUpdateLog={updateLog}
            onDeleteLog={deleteLog}
            onAddGrowthRecord={addGrowthRecordHandler}
            onUpdateGrowthRecord={updateGrowthRecordHandler}
            onDeleteGrowthRecord={deleteGrowthRecordHandler}
          />
        )}
        {activeTab === 'gift' && (
          <GiftTab
            gifts={gifts}
            isLoading={isLoadingGifts}
            onAddGift={addGift}
            onUpdateGift={updateGiftHandler}
            onDeleteGift={deleteGiftHandler}
          />
        )}
        {activeTab === 'info' && (
          <InfoTab
            userProfile={userProfile}
            tempProfile={tempProfile}
            isEditingProfile={isEditingProfile}
            onStartEditProfile={startEditingProfile}
            onChangeTempProfile={setTempProfile}
            onSaveProfile={handleProfileSave}
            documents={documents}
            isLoadingDocuments={isLoadingDocuments}
            onAddDocument={addDocument}
            onDeleteDocument={deleteDocumentHandler}
            getDocumentUrl={getDocumentUrl}
            nurseries={nurseries}
            isLoadingNurseries={isLoadingNurseries}
            onAddNursery={addNurseryHandler}
            onUpdateNursery={updateNurseryHandler}
            onDeleteNursery={deleteNurseryHandler}
          />
        )}
      </main>

      {activeTab === 'schedule' && (
        <button
          onClick={() => setShowAddModal(true)}
          className="absolute bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] right-4 w-14 h-14 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-blue-600 hover:scale-105 transition-all active:scale-95 z-20"
        >
          <Plus size={28} />
        </button>
      )}

      <nav className="flex-none bg-white border-t border-gray-200 w-full z-30 pb-[env(safe-area-inset-bottom)]">
        <div className="flex justify-around items-center h-16 px-1">
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
        </div>
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
