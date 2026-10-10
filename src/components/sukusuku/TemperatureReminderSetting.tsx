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
    // お知らせは「通知」のトグル（端末ごと）で切り替えるので、ここでは常にオン。
    void apply({ ...settings, enabled: true, [key]: value });
  };

  return (
    // 「通知」の枠（NotificationSetting）の中に置く。上の項目とは線で区切る。
    <section className="border-t border-gray-100 pt-2 mt-2">
      <div className="flex items-center gap-2">
        <Thermometer size={16} className="text-orange-600" />
        <span className="flex-1 text-sm font-bold text-gray-900">検温</span>
        {(
          [
            { key: 'morningTime', label: '朝' },
            { key: 'eveningTime', label: '夕' },
          ] as const
        ).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-1 border border-gray-300 rounded-lg px-2 py-1">
            <span className="text-xs font-medium text-gray-500">{label}</span>
            <input
              type="time"
              value={settings[key]}
              onChange={(e) => changeTime(key, e.target.value)}
              aria-label={`${label}の検温の時刻`}
              className="text-sm text-gray-700 outline-none bg-transparent"
            />
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </section>
  );
}
