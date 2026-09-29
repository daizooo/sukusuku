'use client';

import { Baby, Building2, Heart, Phone, Stethoscope } from 'lucide-react';
import type { LoginRole, UserProfile } from '@/types/app';
import { getProfileFieldValue } from '@/lib/uiUtils';
import { parseDateString } from '@/lib/dateUtils';
import type { NextFeedingInfo } from '@/lib/feedingSchedule';
import NextFeedingCard from '../NextFeedingCard';

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
  /** 次の授乳の目安。 */
  nextFeeding: NextFeedingInfo;
  /** 記録タブへ移る（次の授乳のカードから）。 */
  onOpenLogTab: () => void;
}

export default function HomeTab({
  userProfile,
  loginRole,
  ageInDays,
  ageInMonths,
  nextFeeding,
  onOpenLogTab,
}: HomeTabProps) {
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
              {ageInDays < 0 ? (
                <>
                  <span className="text-sm font-medium">誕生まで あと</span>
                  <span className="text-6xl font-bold tracking-tight">{Math.abs(ageInDays)}</span>
                  <span className="text-xl font-medium">日</span>
                </>
              ) : ageInMonths.months > 0 ? (
                // 1ヶ月を過ぎたら「◯ヶ月◯日」のほうが月齢の目安として通じるため、
                // こちらを主表示にして、通算の日数は補足に回す。
                <>
                  <span className="text-sm font-medium">生後</span>
                  <span className="text-5xl font-bold tracking-tight">{ageInMonths.months}</span>
                  <span className="text-xl font-medium">ヶ月</span>
                  <span className="text-5xl font-bold tracking-tight">{ageInMonths.days}</span>
                  <span className="text-xl font-medium">日</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">生後</span>
                  <span className="text-6xl font-bold tracking-tight">{ageInDays}</span>
                  <span className="text-xl font-medium">日目</span>
                </>
              )}
            </div>
            {ageInDays >= 0 && ageInMonths.months > 0 && (
              <span className="text-sm font-medium opacity-90 mt-1">( 生後 {ageInDays}日目 )</span>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs bg-black/10 inline-block px-3 py-1.5 rounded-full backdrop-blur-md shadow-sm border border-white/20">
              お誕生日: {birthDate ? `${birthDate.getFullYear()}年${birthDate.getMonth() + 1}月${birthDate.getDate()}日` : '未設定'}
            </p>
          </div>
        </div>
      </div>

      {/* 「次の授乳っていつだっけ」が夫婦のどちらにも起きるので、
          ホームを開いた時点で目に入る位置に置く。タップで記録タブへ移る。 */}
      <div className="flex-none">
        <NextFeedingCard info={nextFeeding} onOpen={onOpenLogTab} />
      </div>

      <div className="grid grid-cols-4 gap-3 flex-none">
        {quickActions.map((item) =>
          item.phone ? (
            <a
              key={item.label}
              href={`tel:${item.phone}`}
              className="flex flex-col items-center justify-center px-1 py-3 bg-white rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition"
            >
              <div className={`p-3 rounded-full ${item.color} mb-2`}>
                <item.icon size={20} />
              </div>
              <span className="text-xs text-gray-700 font-medium whitespace-nowrap">{item.label}</span>
            </a>
          ) : (
            <button
              key={item.label}
              onClick={() => alert(`${item.label}の電話番号が未設定です。設定画面から登録してください。`)}
              className="flex flex-col items-center justify-center px-1 py-3 bg-white rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition"
            >
              <div className={`p-3 rounded-full ${item.color} mb-2 opacity-60`}>
                <item.icon size={20} />
              </div>
              <span className="text-xs text-gray-400 font-medium whitespace-nowrap">{item.label}</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
