'use client';

import { ChevronLeft } from 'lucide-react';
import NotificationSetting from '@/components/sukusuku/NotificationSetting';
import FeedingIntervalSetting from '@/components/sukusuku/FeedingIntervalSetting';
import TemperatureReminderSetting from '@/components/sukusuku/TemperatureReminderSetting';
import AccountSection from '@/components/sukusuku/AccountSection';
import FamilySection from '@/components/sukusuku/FamilySection';
import { useBackLayer } from '@/lib/browserHistory';
import type { FeedingSettings } from '@/lib/api/feedingSettings';
import type { TemperatureReminderSettings } from '@/lib/api/temperatureReminderSettings';

// 設定の画面。その他タブの「設定」の行から開く（以前は設定タブそのもの。2026-10-13にその他タブへ改めた。
// docs/family-app.md §4.3・§4.5）。家族・通知・アカウントに絞る。
// 以前の自由入力（お子様の情報・パパママ情報・緊急連絡先・カスタム項目）は
// 「家族」（family_members・families）に置き換えた。mobile版は `mobile/app/settings.tsx`。

interface SettingsScreenProps {
  familyId: string;
  userId: string;
  /** 次の授乳の目安の設定。家族で共通なので、変更はアプリ全体へ反映する。 */
  feedingSettings: FeedingSettings;
  onChangeFeedingSettings: (settings: FeedingSettings) => void;
  /** 検温のお知らせの設定。こちらも家族で共通。 */
  temperatureReminderSettings: TemperatureReminderSettings;
  onChangeTemperatureReminderSettings: (settings: TemperatureReminderSettings) => void;
  onClose: () => void;
}

export default function SettingsScreen({
  familyId,
  userId,
  feedingSettings,
  onChangeFeedingSettings,
  temperatureReminderSettings,
  onChangeTemperatureReminderSettings,
  onClose,
}: SettingsScreenProps) {
  // 戻る操作（ブラウザの戻る）は、その他タブへ戻す。
  useBackLayer(onClose);

  return (
    <div className="px-4 pt-3 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="shrink-0 flex items-center pb-2">
        <button
          type="button"
          aria-label="戻る"
          onClick={onClose}
          className="flex items-center gap-1.5 -ml-1 rounded-lg py-1 pr-2 hover:bg-gray-100 transition"
        >
          <ChevronLeft size={22} className="text-gray-500" />
          <h2 className="text-lg font-bold text-gray-900">設定</h2>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3 pb-6">
          <FamilySection familyId={familyId} userId={userId} />

          {/* 通知。授乳の目安・検温のお知らせも同じ枠にまとめる（docs/family-app.md §7-5） */}
          <NotificationSetting>
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
          </NotificationSetting>

          <AccountSection familyId={familyId} userId={userId} />
        </div>
      </div>
    </div>
  );
}
