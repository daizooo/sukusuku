'use client';

import { Baby, Edit2, Save, Settings, User } from 'lucide-react';
import type { UserProfile } from '@/types/app';

interface InfoTabProps {
  userProfile: UserProfile;
  tempProfile: UserProfile;
  isEditingProfile: boolean;
  onStartEditProfile: () => void;
  onChangeTempProfile: (profile: UserProfile) => void;
  onSaveProfile: () => void;
}

export default function InfoTab({
  userProfile,
  tempProfile,
  isEditingProfile,
  onStartEditProfile,
  onChangeTempProfile,
  onSaveProfile,
}: InfoTabProps) {
  const birthDate = userProfile.birthDate ? new Date(userProfile.birthDate) : null;

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h2 className="text-xl font-bold text-gray-800 flex items-center">
          <Settings className="mr-2" size={24} />
          設定・プロフ
        </h2>
        {!isEditingProfile ? (
          <button onClick={onStartEditProfile} className="text-blue-600 flex items-center text-sm font-medium bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">
            <Edit2 size={16} className="mr-1" /> 編集
          </button>
        ) : (
          <button onClick={onSaveProfile} className="text-white flex items-center text-sm font-medium bg-blue-500 px-4 py-1.5 rounded-lg shadow-sm hover:bg-blue-600">
            <Save size={16} className="mr-1" /> 保存
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 pb-6">
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
              <Baby size={18} className="mr-2 text-blue-500" /> お子様の情報
            </h3>
            {isEditingProfile ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">お名前</label>
                  <input
                    type="text"
                    value={tempProfile.babyName}
                    onChange={(e) => onChangeTempProfile({ ...tempProfile, babyName: e.target.value })}
                    className="w-full border rounded-lg p-2 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">お誕生日</label>
                  <input
                    type="date"
                    value={tempProfile.birthDate}
                    onChange={(e) => onChangeTempProfile({ ...tempProfile, birthDate: e.target.value })}
                    className="w-full border rounded-lg p-2 text-sm outline-none"
                  />
                </div>
              </div>
            ) : (
              <ul className="space-y-3 text-sm text-gray-700">
                <li className="flex justify-between items-center py-1">
                  <span className="text-gray-500">お名前</span>
                  <span className="font-medium">{userProfile.babyName || '未設定'}</span>
                </li>
                <li className="flex justify-between items-center py-1">
                  <span className="text-gray-500">お誕生日</span>
                  <span className="font-medium">{birthDate ? birthDate.toLocaleDateString('ja-JP') : '未設定'}</span>
                </li>
              </ul>
            )}
          </section>

          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
              <User size={18} className="mr-2 text-blue-500" /> パパ・ママ情報
            </h3>
            {isEditingProfile ? (
              <div className="space-y-4">
                <div className="p-3 bg-pink-50 rounded-lg space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-pink-700 mb-1">ママのお名前</label>
                    <input
                      type="text"
                      value={tempProfile.momName}
                      onChange={(e) => onChangeTempProfile({ ...tempProfile, momName: e.target.value })}
                      className="w-full border border-pink-200 rounded p-1.5 text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-pink-700 mb-1">ママの勤務先</label>
                    <input
                      type="text"
                      value={tempProfile.momWorkplace}
                      onChange={(e) => onChangeTempProfile({ ...tempProfile, momWorkplace: e.target.value })}
                      className="w-full border border-pink-200 rounded p-1.5 text-sm outline-none"
                    />
                  </div>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-blue-700 mb-1">パパのお名前</label>
                    <input
                      type="text"
                      value={tempProfile.dadName}
                      onChange={(e) => onChangeTempProfile({ ...tempProfile, dadName: e.target.value })}
                      className="w-full border border-blue-200 rounded p-1.5 text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-blue-700 mb-1">パパの勤務先</label>
                    <input
                      type="text"
                      value={tempProfile.dadWorkplace}
                      onChange={(e) => onChangeTempProfile({ ...tempProfile, dadWorkplace: e.target.value })}
                      className="w-full border border-blue-200 rounded p-1.5 text-sm outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">ご住所</label>
                  <input
                    type="text"
                    value={tempProfile.address}
                    onChange={(e) => onChangeTempProfile({ ...tempProfile, address: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="bg-pink-50 p-3 rounded-lg text-pink-800">
                  <strong className="block mb-1 border-b border-pink-200 pb-1">ママ {userProfile.momName && `(${userProfile.momName})`}</strong>
                  <div className="flex justify-between mt-2">
                    <span className="text-pink-600/80">勤務先</span>
                    <span>{userProfile.momWorkplace || '未設定'}</span>
                  </div>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg text-blue-800">
                  <strong className="block mb-1 border-b border-blue-200 pb-1">パパ {userProfile.dadName && `(${userProfile.dadName})`}</strong>
                  <div className="flex justify-between mt-2">
                    <span className="text-blue-600/80">勤務先</span>
                    <span>{userProfile.dadWorkplace || '未設定'}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center py-2 px-1 border-b border-gray-50">
                  <span className="text-gray-500">ご住所</span>
                  <span className="font-medium text-gray-700">{userProfile.address || '未設定'}</span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
