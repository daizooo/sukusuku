'use client';

import { useState } from 'react';
import { Baby, Camera, ClipboardList, Edit2, Folder, Image as ImageIcon, MapPin, Phone, Plus, Save, Settings, Trash2, User } from 'lucide-react';
import type { DocumentItem, Nursery, ProfileField, UserProfile } from '@/types/app';
import { isPhoneNumberLike, toTelHref } from '@/lib/uiUtils';

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

  const updateFamilyField = (id: string, patch: Partial<Pick<ProfileField, 'label' | 'value'>>) => {
    onChangeTempProfile({
      ...tempProfile,
      familyFields: tempProfile.familyFields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    });
  };

  const addFamilyField = () => {
    onChangeTempProfile({
      ...tempProfile,
      familyFields: [...tempProfile.familyFields, { id: crypto.randomUUID(), label: '', value: '' }],
    });
  };

  const removeFamilyField = (id: string) => {
    onChangeTempProfile({
      ...tempProfile,
      familyFields: tempProfile.familyFields.filter((field) => field.id !== id),
    });
  };

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
                <div className="space-y-3">
                  {tempProfile.familyFields.map((field) => (
                    <div key={field.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 relative">
                      <button
                        type="button"
                        onClick={() => removeFamilyField(field.id)}
                        aria-label="この項目を削除"
                        className="absolute top-2 right-2 text-gray-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition"
                      >
                        <Trash2 size={14} />
                      </button>
                      <div className="pr-7 space-y-2">
                        <div>
                          <label className="block text-[10px] font-medium text-gray-500 mb-1">見出し</label>
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) => updateFamilyField(field.id, { label: e.target.value })}
                            placeholder="例: ママの携帯番号"
                            className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-gray-500 mb-1">内容</label>
                          <input
                            type="text"
                            value={field.value}
                            onChange={(e) => updateFamilyField(field.id, { value: e.target.value })}
                            placeholder="例: 090-1234-5678"
                            className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addFamilyField}
                    className="w-full flex items-center justify-center text-sm text-blue-600 border border-blue-200 border-dashed rounded-lg py-2.5 hover:bg-blue-50 transition"
                  >
                    <Plus size={16} className="mr-1" /> 項目を追加
                  </button>
                </div>
              ) : (
                <div className="space-y-1 text-sm">
                  {userProfile.familyFields.length === 0 && <p className="text-gray-400 text-center py-2">項目がありません</p>}
                  {userProfile.familyFields.map((field) => (
                    <div key={field.id} className="flex justify-between items-center py-2 px-1 border-b border-gray-50 last:border-b-0">
                      <span className="text-gray-500">{field.label || '未設定の見出し'}</span>
                      {field.value && isPhoneNumberLike(field.value) ? (
                        <a href={toTelHref(field.value)} className="font-medium text-blue-600 flex items-center hover:underline">
                          <Phone size={12} className="mr-1" /> {field.value}
                        </a>
                      ) : (
                        <span className="font-medium text-gray-700">{field.value || '未設定'}</span>
                      )}
                    </div>
                  ))}
                </div>
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
