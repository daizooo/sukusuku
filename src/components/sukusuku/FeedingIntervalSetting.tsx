'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { saveFeedingSettings, type FeedingSettings } from '@/lib/api/feedingSettings';
import { FEEDING_INTERVAL_OPTIONS, formatMinutesText } from '@/lib/feedingSchedule';
import BabyBottleIcon from './ui/BabyBottleIcon';

interface FeedingIntervalSettingProps {
  familyId: string;
  settings: FeedingSettings;
  onChange: (settings: FeedingSettings) => void;
}

/**
 * 「次の授乳の目安」の設定。
 * 家族で共通の設定なので、どちらが変えても両方の画面に同じ目安が出る。
 */
export default function FeedingIntervalSetting({
  familyId,
  settings,
  onChange,
}: FeedingIntervalSettingProps) {
  const supabase = useMemo(() => createClient(), []);
  const [error, setError] = useState<string | null>(null);

  // 画面には先に反映し、保存に失敗したら元へ戻す（設定タブの他の項目と同じ考え方）。
  const apply = async (next: FeedingSettings) => {
    const previous = settings;
    onChange(next);
    setError(null);
    try {
      await saveFeedingSettings(supabase, familyId, next);
    } catch (err) {
      console.error('Failed to save feeding settings:', err);
      onChange(previous);
      setError('設定を保存できませんでした。もう一度お試しください。');
    }
  };

  return (
    // 「通知」の枠（NotificationSetting）の中に置く。上の項目とは線で区切る。
    <section className="border-t border-gray-100 pt-3 mt-3">
      <div className="flex items-center gap-2">
        <BabyBottleIcon size={16} className="text-amber-600" />
        <span className="flex-1 text-sm font-medium text-gray-800">授乳の間隔</span>
        {FEEDING_INTERVAL_OPTIONS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={settings.intervalMinutes === minutes}
            // 目安の通知は「通知」のトグル（端末ごと）で切り替えるので、ここでは常にオン。
            onClick={() => apply({ intervalMinutes: minutes, notifyEnabled: true })}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
              settings.intervalMinutes === minutes
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {formatMinutesText(minutes)}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </section>
  );
}
