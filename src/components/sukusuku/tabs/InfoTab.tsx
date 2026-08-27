'use client';

import type { ReactNode } from 'react';
import { Baby, Edit2, ListPlus, Phone, Plus, Save, Trash2, User } from 'lucide-react';
import type { ProfileField, ProfileFieldKey, UserProfile } from '@/types/app';
import { isPhoneNumberLike, toTelHref } from '@/lib/uiUtils';
import NotificationSetting from '@/components/sukusuku/NotificationSetting';
import FeedingIntervalSetting from '@/components/sukusuku/FeedingIntervalSetting';
import TemperatureReminderSetting from '@/components/sukusuku/TemperatureReminderSetting';
import AccountSection from '@/components/sukusuku/AccountSection';
import type { FeedingSettings } from '@/lib/api/feedingSettings';
import type { TemperatureReminderSettings } from '@/lib/api/temperatureReminderSettings';

// UserProfileのうち、ProfileField[]を値に持つキー（＝設定タブで編集可能なセクション）
type ProfileSectionKey = {
  [K in keyof UserProfile]: UserProfile[K] extends ProfileField[] ? K : never;
}[keyof UserProfile];

interface InfoTabProps {
  familyId: string;
  userId: string;
  userProfile: UserProfile;
  tempProfile: UserProfile;
  isEditingProfile: boolean;
  onStartEditProfile: () => void;
  onChangeTempProfile: (profile: UserProfile) => void;
  onSaveProfile: () => void;
  /** 次の授乳の目安の設定。家族で共通なので、変更はアプリ全体へ反映する。 */
  feedingSettings: FeedingSettings;
  onChangeFeedingSettings: (settings: FeedingSettings) => void;
  /** 検温のお知らせの設定。こちらも家族で共通。 */
  temperatureReminderSettings: TemperatureReminderSettings;
  onChangeTemperatureReminderSettings: (settings: TemperatureReminderSettings) => void;
}

