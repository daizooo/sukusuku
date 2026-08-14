'use client';

import { Baby, Edit2, ListPlus, Phone, Save, Settings, Trash2, User } from 'lucide-react';
import type { ProfileField, UserProfile } from '@/types/app';
import { isPhoneNumberLike, toTelHref } from '@/lib/uiUtils';

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

  const updateCustomField = (id: string, patch: Partial<Pick<ProfileField, 'label' | 'value'>>) => {
    onChangeTempProfile({
      ...tempProfile,
      customFields: tempProfile.customFields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    });
  };

  const addCustomField = () => {
    onChangeTempProfile({
      ...tempProfile,
      customFields: [...tempProfile.customFields, { id: crypto.randomUUID(), label: '', value: '' }],
    });
  };

  const removeCustomField = (id: string) => {
    onChangeTempProfile({
      ...tempProfile,
      customFields: tempProfile.customFields.filter((field) => field.id !== id),
    });
  };

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
                    {userProfile.hospitalPhone && (
                      <span className="text-gray-400 ml-1">(<PhoneValue phone={userProfile.hospitalPhone} />)</span>
                    )}
                  </span>
                </li>
                <li className="flex justify-between items-center py-1">
                  <span className="text-gray-500">小児科</span>
                  <span className="font-medium">
                    {userProfile.pediatricName || '未設定'}
                    {userProfile.pediatricPhone && (
                      <span className="text-gray-400 ml-1">(<PhoneValue phone={userProfile.pediatricPhone} />)</span>
                    )}
                  </span>
                </li>
                <li className="flex justify-between items-center py-1">
                  <span className="text-gray-500">パパ会社</span>
                  <span className="font-medium"><PhoneValue phone={userProfile.papaCompanyPhone} /></span>
                </li>
                <li className="flex justify-between items-center py-1">
                  <span className="text-gray-500">パパ連絡先</span>
                  <span className="font-medium"><PhoneValue phone={userProfile.papaContactPhone} /></span>
                </li>
                <li className="flex justify-between items-center py-1">
                  <span className="text-gray-500">ママ会社</span>
                  <span className="font-medium"><PhoneValue phone={userProfile.mamaCompanyPhone} /></span>
                </li>
                <li className="flex justify-between items-center py-1">
                  <span className="text-gray-500">ママ連絡先</span>
                  <span className="font-medium"><PhoneValue phone={userProfile.mamaContactPhone} /></span>
                </li>
              </ul>
            )}
          </section>

          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
              <ListPlus size={18} className="mr-2 text-blue-500" /> カスタム項目
            </h3>
            {isEditingProfile ? (
              <div className="space-y-3">
                {tempProfile.customFields.map((field) => (
                  <div key={field.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 relative">
                    <button
                      type="button"
                      onClick={() => removeCustomField(field.id)}
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
                          onChange={(e) => updateCustomField(field.id, { label: e.target.value })}
                          placeholder="例: ママの携帯番号"
                          className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-1">内容</label>
                        <input
                          type="text"
                          value={field.value}
                          onChange={(e) => updateCustomField(field.id, { value: e.target.value })}
                          placeholder="例: 090-1234-5678"
                          className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCustomField}
                  className="w-full flex items-center justify-center text-sm text-blue-600 border border-blue-200 border-dashed rounded-lg py-2.5 hover:bg-blue-50 transition"
                >
                  <ListPlus size={16} className="mr-1" /> 項目を追加
                </button>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                {userProfile.customFields.length === 0 && <p className="text-gray-400 text-center py-2">項目がありません</p>}
                {userProfile.customFields.map((field) => (
                  <div key={field.id} className="flex justify-between items-center py-2 px-1 border-b border-gray-50 last:border-b-0">
                    <span className="text-gray-500">{field.label || '未設定の見出し'}</span>
                    <span className="font-medium text-gray-700">
                      {field.value ? <PhoneValue phone={field.value} /> : '未設定'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// 電話番号らしい文字列であればtel:リンクとして表示する。そうでなければ通常のテキストとして表示する。
function PhoneValue({ phone }: { phone: string }) {
  if (!phone) return <>未設定</>;
  if (!isPhoneNumberLike(phone)) return <>{phone}</>;
  return (
    <a href={toTelHref(phone)} className="text-blue-600 hover:underline">
      {phone}
    </a>
  );
}
