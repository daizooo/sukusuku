'use client';

import { useState } from 'react';
import { Baby, Camera, ClipboardList, Edit2, Folder, Image as ImageIcon, MapPin, Phone, Plus, Save, Settings, User } from 'lucide-react';
import type { DocumentItem, Nursery, UserProfile } from '@/types/app';

type InfoView = 'profile' | 'documents' | 'nursery';

interface InfoTabProps {
  userProfile: UserProfile;
  tempProfile: UserProfile;
  isEditingProfile: boolean;
  onStartEditProfile: () => void;
  onChangeTempProfile: (profile: UserProfile) => void;
  onSaveProfile: () => void;
  documents: DocumentItem[];
  nurseries: Nursery[];
}

export default function InfoTab({
  userProfile,
  tempProfile,
  isEditingProfile,
  onStartEditProfile,
  onChangeTempProfile,
  onSaveProfile,
  documents,
  nurseries,
}: InfoTabProps) {
  const [infoView, setInfoView] = useState<InfoView>('profile');
  const birthDate = userProfile.birthDate ? new Date(userProfile.birthDate) : null;

  return (
    <div className="p-4 h-full flex flex-col pb-24">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h2 className="text-xl font-bold text-gray-800 flex items-center">
          {infoView === 'profile' ? (
            <Settings className="mr-2" size={24} />
          ) : infoView === 'documents' ? (
            <Folder className="mr-2" size={24} />
          ) : (
            <ClipboardList className="mr-2" size={24} />
          )}
          {infoView === 'profile' ? '設定・プロフ' : infoView === 'documents' ? '書類箱' : '保活メモ'}
        </h2>
        {infoView === 'profile' && !isEditingProfile && (
          <button onClick={onStartEditProfile} className="text-blue-600 flex items-center text-sm font-medium bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">
            <Edit2 size={16} className="mr-1" /> 編集
          </button>
        )}
        {infoView === 'profile' && isEditingProfile && (
          <button onClick={onSaveProfile} className="text-white flex items-center text-sm font-medium bg-blue-500 px-4 py-1.5 rounded-lg shadow-sm hover:bg-blue-600">
            <Save size={16} className="mr-1" /> 保存
          </button>
        )}
        {(infoView === 'documents' || infoView === 'nursery') && (
          <button className="text-blue-500 bg-blue-50 p-2 rounded-full hover:bg-blue-100 transition">
            <Plus size={20} />
          </button>
        )}
      </div>

      <div className="flex bg-gray-200 p-1 rounded-lg mb-4 shrink-0">
        <button onClick={() => setInfoView('profile')} className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center transition ${infoView === 'profile' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
          設定
        </button>
        <button onClick={() => setInfoView('documents')} className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center transition ${infoView === 'documents' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
          書類箱
        </button>
        <button onClick={() => setInfoView('nursery')} className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center transition ${infoView === 'nursery' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
          保活メモ
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {infoView === 'profile' && (
          <div className="space-y-6">
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

            <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
                <Phone size={18} className="mr-2 text-blue-500" /> 緊急連絡先
              </h3>
              {isEditingProfile ? (
                <div className="space-y-4">
                  <div className="p-3 bg-rose-50 rounded-lg space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-rose-700 mb-1">産院名</label>
                      <input
                        type="text"
                        value={tempProfile.hospitalName}
                        onChange={(e) => onChangeTempProfile({ ...tempProfile, hospitalName: e.target.value })}
                        className="w-full border border-rose-200 rounded p-1.5 text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-rose-700 mb-1">産院 電話番号</label>
                      <input
                        type="tel"
                        value={tempProfile.hospitalPhone}
                        onChange={(e) => onChangeTempProfile({ ...tempProfile, hospitalPhone: e.target.value })}
                        className="w-full border border-rose-200 rounded p-1.5 text-sm outline-none"
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-sky-50 rounded-lg space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-sky-700 mb-1">小児科名</label>
                      <input
                        type="text"
                        value={tempProfile.pediatricName}
                        onChange={(e) => onChangeTempProfile({ ...tempProfile, pediatricName: e.target.value })}
                        className="w-full border border-sky-200 rounded p-1.5 text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-sky-700 mb-1">小児科 電話番号</label>
                      <input
                        type="tel"
                        value={tempProfile.pediatricPhone}
                        onChange={(e) => onChangeTempProfile({ ...tempProfile, pediatricPhone: e.target.value })}
                        className="w-full border border-sky-200 rounded p-1.5 text-sm outline-none"
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-blue-700 mb-1">パパ会社 電話番号</label>
                      <input
                        type="tel"
                        value={tempProfile.papaCompanyPhone}
                        onChange={(e) => onChangeTempProfile({ ...tempProfile, papaCompanyPhone: e.target.value })}
                        className="w-full border border-blue-200 rounded p-1.5 text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-blue-700 mb-1">パパ連絡先（携帯）</label>
                      <input
                        type="tel"
                        value={tempProfile.papaContactPhone}
                        onChange={(e) => onChangeTempProfile({ ...tempProfile, papaContactPhone: e.target.value })}
                        className="w-full border border-blue-200 rounded p-1.5 text-sm outline-none"
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-pink-50 rounded-lg space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-pink-700 mb-1">ママ会社 電話番号</label>
                      <input
                        type="tel"
                        value={tempProfile.mamaCompanyPhone}
                        onChange={(e) => onChangeTempProfile({ ...tempProfile, mamaCompanyPhone: e.target.value })}
                        className="w-full border border-pink-200 rounded p-1.5 text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-pink-700 mb-1">ママ連絡先（携帯）</label>
                      <input
                        type="tel"
                        value={tempProfile.mamaContactPhone}
                        onChange={(e) => onChangeTempProfile({ ...tempProfile, mamaContactPhone: e.target.value })}
                        className="w-full border border-pink-200 rounded p-1.5 text-sm outline-none"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <ul className="space-y-3 text-sm text-gray-700">
                  <li className="flex justify-between items-center py-1">
                    <span className="text-gray-500">産院</span>
                    <span className="font-medium">
                      {userProfile.hospitalName || '未設定'}
                      {userProfile.hospitalPhone && <span className="text-gray-400 ml-1">({userProfile.hospitalPhone})</span>}
                    </span>
                  </li>
                  <li className="flex justify-between items-center py-1">
                    <span className="text-gray-500">小児科</span>
                    <span className="font-medium">
                      {userProfile.pediatricName || '未設定'}
                      {userProfile.pediatricPhone && <span className="text-gray-400 ml-1">({userProfile.pediatricPhone})</span>}
                    </span>
                  </li>
                  <li className="flex justify-between items-center py-1">
                    <span className="text-gray-500">パパ会社</span>
                    <span className="font-medium">{userProfile.papaCompanyPhone || '未設定'}</span>
                  </li>
                  <li className="flex justify-between items-center py-1">
                    <span className="text-gray-500">パパ連絡先</span>
                    <span className="font-medium">{userProfile.papaContactPhone || '未設定'}</span>
                  </li>
                  <li className="flex justify-between items-center py-1">
                    <span className="text-gray-500">ママ会社</span>
                    <span className="font-medium">{userProfile.mamaCompanyPhone || '未設定'}</span>
                  </li>
                  <li className="flex justify-between items-center py-1">
                    <span className="text-gray-500">ママ連絡先</span>
                    <span className="font-medium">{userProfile.mamaContactPhone || '未設定'}</span>
                  </li>
                </ul>
              )}
            </section>
          </div>
        )}

        {infoView === 'documents' && (
          <div className="space-y-4">
            <button className="w-full bg-blue-50 text-blue-600 border border-blue-200 border-dashed rounded-xl py-5 flex flex-col items-center justify-center hover:bg-blue-100 transition shadow-sm">
              <Camera size={28} className="mb-2" />
              <span className="text-sm font-bold">カメラで書類を追加</span>
              <span className="text-xs text-blue-400 mt-1">健診案内や控えを保存</span>
            </button>
            <div className="grid grid-cols-2 gap-3">
              {documents.map((doc) => (
                <div key={doc.id} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition cursor-pointer">
                  <div className="w-full h-28 bg-gray-100 rounded-lg flex items-center justify-center mb-2 text-gray-400 border border-gray-200">
                    <ImageIcon size={32} />
                  </div>
                  <p className="font-bold text-gray-800 text-xs leading-tight mb-1 line-clamp-2">{doc.title}</p>
                  <p className="text-[10px] text-gray-400">{doc.date}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {infoView === 'nursery' && (
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl text-xs text-orange-800 mb-4 leading-relaxed">
              候補の保育園情報や、見学時のメモを夫婦で共有しましょう。見学時のチェックポイントなども残せます。
            </div>
            {nurseries.map((nursery) => (
              <div key={nursery.id} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-bold text-gray-800 text-sm">{nursery.name}</h3>
                  <span
                    className={`text-[10px] font-bold px-2 py-1 rounded-md whitespace-nowrap ml-2 ${
                      nursery.status === '見学済' ? 'bg-green-100 text-green-700' : nursery.status === '未見学' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {nursery.status}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <p className="flex items-center text-gray-600">
                    <MapPin size={12} className="mr-1" /> {nursery.distance}
                  </p>
                  <p className="flex items-center text-blue-500">
                    <Phone size={12} className="mr-1" /> <a href={`tel:${nursery.phone}`}>{nursery.phone}</a>
                  </p>
                  <div className="mt-3 bg-gray-50 p-3 rounded-lg text-gray-700 border border-gray-100">
                    <strong className="block text-[10px] text-gray-400 mb-1">メモ</strong>
                    {nursery.memo}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