export default function InfoTab({
  familyId,
  userId,
  userProfile,
  tempProfile,
  isEditingProfile,
  onStartEditProfile,
  onChangeTempProfile,
  onSaveProfile,
  feedingSettings,
  onChangeFeedingSettings,
  temperatureReminderSettings,
  onChangeTemperatureReminderSettings,
}: InfoTabProps) {
  const updateField = (section: ProfileSectionKey, id: string, patch: Partial<Pick<ProfileField, 'label' | 'values'>>) => {
    onChangeTempProfile({
      ...tempProfile,
      [section]: tempProfile[section].map((field) => (field.id === id ? { ...field, ...patch } : field)),
    });
  };

  const addField = (section: ProfileSectionKey) => {
    onChangeTempProfile({
      ...tempProfile,
      [section]: [...tempProfile[section], { id: crypto.randomUUID(), label: '', values: [''] }],
    });
  };

  const removeField = (section: ProfileSectionKey, id: string) => {
    onChangeTempProfile({
      ...tempProfile,
      [section]: tempProfile[section].filter((field) => field.id !== id),
    });
  };

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      {/* 見出しは出さず、編集・保存だけを右端に置く。 */}
      <div className="flex items-center justify-end mb-3 shrink-0">
        {!isEditingProfile ? (
          <button onClick={onStartEditProfile} className="flex-none text-blue-600 flex items-center text-sm font-bold bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100">
            <Edit2 size={16} className="mr-1" /> 編集
          </button>
        ) : (
          <button onClick={onSaveProfile} className="flex-none text-white flex items-center text-sm font-bold bg-blue-500 px-4 py-2 rounded-lg shadow-sm hover:bg-blue-600">
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

          <NotificationSetting familyId={familyId} userId={userId} />

          <FeedingIntervalSetting
            familyId={familyId}
            settings={feedingSettings}
            onChange={onChangeFeedingSettings}
          />

          <TemperatureReminderSetting
            familyId={familyId}
            settings={temperatureReminderSettings}
            onChange={onChangeTemperatureReminderSettings}
          />

          <AccountSection familyId={familyId} userId={userId} />
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
  onChangeField: (id: string, patch: Partial<Pick<ProfileField, 'label' | 'values'>>) => void;
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
            <FieldEditor
              key={field.id}
              field={field}
              onChangeField={onChangeField}
              onRemoveField={onRemoveField}
            />
          ))}
          <button
            type="button"
            onClick={onAddField}
            className="w-full flex items-center justify-center text-sm text-blue-600 border border-blue-200 border-dashed rounded-lg py-2.5 hover:bg-blue-50 transition"
          >
            <ListPlus size={16} className="mr-1" /> 見出しを追加
          </button>
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          {fields.length === 0 && <p className="text-gray-400 text-center py-2">項目がありません</p>}
          {fields.map((field) => {
            const filledValues = field.values.filter((value) => value.trim() !== '');
            return (
              <div key={field.id} className="flex justify-between items-start gap-3 py-2 px-1 border-b border-gray-50 last:border-b-0">
                <span className="text-gray-500 flex-none">{field.label || '未設定の見出し'}</span>
                <div className="font-medium text-gray-700 text-right min-w-0 break-words space-y-0.5">
                  {filledValues.length === 0 ? (
                    <span>未設定</span>
                  ) : (
                    filledValues.map((value, index) => (
                      <div key={index}>
                        <FieldValue fieldKey={field.key} value={value} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface FieldEditorProps {
  field: ProfileField;
  onChangeField: (id: string, patch: Partial<Pick<ProfileField, 'label' | 'values'>>) => void;
  onRemoveField: (id: string) => void;
}

// 1つの見出しの編集カード。見出しの下に内容を何件でも並べられる。
// ただしkeyを持つ項目（お誕生日や産院の電話番号など、他の画面がその値を参照する項目）は
// 内容が1件であることを前提にしているため、内容の追加・削除はできないようにしている。
function FieldEditor({ field, onChangeField, onRemoveField }: FieldEditorProps) {
  const allowsMultipleValues = !field.key;
  // 旧データの読み込みなどで内容が空になっていても、入力欄は必ず1つ描く。
  const values = field.values.length > 0 ? field.values : [''];

  const changeValue = (index: number, value: string) => {
    onChangeField(field.id, { values: values.map((current, i) => (i === index ? value : current)) });
  };

  const addValue = () => {
    onChangeField(field.id, { values: [...values, ''] });
  };

  const removeValue = (index: number) => {
    onChangeField(field.id, { values: values.filter((_, i) => i !== index) });
  };

  return (
    <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 relative">
      <button
        type="button"
        onClick={() => onRemoveField(field.id)}
        aria-label="この見出しを削除"
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
          <div className="space-y-1.5">
            {values.map((value, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input
                  type={field.key === 'birthDate' ? 'date' : 'text'}
                  value={value}
                  onChange={(e) => changeValue(index, e.target.value)}
                  placeholder={field.key === 'birthDate' ? undefined : '例: 090-1234-5678'}
                  className="flex-1 min-w-0 border border-gray-300 rounded p-1.5 text-sm outline-none"
                />
                {allowsMultipleValues && values.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeValue(index)}
                    aria-label="この内容を削除"
                    className="flex-none text-gray-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {allowsMultipleValues && (
            <button
              type="button"
              onClick={addValue}
              className="mt-1.5 flex items-center text-xs text-blue-600 hover:underline"
            >
              <Plus size={14} className="mr-0.5" /> 内容を追加
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 項目の内容を表示する。お誕生日は日付表示に、電話番号らしい値はtel:リンクにしてタップで発信できるようにする。
function FieldValue({ fieldKey, value }: { fieldKey?: ProfileFieldKey; value: string }) {
  if (!value) return <>未設定</>;
  if (fieldKey === 'birthDate') {
    const date = new Date(value);
    return <>{isNaN(date.getTime()) ? value : date.toLocaleDateString('ja-JP')}</>;
  }
  if (isPhoneNumberLike(value)) {
    return (
      <a href={toTelHref(value)} className="text-blue-600 hover:underline">
        {value}
      </a>
    );
  }
  return <>{value}</>;
}
