'use client';

import type { ReactNode } from 'react';
import { Baby, Edit2, ListPlus, Phone, Save, Settings, Trash2, User } from 'lucide-react';
import type { ProfileField, UserProfile } from '@/types/app';
import { isPhoneNumberLike, toTelHref } from '@/lib/uiUtils';

// UserProfileのうち、ProfileField[]を値に持つキー（＝設定タブで編集可能なセクション）
type ProfileSectionKey = {
  [K in keyof UserProfile]: UserProfile[K] extends ProfileField[] ? K : never;
}[keyof UserProfile];

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
  const updateField = (section: ProfileSectionKey, id: string, patch: Partial<Pick<ProfileField, 'label' | 'value'>>) => {
    onChangeTempProfile({
      ...tempProfile,
      [section]: tempProfile[section].map((field) => (field.id === id ? { ...field, ...patch } : field)),
    });
  };

  const addField = (section: ProfileSectionKey) => {
    onChangeTempProfile({
      ...tempProfile,
      [section]: [...tempProfile[section], { id: crypto.randomUUID(), label: '', value: '' }],
    });
  };

  const removeField = (section: ProfileSectionKey, id: string) => {
    onChangeTempProfile({
      ...tempProfile,
      [section]: tempProfile[section].filter((field) => field.id !== id),
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
          <FieldSection
            title="お子様の情報"
            icon={<Baby size={18} className="mr-2 text-blue-500" />}
            fields={isEditingProfile ? tempProfile.childFields : userProfile.childFields}
            isEditing={isEditingProfile}
            onChangeField={(id, patch) => updateField('childFields', id, patch)}
            onRemoveField={(id) => removeField('childFields', id)}
            onAddField={() => addField('childFields')}
          />

          <FieldSection
            title="パパ・ママ情報"
            icon={<User size={18} className="mr-2 text-blue-500" />}
            fields={isEditingProfile ? tempProfile.familyFields : userProfile.familyFields}
            isEditing={isEditingProfile}
            onChangeField={(id, patch) => updateField('familyFields', id, patch)}
            onRemoveField={(id) => removeField('familyFields', id)}
            onAddField={() => addField('familyFields')}
          />

          <FieldSection
            title="緊急連絡先"
            icon={<Phone size={18} className="mr-2 text-blue-500" />}
            fields={isEditingProfile ? tempProfile.emergencyFields : userProfile.emergencyFields}
            isEditing={isEditingProfile}
            onChangeField={(id, patch) => updateField('emergencyFields', id, patch)}
            onRemoveField={(id) => removeField('emergencyFields', id)}
            onAddField={() => addField('emergencyFields')}
          />

          <FieldSection
            title="カスタム項目"
            icon={<ListPlus size={18} className="mr-2 text-blue-500" />}
            fields={isEditingProfile ? tempProfile.customFields : userProfile.customFields}
            isEditing={isEditingProfile}
            onChangeField={(id, patch) => updateField('customFields', id, patch)}
            onRemoveField={(id) => removeField('customFields', id)}
            onAddField={() => addField('customFields')}
          />
        </div>
      </div>
    </div>
  );
}

interface FieldSectionProps {
  title: string;
  icon: ReactNode;
  fields: ProfileField[];
  isEditing: boolean;
  onChangeField: (id: string, patch: Partial<Pick<ProfileField, 'label' | 'value'>>) => void;
  onRemoveField: (id: string) => void;
  onAddField: () => void;
}

// 設定タブの1セクション。各項目の見出し・内容を編集モードで自由に追加・削除できる。
function FieldSection({ title, icon, fields, isEditing, onChangeField, onRemoveField, onAddField }: FieldSectionProps) {
  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <h3 className="font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
        {icon} {title}
      </h3>
      {isEditing ? (
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 relative">
              <button
                type="button"
                onClick={() => onRemoveField(field.id)}
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
                    onChange={(e) => onChangeField(field.id, { label: e.target.value })}
                    placeholder="例: ママの携帯番号"
                    className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-1">内容</label>
                  <input
                    type={field.key === 'birthDate' ? 'date' : 'text'}
                    value={field.value}
                    onChange={(e) => onChangeField(field.id, { value: e.target.value })}
                    placeholder={field.key === 'birthDate' ? undefined : '例: 090-1234-5678'}
                    className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={onAddField}
            className="w-full flex items-center justify-center text-sm text-blue-600 border border-blue-200 border-dashed rounded-lg py-2.5 hover:bg-blue-50 transition"
          >
            <ListPlus size={16} className="mr-1" /> 項目を追加
          </button>
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          {fields.length === 0 && <p className="text-gray-400 text-center py-2">項目がありません</p>}
          {fields.map((field) => (
            <div key={field.id} className="flex justify-between items-center py-2 px-1 border-b border-gray-50 last:border-b-0">
              <span className="text-gray-500">{field.label || '未設定の見出し'}</span>
              <span className="font-medium text-gray-700">
                <FieldValue field={field} />
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// 項目の内容を表示する。お誕生日は日付表示に、電話番号らしい値はtel:リンクにしてタップで発信できるようにする。
function FieldValue({ field }: { field: ProfileField }) {
  if (!field.value) return <>未設定</>;
  if (field.key === 'birthDate') {
    const date = new Date(field.value);
    return <>{isNaN(date.getTime()) ? field.value : date.toLocaleDateString('ja-JP')}</>;
  }
  if (isPhoneNumberLike(field.value)) {
    return (
      <a href={toTelHref(field.value)} className="text-blue-600 hover:underline">
        {field.value}
      </a>
    );
  }
  return <>{field.value}</>;
}
