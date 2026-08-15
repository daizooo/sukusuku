'use client';

import { AlertTriangle, Baby, Building2, Calendar, ChevronRight, CheckCircle2, Circle, Clock, Heart, MapPin, Phone, Stethoscope, BellRing } from 'lucide-react';
import type { DynamicTask, LoginRole, ScheduleView, UserProfile } from '@/types/app';
import { getLabelColor, getProfileFieldValue } from '@/lib/uiUtils';
import { formatTimeRange, parseDateString, startOfDay } from '@/lib/dateUtils';
import { formatRelativeDay } from '../schedule/utils';

interface QuickAction {
  icon: typeof Phone;
  label: string;
  phone: string;
  color: string;
}

interface HomeTabProps {
  userProfile: UserProfile;
  loginRole?: LoginRole;
  ageInDays: number;
  ageInMonths: { months: number; days: number };
  dynamicTodos: DynamicTask[];
  isLoadingTodos?: boolean;
  today: Date;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
  /** スケジュールタブへ移る。表示を指定すると、その表示で開く。 */
  onViewAllSchedule: (view?: ScheduleView) => void;
}

export default function HomeTab({
  userProfile,
  loginRole,
  ageInDays,
  ageInMonths,
  dynamicTodos,
  isLoadingTodos,
  today,
  onToggleTodo,
  onOpenTask,
  onViewAllSchedule,
}: HomeTabProps) {
  const startOfToday = startOfDay(today).getTime();
  const pendingTasks = dynamicTodos.filter((t) => !t.done);

  // 期限切れは古いものほど先頭に来るため、そのまま並べると直近の3件を
  // 食いつぶしてしまう。件数だけ知らせて、中身はスケジュールのリスト表示に任せる。
  const overdueCount = pendingTasks.filter(
    (t) => t.targetDateObj && startOfDay(t.targetDateObj).getTime() < startOfToday,
  ).length;

  // 今日以降の予定を近い順に3件。日付未設定は後ろに回す。
  const upcomingTasks = pendingTasks
    .filter((t) => !t.targetDateObj || startOfDay(t.targetDateObj).getTime() >= startOfToday)
    .sort((a, b) => (a.targetDateObj?.getTime() ?? Infinity) - (b.targetDateObj?.getTime() ?? Infinity))
    .slice(0, 3);
  const birthDateValue = getProfileFieldValue(userProfile, 'birthDate');
  const birthDate = parseDateString(birthDateValue);
  const babyName = getProfileFieldValue(userProfile, 'babyName');

  // ママがログイン中(または役割未設定)はパパの連絡先を、パパがログイン中はママの連絡先を表示する
  const showPapaContact = loginRole !== 'papa';
  const partnerCompanyLabel = showPapaContact ? 'パパ会社' : 'ママ会社';
  const partnerCompanyPhone = getProfileFieldValue(userProfile, showPapaContact ? 'papaCompanyPhone' : 'mamaCompanyPhone');
  const partnerContactLabel = showPapaContact ? 'パパ連絡' : 'ママ連絡';
  const partnerContactPhone = getProfileFieldValue(userProfile, showPapaContact ? 'papaContactPhone' : 'mamaContactPhone');

  const quickActions: QuickAction[] = [
    { icon: Phone, label: '産院', phone: getProfileFieldValue(userProfile, 'hospitalPhone'), color: 'bg-rose-100 text-rose-600' },
    { icon: Stethoscope, label: '小児科', phone: getProfileFieldValue(userProfile, 'pediatricPhone'), color: 'bg-blue-100 text-blue-600' },
    { icon: Building2, label: partnerCompanyLabel, phone: partnerCompanyPhone, color: 'bg-green-100 text-green-600' },
    { icon: Heart, label: partnerContactLabel, phone: partnerContactPhone, color: 'bg-purple-100 text-purple-600' },
  ];

  return (
    <div className="p-4 h-full flex flex-col space-y-4 md:max-w-2xl lg:max-w-3xl md:mx-auto">
      <div className="flex-none bg-gradient-to-br from-blue-500 via-blue-400 to-teal-300 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white opacity-10 rounded-full blur-2xl -mr-10 -mt-10" />
        <Baby className="absolute -right-2 -bottom-2 w-32 h-32 text-white opacity-20 drop-shadow-md" />
        <div className="relative z-10">
          <h2 className="text-sm font-medium opacity-90 mb-1 flex items-center">
            <Heart size={14} className="mr-1 fill-white" />
            {babyName ? `${babyName}が生まれてから` : '赤ちゃんが生まれてから'}
          </h2>
          <div className="flex flex-col mt-2">
            <div className="flex items-baseline space-x-1">
              {ageInDays >= 0 ? (
                <>
                  <span className="text-sm font-medium">生後</span>
                  <span className="text-6xl font-bold tracking-tight">{ageInDays}</span>
                  <span className="text-xl font-medium">日目</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">誕生まで あと</span>
                  <span className="text-6xl font-bold tracking-tight">{Math.abs(ageInDays)}</span>
                  <span className="text-xl font-medium">日</span>
                </>
              )}
            </div>
            {ageInMonths.months > 0 && (
              <span className="text-sm font-medium opacity-90 mt-1">
                ( {ageInMonths.months}ヶ月 と {ageInMonths.days}日 )
              </span>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs bg-black/10 inline-block px-3 py-1.5 rounded-full backdrop-blur-md shadow-sm border border-white/20">
              お誕生日: {birthDate ? `${birthDate.getFullYear()}年${birthDate.getMonth() + 1}月${birthDate.getDate()}日` : '未設定'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 flex-none">
        {quickActions.map((item) =>
          item.phone ? (
            <a
              key={item.label}
              href={`tel:${item.phone}`}
              className="flex flex-col items-center justify-center p-3 bg-white rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition"
            >
              <div className={`p-3 rounded-full ${item.color} mb-2`}>
                <item.icon size={20} />
              </div>
              <span className="text-[11px] text-gray-600 font-medium">{item.label}</span>
            </a>
          ) : (
            <button
              key={item.label}
              onClick={() => alert(`${item.label}の電話番号が未設定です。設定画面から登録してください。`)}
              className="flex flex-col items-center justify-center p-3 bg-white rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition"
            >
              <div className={`p-3 rounded-full ${item.color} mb-2 opacity-60`}>
                <item.icon size={20} />
              </div>
              <span className="text-[11px] text-gray-400 font-medium">{item.label}</span>
            </button>
          )
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex justify-between items-end mb-3 flex-none">
          <h3 className="text-gray-800 font-bold text-lg">直近のスケジュール</h3>
          <button onClick={() => onViewAllSchedule()} className="text-blue-500 text-sm font-medium flex items-center">
            すべて見る <ChevronRight size={16} />
          </button>
        </div>

        {overdueCount > 0 && (
          <button
            onClick={() => onViewAllSchedule('list')}
            className="flex-none w-full mb-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100 text-red-700 flex items-center justify-between hover:bg-red-100 transition"
          >
            <span className="flex items-center text-sm font-medium">
              <AlertTriangle size={14} className="mr-1.5" />
              期限切れ {overdueCount}件
            </span>
            <ChevronRight size={16} />
          </button>
        )}

        <div className="min-h-0 overflow-y-auto bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
          {isLoadingTodos && <p className="p-4 text-sm text-gray-400 text-center">読み込み中...</p>}
          {!isLoadingTodos && upcomingTasks.length === 0 && (
            <p className="p-4 text-sm text-gray-400 text-center">直近の予定はありません</p>
          )}
          {upcomingTasks.map((task) => (
            <div
              key={task.id}
              className="p-4 flex items-start space-x-3 cursor-pointer hover:bg-gray-50 transition"
              onClick={() => onOpenTask(task)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTodo(task.id);
                }}
                className={`mt-0.5 flex-shrink-0 transition-colors p-1 -ml-1 ${task.done ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}
              >
                {task.done ? <CheckCircle2 size={24} /> : <Circle size={24} />}
              </button>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <p className={`font-medium ${task.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {task.title}
                    {task.remindMinutesBefore !== null && !task.done && (
                      <BellRing size={12} className="inline ml-1.5 text-yellow-500 mb-0.5" />
                    )}
                  </p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ml-2 ${getLabelColor(task.label)}`}>
                    {task.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center text-xs text-gray-500 mt-1 gap-x-3 gap-y-1">
                  <span className="flex items-center text-blue-600 font-medium">
                    <Calendar size={12} className="mr-1" />
                    {task.targetDate}
                    {/* 何日後かはスケジュールのリスト表示と同じ表記に揃える。 */}
                    {task.targetDateObj && (
                      <span className="ml-1.5 text-gray-500 font-normal">
                        {formatRelativeDay(task.targetDateObj, today)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center">
                    <Clock size={12} className="mr-1" />
                    {formatTimeRange(task.startTime, task.endTime)}
                  </span>
                  {task.place && (
                    <span className="flex items-center truncate">
                      <MapPin size={12} className="mr-1 flex-none" />
                      <span className="truncate">{task.place}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
