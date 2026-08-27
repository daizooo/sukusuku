'use client';

import { useMemo, useState } from 'react';
import { Thermometer } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  saveTemperatureReminderSettings,
  type TemperatureReminderSettings,
} from '@/lib/api/temperatureReminderSettings';

interface TemperatureReminderSettingProps {
  familyId: string;
  settings: TemperatureReminderSettings;
  onChange: (settings: TemperatureReminderSettings) => void;
}

/** 'HH:mm' として読める値かどうか。入力欄を空にした途中の状態を保存しないために見る。 */
const isValidTime = (value: string): boolean => /^\d{2}:\d{2}$/.test(value);

/**
 * 検温のお知らせの設定。
 * 家族で共通の設定なので、どちらが変えても両方の端末に同じ時刻で届く。
 */
export default function TemperatureReminderSetting({
  familyId,
  settings,
  onChange,
}: TemperatureReminderSettingProps) {
  const supabase = useMemo(() => createClient(), []);
  const [error, setError] = useState<string | null>(null);

  // 画面には先に反映し、保存に失敗したら元へ戻す（設定タブの他の項目と同じ考え方）。
  const apply = async (next: TemperatureReminderSettings) => {
    const previous = settings;
    onChange(next);
    setError(null);
    try {
      await saveTemperatureReminderSettings(supabase, familyId, next);
    } catch (err) {
      console.error('Failed to save temperature reminder settings:', err);
      onChange(previous);
      setError('設定を保存できませんでした。もう一度お試しください。');
    }
  };

  const changeTime = (key: 'morningTime' | 'eveningTime', value: string) => {
    // 入力途中（空・不完全）は画面にだけ反映し、形が整ってから保存する。
    if (!isValidTime(value)) {
      onChange({ ...settings, [key]: value });
      return;
    }
    void apply({ ...settings, [key]: value });
  };

  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <h3 className="font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
        <Thermometer size={18} className="mr-2 text-orange-600" /> 検温のお知らせ
      </h3>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">決まった時刻にお知らせする</p>
          <p className="text-xs text-gray-500 mt-1">
            毎日同じ時刻に測ると平熱が分かり、「この子にしては高い」に気づけます。
            通知をオンにしている家族の端末すべてに届きます（端末ごとの通知は上の「通知」でオンにしてください）。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void apply({ ...settings, enabled: !settings.enabled })}
          aria-label="検温のお知らせの切り替え"
          aria-pressed={settings.enabled}
          className={`w-11 h-6 rounded-full relative flex-none transition-colors ${
            settings.enabled ? 'bg-blue-500' : 'bg-gray-300'
          }`}
        >
          <div
            className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${
              settings.enabled ? 'left-5.5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">朝</span>
          <input
            type="time"
            value={settings.morningTime}
            onChange={(e) => changeTime('morningTime', e.target.value)}
            disabled={!settings.enabled}
            className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none disabled:bg-gray-50 disabled:text-gray-400"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">夕方</span>
          <input
            type="time"
            value={settings.eveningTime}
            onChange={(e) => changeTime('eveningTime', e.target.value)}
            disabled={!settings.enabled}
            className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none disabled:bg-gray-50 disabled:text-gray-400"
          />
        </label>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        その時刻の1時間前までに測っていれば、その回のお知らせは届きません。
      </p>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
    </section>
  );
}
