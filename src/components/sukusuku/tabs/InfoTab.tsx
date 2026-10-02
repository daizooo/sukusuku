'use client';

import type { Member } from '@/types/app';
import NotificationSetting from '@/components/sukusuku/NotificationSetting';
import FeedingIntervalSetting from '@/components/sukusuku/FeedingIntervalSetting';
import TemperatureReminderSetting from '@/components/sukusuku/TemperatureReminderSetting';
import AccountSection from '@/components/sukusuku/AccountSection';
import FamilySection from '@/components/sukusuku/FamilySection';
import type { FeedingSettings } from '@/lib/api/feedingSettings';
import type { TemperatureReminderSettings } from '@/lib/api/temperatureReminderSettings';

// 設定タブ。アカウント・家族・通知に絞る（docs/family-app.md §4.3）。
// 以前の自由入力（お子様の情報・パパママ情報・緊急連絡先・カスタム項目）は
// 「家族」（family_members・families）に置き換えた。mobile版は `mobile/app/(tabs)/info.tsx`。

interface InfoTabProps {
  familyId: string;
  userId: string;
  /** 家族の情報を直したとき。子の誕生日（生後日数・出生日基準の予定）を反映するのに使う。 */
  onMembersChange: (members: Member[]) => void;
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
  onMembersChange,
  feedingSettings,
  onChangeFeedingSettings,
  temperatureReminderSettings,
  onChangeTemperatureReminderSettings,
}: InfoTabProps) {
  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 pb-6">
          <AccountSection familyId={familyId} userId={userId} />

          <FamilySection familyId={familyId} userId={userId} onMembersChange={onMembersChange} />

          {/* 通知。授乳の目安・検温のお知らせも同じ枠にまとめる（docs/family-app.md §7-5） */}
          <NotificationSetting familyId={familyId} userId={userId}>
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
        </div>
      </div>
    </div>
  );
}
