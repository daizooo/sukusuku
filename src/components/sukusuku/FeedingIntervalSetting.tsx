'use client';

import { useMemo, useState } from 'react';
import { Coffee } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { saveFeedingSettings, type FeedingSettings } from '@/lib/api/feedingSettings';
import { FEEDING_INTERVAL_OPTIONS, formatMinutesText } from '@/lib/feedingSchedule';

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
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <h3 className="font-bold text-gray-800 mb-4 flex items-center border-b pb-2">
        <Coffee size={18} className="mr-2 text-amber-600" /> 次の授乳の目安
      </h3>

      <p className="text-sm font-medium text-gray-800">授乳の間隔</p>
      <p className="text-xs text-gray-500 mt-1">
        前回の授乳からこの時間が経った時刻を「次の目安」として、ホームと記録タブに出します。
        夫婦で共通の設定です。
      </p>

      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {FEEDING_INTERVAL_OPTIONS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={settings.intervalMinutes === minutes}
            onClick={() => apply({ ...settings, intervalMinutes: minutes })}
            className={`py-2 rounded-lg text-xs font-bold transition ${
              settings.intervalMinutes === minutes
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {formatMinutesText(minutes)}
          </button>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">目安の時刻に通知する</p>
          <p className="text-xs text-gray-500 mt-1">
            通知をオンにしている家族の端末すべてに届きます（端末ごとの通知は上の「通知」でオンにしてください）。
            オフにしても画面の目安の表示は出ます。
          </p>
        </div>
        <button
          type="button"
          onClick={() => apply({ ...settings, notifyEnabled: !settings.notifyEnabled })}
          aria-label="授乳の目安の通知の切り替え"
          aria-pressed={settings.notifyEnabled}
          className={`w-11 h-6 rounded-full relative flex-none transition-colors ${
            settings.notifyEnabled ? 'bg-blue-500' : 'bg-gray-300'
          }`}
        >
          <div
            className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${
              settings.notifyEnabled ? 'left-5.5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
    </section>
  );
}
